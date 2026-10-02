import "server-only";
import { createHash } from "node:crypto";
import type { Json } from "./db/types";

/**
 * Error logging (docs/logging.md). One entry point for every failure the app
 * wants to keep: logError() prints a console line, then records the error in
 * `error_events` / `error_occurrences`, grouped by fingerprint, and alerts the
 * developer the first time an error is seen (or comes back after being
 * resolved).
 *
 * Three rules, each load-bearing:
 *   · It never throws. A logger that can fail turns one error into two, and
 *     callers put it in catch blocks precisely because something already broke.
 *   · It never blocks. Inside a request the database write is deferred with
 *     after(), so a slow log can't slow a page. (onRequestError awaits — Next
 *     requires it — via recordError().)
 *   · It never recurses. The write goes through logDb(), whose plain fetch
 *     skips the transport logger — see src/lib/db/log-client.ts.
 *
 * And it scrubs before storing: secret-looking keys are redacted at any depth,
 * everything is length-capped, and only a user id is ever kept, never an email.
 */

export type ErrorSource = "server" | "client" | "job" | "webhook" | "adapter" | "db";

export type LogErrorInput = {
  source: ErrorSource;
  /** Where it happened, coarse enough to group on: "render:/news/[slug]", "job:social_push", "client:/member". */
  area: string;
  error: unknown;
  path?: string | null;
  digest?: string | null;
  userId?: string | null;
  context?: Record<string, unknown>;
};

const MESSAGE_MAX = 1024;
const STACK_MAX = 4096;
const CONTEXT_MAX = 4096;
const SECRET_KEY = /pass(word|wd)?|token|secret|authori[sz]ation|cookie|api[_-]?key|signature/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** Message and stack out of anything that was thrown. */
export function describe(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) return { message: error.message || error.name, stack: error.stack ?? null };
  if (typeof error === "string") return { message: error, stack: null };
  try {
    return { message: JSON.stringify(error) ?? String(error), stack: null };
  } catch {
    return { message: String(error), stack: null };
  }
}

/**
 * The same failure must group as one error whatever ids it mentions and
 * whichever build produced it: ids, numbers and quoted values become
 * placeholders, and the stack frame keeps its file but drops line:column.
 */
export function normaliseMessage(message: string): string {
  return message
    .replace(UUID, "<id>")
    .replace(/(["'`])(?:(?!\1).){0,200}\1/g, "<str>")
    .replace(/\b\d+(\.\d+)?\b/g, "<n>")
    .trim();
}

function topFrame(stack: string | null): string {
  if (!stack) return "";
  const line = stack.split("\n").map((l) => l.trim()).find((l) => l.startsWith("at ") && (l.includes("/src/") || l.includes(".next/server")));
  return line ? line.replace(/:\d+:\d+\)?$/, "").replace(/\?[^)\s]*/, "") : "";
}

export function fingerprint(source: string, area: string, message: string, stack: string | null): string {
  return createHash("sha256")
    .update([source, area, normaliseMessage(message), topFrame(stack)].join("|"))
    .digest("hex")
    .slice(0, 16);
}

/** Recursively redact secret-looking keys and cap every string. Pure; safe on cycles. */
export function scrub(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return clip(value, 512);
  if (typeof value !== "object") return String(value);
  if (seen.has(value) || depth > 6) return "[…]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, seen, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value).slice(0, 40)) {
    out[k] = SECRET_KEY.test(k) ? "[redacted]" : scrub(v, seen, depth + 1);
  }
  return out;
}

/** A path without its query string — queries carry tokens and search terms. */
export function stripQuery(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.split("?")[0].split("#")[0].slice(0, 512) || null;
}

function contextJson(context: Record<string, unknown> | undefined): Json {
  const scrubbed = scrub(context ?? {});
  const text = JSON.stringify(scrubbed);
  return (text.length > CONTEXT_MAX ? { truncated: clip(text, CONTEXT_MAX) } : scrubbed) as Json;
}

/** What one logError call would store — exported for tests. */
export function buildRecord(input: LogErrorInput) {
  const { message, stack } = describe(input.error);
  const area = clip(input.area || "unknown", 200);
  return {
    p_fingerprint: fingerprint(input.source, area, message, stack),
    p_source: input.source,
    p_area: area,
    p_message: clip(message, MESSAGE_MAX),
    p_stack: stack ? clip(stack, STACK_MAX) : null,
    p_path: stripQuery(input.path),
    p_digest: input.digest ? clip(input.digest, 100) : null,
    p_user: input.userId ?? null,
    p_context: contextJson(input.context),
  };
}

/**
 * Record an error and await the write — for callers that must not return
 * before it lands (onRequestError, a job about to die). Never throws.
 */
export async function recordError(input: LogErrorInput): Promise<void> {
  let record: ReturnType<typeof buildRecord> | null = null;
  try {
    record = buildRecord(input);
    // The console line first, always: if the database is the thing that's
    // down, Vercel's function log still has the error.
    console.error(`[error] ${JSON.stringify({ source: record.p_source, area: record.p_area, message: record.p_message, path: record.p_path, digest: record.p_digest, fingerprint: record.p_fingerprint })}`);
    const { logDb } = await import("./db/log-client");
    const db = logDb();
    if (!db) return;
    // The generated Args type marks every parameter non-null; the SQL takes
    // null for the optional ones (stack, path, digest, user), which is what
    // these are when absent.
    type Args = import("./db/types").Database["public"]["Functions"]["log_error_event"]["Args"];
    const { data, error } = await db.rpc("log_error_event", record as unknown as Args);
    if (error) {
      console.error(`[error-log] could not record ${record.p_fingerprint}: ${error.message}`);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row) {
      const { maybeAlert } = await import("./log-alerts");
      await maybeAlert(row, record);
    }
  } catch (e) {
    try {
      console.error(`[error-log] logger failed${record ? ` for ${record.p_fingerprint}` : ""}:`, e instanceof Error ? e.message : e);
    } catch {
      // nothing left to do — the logger must not throw
    }
  }
}

/**
 * Record an error without making the caller wait. Inside a request the write
 * runs after the response is sent; elsewhere (scripts, tests) it simply runs
 * un-awaited. Never throws.
 */
export function logError(input: LogErrorInput): void {
  try {
    void import("next/server")
      .then(({ after }) => after(() => recordError(input)))
      .catch(() => recordError(input));
  } catch {
    void recordError(input);
  }
}

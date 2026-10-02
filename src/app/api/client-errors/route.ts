import { after } from "next/server";
import { cookies } from "next/headers";
import { isNoise } from "@/lib/client-error-report";
import { recordError } from "@/lib/log";
import { allowRequest, MINUTE } from "@/lib/rate-limit";

/**
 * Browser error reports from src/lib/client-error-report.ts (docs/logging.md).
 *
 * Always 204, like /api/seen: a reporting endpoint must not tell the caller
 * whether it recorded anything. Everything it accepts is bounded — 20 reports
 * a minute per caller, 8 KB per body, a message required — because anyone can
 * post to it. The noise filter runs again here, since the client's copy is
 * just a courtesy. The work (including the user lookup) happens after the
 * response is sent.
 */
const MAX_BODY = 8 * 1024;
const KINDS = new Set(["error", "unhandledrejection", "boundary"]);

export async function POST(req: Request) {
  const none = new Response(null, { status: 204 });
  try {
    if (!(await allowRequest("client-errors", 20, MINUTE))) return none;
    const raw = await req.text();
    if (!raw || raw.length > MAX_BODY) return none;
    const body = JSON.parse(raw) as Record<string, unknown>;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const stack = typeof body.stack === "string" ? body.stack : null;
    if (!message || isNoise(message, stack)) return none;
    const kind = typeof body.kind === "string" && KINDS.has(body.kind) ? body.kind : "error";
    const path = typeof body.path === "string" && body.path.startsWith("/") ? body.path : null;
    const digest = typeof body.digest === "string" ? body.digest : null;
    const ua = req.headers.get("user-agent");
    const signedIn = (await cookies()).getAll().some((c) => c.name.startsWith("sb-"));

    after(async () => {
      let userId: string | null = null;
      if (signedIn) {
        const { currentUser } = await import("@/lib/auth");
        userId = (await currentUser().catch(() => null))?.userId ?? null;
      }
      // The browser's stack, or none — never this route's own server stack,
      // which new Error() would otherwise supply and which describes nothing.
      const error = new Error(message);
      error.stack = stack ?? "";
      await recordError({
        source: "client",
        // Grouped by section, not the literal path: /news/a and /news/b are
        // the same page template throwing the same error.
        area: `client:/${(path ?? "/").split("/")[1] ?? ""}`,
        error,
        path,
        digest,
        userId,
        context: { kind, ua },
      });
    });
  } catch {
    // malformed JSON or anything else: still 204, still nothing recorded
  }
  return none;
}

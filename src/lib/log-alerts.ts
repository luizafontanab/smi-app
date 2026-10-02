import "server-only";
import { HOUR, withinLimit } from "./rate-limit";
import { siteUrl } from "./site-url";

/**
 * Error alerts — to the developer (DEV_ALERT_EMAIL), never to Jas.
 *
 * An email goes out when an error is NEW, or REOPENED (it was resolved and has
 * happened again) — not on every occurrence, which would turn one bad deploy
 * into hundreds of emails. A reopen always alerts: resolving is a deliberate
 * "I think this is fixed", so its return is exactly the news worth sending,
 * and it can't spam — each reopen needs a fresh Resolve first. Otherwise the
 * same error alerts at most once an hour, and the instance sends at most 20
 * alerts an hour in total.
 * The daily digest (sendErrorDigest, job `dev_error_digest`) covers the rest.
 *
 * Sent inline rather than through the job queue on purpose: production cron
 * runs once a day (GAPS A3.1), so a queued alert could arrive a day late.
 */

const ALERT_COOLDOWN_MS = HOUR;
const ALERTS_PER_HOUR = 20;

export type LogResultRow = {
  event_id: string;
  is_new: boolean;
  reopened: boolean;
  alerted_at: string | null;
  status: string;
};

type Recorded = { p_source: string; p_area: string; p_message: string; p_path: string | null; p_stack: string | null; p_digest: string | null };

function recipient(): string | null {
  return process.env.DEV_ALERT_EMAIL?.trim() || null;
}

/** Whether this occurrence should email the developer. Pure; exported for tests. */
export function shouldAlert(row: LogResultRow, now = Date.now()): boolean {
  if (row.status === "ignored") return false;
  if (row.reopened) return true;
  if (!row.is_new) return false;
  if (row.alerted_at && now - new Date(row.alerted_at).getTime() < ALERT_COOLDOWN_MS) return false;
  return true;
}

export function alertText(row: LogResultRow, rec: Recorded): { subject: string; text: string } {
  const what = row.reopened ? "Reopened error" : "New error";
  const stackHead = (rec.p_stack ?? "").split("\n").slice(0, 8).join("\n");
  return {
    subject: `[SMI] ${what}: ${rec.p_message.slice(0, 90)}`,
    text: [
      `${what} on Sheet Metal Industries.`,
      "",
      `Source:  ${rec.p_source}`,
      `Area:    ${rec.p_area}`,
      `Path:    ${rec.p_path ?? "—"}`,
      `Digest:  ${rec.p_digest ?? "—"}`,
      "",
      rec.p_message,
      "",
      stackHead,
      "",
      `Details: ${siteUrl()}/console/errors/${row.event_id}`,
    ].join("\n"),
  };
}

/** Called by recordError with the database's verdict on this occurrence. Never throws. */
export async function maybeAlert(row: LogResultRow, rec: Recorded): Promise<void> {
  try {
    if (!shouldAlert(row)) return;
    const to = recipient();
    if (!to) {
      console.warn("[error-log] DEV_ALERT_EMAIL is not set — error recorded, no alert sent.");
      return;
    }
    if (!withinLimit("error-alerts", ALERTS_PER_HOUR, HOUR)) return;
    const { getEmailSender } = await import("./adapters/email");
    const hour = new Date().toISOString().slice(0, 13);
    await getEmailSender().send({ to, ...alertText(row, rec) }, { idempotencyKey: `err-${row.event_id}-${hour}` });
    const { logDb } = await import("./db/log-client");
    await logDb()?.from("error_events").update({ alerted_at: new Date().toISOString() }).eq("id", row.event_id);
  } catch (e) {
    console.error("[error-log] alert failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * The daily digest: every error seen in the last 24 hours that isn't ignored,
 * busiest first. Sends nothing on a quiet day. Run by the `dev_error_digest` job.
 */
export async function sendErrorDigest(): Promise<{ sent: boolean; errors: number }> {
  const to = recipient();
  const { logDb } = await import("./db/log-client");
  const db = logDb();
  if (!to || !db) return { sent: false, errors: 0 };
  const since = new Date(Date.now() - 24 * HOUR).toISOString();
  const { data, error } = await db
    .from("error_events")
    .select("id, source, area, message, count, first_seen, last_seen, status")
    .gte("last_seen", since)
    .neq("status", "ignored")
    .order("count", { ascending: false })
    .limit(50);
  if (error) throw new Error(`error digest query failed: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return { sent: false, errors: 0 };
  const lines = rows.map((r) => {
    const fresh = r.first_seen >= since ? " (new)" : "";
    return `• ${r.count}× ${r.source} ${r.area}${fresh}\n  ${r.message.slice(0, 160)}\n  ${siteUrl()}/console/errors/${r.id}`;
  });
  const { getEmailSender } = await import("./adapters/email");
  await getEmailSender().send(
    {
      to,
      subject: `[SMI] ${rows.length} error${rows.length === 1 ? "" : "s"} in the last 24 hours`,
      text: [`Errors seen on Sheet Metal Industries in the last 24 hours, busiest first:`, "", ...lines, "", `All errors: ${siteUrl()}/console/errors`].join("\n"),
    },
    { idempotencyKey: `err-digest-${new Date().toISOString().slice(0, 10)}` },
  );
  return { sent: true, errors: rows.length };
}

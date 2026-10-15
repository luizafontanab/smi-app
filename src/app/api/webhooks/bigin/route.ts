import { NextResponse, type NextRequest } from "next/server";
import { getCrmSync, webhookTokenMatches } from "@/lib/adapters/crm";

/**
 * Bigin Notifications API → our `contacts` table, so a contact added or
 * edited in Bigin shows up here without waiting for the next crm_sync poll.
 * The channel is opened and renewed by CrmSync.sync() (lib/adapters/crm.ts).
 *
 * Bigin doesn't sign notifications; the only check it offers is echoing back
 * the token we registered the channel with. That is enough here because the
 * payload carries ids only, and we never trust anything else in it: every id
 * is re-read from Bigin's API before it touches the table. The worst a forged
 * call can do is make us re-fetch records that really exist.
 *
 * Always answers 200 once authenticated. A failure is logged and left to the
 * poll, which is the source of truth; a non-2xx would only make Bigin retry
 * into the same failure.
 */

type BiginNotification = {
  module?: string;
  operation?: string;
  ids?: unknown[];
  token?: unknown;
};

export async function POST(request: NextRequest) {
  const expected = process.env.BIGIN_WEBHOOK_TOKEN?.trim();
  if (!expected) {
    // Fails closed, like the Resend webhook: an unauthenticated endpoint that
    // writes contacts is worse than one that is switched off.
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  let event: BiginNotification;
  try {
    event = (await request.json()) as BiginNotification;
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
  if (!webhookTokenMatches(event.token, expected)) {
    return NextResponse.json({ error: "bad token" }, { status: 401 });
  }

  if (event.module !== "Contacts") return NextResponse.json({ ok: true, ignored: "module" });
  const ids = (Array.isArray(event.ids) ? event.ids : []).map(String).filter((id) => /^\d+$/.test(id));
  if (!ids.length) return NextResponse.json({ ok: true, ignored: "no ids" });

  try {
    const crm = getCrmSync();
    if (event.operation === "delete") await crm.unlink(ids);
    else await crm.pullIds(ids);
  } catch (e) {
    console.error(`[bigin-webhook] ${event.operation} of ${ids.length} contact(s) failed; the next poll will catch up:`, e);
  }
  return NextResponse.json({ ok: true });
}

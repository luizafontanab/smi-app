import { serviceDb } from "./db/server";
import type { InboxCategory, InboxKind, InboxNotificationKind, InboxPayload } from "./console-notification-links";
import type { AdminEmailKind } from "./email/templates";

/**
 * Deliberately has no fallback. The old default was `jas@smi.local`, which is
 * an undeliverable domain: with a real Resend key configured, every admin
 * notification bounced and the failure was swallowed by the catch below. An
 * unset variable now skips the send (the console inbox row is still written)
 * and says so in the logs, which is a visible failure rather than a silent one.
 */
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

/**
 * Console-facing trail for Jas: every step lands in the console inbox; only
 * some steps also email him — the rest are console-only by design (never
 * bombard). Must never throw into the flow that called it.
 *
 * `category` is REQUIRED and has no default (fix-list 71). This function was
 * the root of the mess it now prevents: it wrote every row as a
 * `kind: 'membership'` enquiry, so a signup receipt and a member asking a
 * question arrived in the console as the same kind of thing, and the reply form
 * was offered on both. What a row is cannot be inferred later from its text, so
 * it is stated here, at the call site that knows.
 *
 *   · 'message'      — a person wrote it and is waiting for an answer.
 *   · 'notification' — something happened; there is nothing to reply to.
 *
 * `kind` is the inbox row's own kind, checked in the database. `emailKind` is a
 * different axis entirely: it names an editable template rather than carrying a
 * subject line (the wording lives in `/console/email-templates`, fix-list 63),
 * and it is what decides email-or-not. Omitting it is still how a step says
 * "console only". It used to be called `kind`, which is why every caller reads
 * a little differently now.
 */
export async function notifyAdminFunnel(opts: {
  category: InboxCategory;
  kind: InboxKind;
  name: string;
  email: string;
  message: string;
  /** The member this is about, when there is one — lets a notification link to them. */
  memberId?: string | null;
  /** Ids the notification links on. See console-notification-links.ts. */
  payload?: InboxPayload;
  emailKind?: AdminEmailKind;
  /** Any extra placeholders this template needs beyond name, email and message. */
  vars?: Record<string, string>;
}): Promise<void> {
  try {
    await serviceDb().from("inbox_messages").insert({
      category: opts.category,
      kind: opts.kind,
      name: opts.name,
      email: opts.email,
      message: opts.message,
      member_id: opts.memberId ?? null,
      payload: opts.payload ?? {},
    });
    if (opts.emailKind && !ADMIN_EMAIL) {
      console.warn("[funnel] ADMIN_EMAIL is not set — inbox row written, no email sent.");
    } else if (opts.emailKind && ADMIN_EMAIL) {
      const [{ getEmailSender }, { renderAdminEmail }, { loadEmailTemplates }] = await Promise.all([
        import("./adapters/email"),
        import("./email/templates"),
        import("./email/store"),
      ]);
      const mail = renderAdminEmail(
        opts.emailKind,
        { name: opts.name, email: opts.email, message: opts.message, ...opts.vars },
        await loadEmailTemplates(),
      );
      await getEmailSender().send({ to: ADMIN_EMAIL, ...mail });
    }
  } catch (e) {
    console.error("[funnel] admin notification failed:", e);
  }
}

/**
 * Raise a console notification about something a member just did (fix-list 71).
 *
 * The gap this fills: members submit stories, videos, events, equipment,
 * adverts and artwork swaps into `awaiting_approval` from a dozen places in
 * `src/app/dashboard/actions.ts`, and until now not one of them told the
 * console. The only signal was the aggregate "Needs you today" list, which
 * counts items and links to a list page — never to the thing itself.
 *
 * Console-only by design: no email. These arrive in ones and twos all day and
 * the daily `admin_digest` already exists for the summary; mailing each one
 * would be the bombardment the funnel helper above is careful to avoid.
 *
 * `name` is resolved from the member rather than passed, so every row in the
 * feed names the company the same way and no caller has to add a lookup of its
 * own. Pass `name` to override it for a row that is about a thing rather than
 * a member (an advert run, say).
 *
 * Never throws: a submission that succeeded must not fail on its receipt.
 */
export async function notifyConsole(opts: {
  kind: InboxNotificationKind;
  message: string;
  memberId?: string | null;
  payload?: InboxPayload;
  name?: string;
  /** Only for rows that pre-date a member record, or are not about one. */
  email?: string;
}): Promise<void> {
  try {
    const db = serviceDb();
    let name = opts.name;
    if (!name && opts.memberId) {
      const { data: member } = await db.from("members").select("name").eq("id", opts.memberId).maybeSingle();
      name = member?.name ?? undefined;
    }
    await db.from("inbox_messages").insert({
      category: "notification",
      kind: opts.kind,
      // `name` and `email` are NOT NULL on the table. A notification has no
      // correspondent, so the email stays empty on purpose — that emptiness is
      // what the detail page checks before deciding whether a reply form makes
      // any sense at all.
      name: name ?? "A member",
      email: opts.email ?? "",
      message: opts.message,
      member_id: opts.memberId ?? null,
      payload: opts.payload ?? {},
    });
  } catch (e) {
    console.error("[notify-console] notification failed:", e);
  }
}

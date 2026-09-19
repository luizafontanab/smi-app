import { serviceDb } from "./db/server";
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
 * Join-funnel trail for Jas: every step lands in the console inbox
 * (kind 'membership'); only some steps also email him — the rest are
 * console-only by design (never bombard). Must never throw into the signup
 * flow.
 *
 * `kind` is what decides email-or-not, and it names an editable template rather
 * than carrying a subject line: the wording of these lives in
 * `/console/email-templates` now (fix-list 63), so a caller that built its own
 * subject string would be copy nobody could reach. Omitting `kind` is still how
 * a step says "console only".
 */
export async function notifyAdminFunnel(opts: {
  name: string;
  email: string;
  message: string;
  kind?: AdminEmailKind;
  /** Any extra placeholders this template needs beyond name, email and message. */
  vars?: Record<string, string>;
}): Promise<void> {
  try {
    await serviceDb().from("inbox_messages").insert({
      kind: "membership",
      name: opts.name,
      email: opts.email,
      message: opts.message,
    });
    if (opts.kind && !ADMIN_EMAIL) {
      console.warn("[funnel] ADMIN_EMAIL is not set — inbox row written, no email sent.");
    } else if (opts.kind && ADMIN_EMAIL) {
      const [{ getEmailSender }, { renderAdminEmail }, { loadEmailTemplates }] = await Promise.all([
        import("./adapters/email"),
        import("./email/templates"),
        import("./email/store"),
      ]);
      const mail = renderAdminEmail(
        opts.kind,
        { name: opts.name, email: opts.email, message: opts.message, ...opts.vars },
        await loadEmailTemplates(),
      );
      await getEmailSender().send({ to: ADMIN_EMAIL, ...mail });
    }
  } catch (e) {
    console.error("[funnel] admin notification failed:", e);
  }
}

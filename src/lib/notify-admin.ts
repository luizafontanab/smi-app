import { serviceDb } from "./db/server";

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
 * (kind 'membership'); only account creation also emails him — later
 * steps are console-only by design (never bombard). Must never throw
 * into the signup flow.
 */
export async function notifyAdminFunnel(opts: {
  name: string;
  email: string;
  message: string;
  emailSubject?: string;
}): Promise<void> {
  try {
    await serviceDb().from("inbox_messages").insert({
      kind: "membership",
      name: opts.name,
      email: opts.email,
      message: opts.message,
    });
    if (opts.emailSubject && !ADMIN_EMAIL) {
      console.warn("[funnel] ADMIN_EMAIL is not set — inbox row written, no email sent.");
    } else if (opts.emailSubject && ADMIN_EMAIL) {
      const { getEmailSender } = await import("./adapters/email");
      await getEmailSender().send({
        to: ADMIN_EMAIL,
        subject: opts.emailSubject,
        text: `${opts.name} <${opts.email}>\n\n${opts.message}`,
      });
    }
  } catch (e) {
    console.error("[funnel] admin notification failed:", e);
  }
}

import { serviceDb } from "./db/server";

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "jas@smi.local";

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
    if (opts.emailSubject) {
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

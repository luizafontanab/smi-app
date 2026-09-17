"use server";

import { serviceDb } from "@/lib/db/server";
import { ADMIN_EMAIL } from "@/lib/notify-admin";
import { allowRequest, HOUR } from "@/lib/rate-limit";

const TOO_MANY = "Too many attempts just now — please try again shortly.";

export async function subscribeNewsletter(_prev: { message: string }, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { message: "Please enter a valid email." };
  if (!(await allowRequest("newsletter", 5, HOUR))) return { message: TOO_MANY };
  const db = serviceDb();

  // opt-outs are permanent: never re-subscribe an unsubscribed contact silently
  const { data: existing } = await db.from("contacts").select("id, unsubscribed_at").eq("email", email).maybeSingle();
  if (existing?.unsubscribed_at) {
    return { message: "This address previously unsubscribed — contact us to re-opt-in." };
  }
  await db.from("newsletter_signups").insert({ email });
  if (!existing) {
    await db.from("contacts").insert({ email, source: "newsletter", subscribed: true });
  }
  try {
    const { getCrmSync } = await import("@/lib/adapters/crm");
    await getCrmSync().pushContact({ email }); // write-through to Bigin (GAPS B6.2)
  } catch (e) {
    // The signup is already recorded above — a CRM outage must not cost a
    // visitor their subscription confirmation.
    console.error("[newsletter] CRM push failed:", e);
  }
  return { message: "Subscribed — see you next issue." };
}

export async function sendContactMessage(_prev: { message: string }, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const kind = formData.get("kind") === "advertising" ? "advertising" : "contact";
  if (!name || !email || !message) return { message: "All fields are required." };
  if (!(await allowRequest("contact", 5, HOUR))) return { message: TOO_MANY };
  const db = serviceDb();
  await db.from("inbox_messages").insert({ kind, name, email, message });
  // ADMIN_EMAIL has no fallback by design (see lib/notify-admin) — the enquiry
  // is already safe in the console inbox, so a missing address must not throw.
  if (!ADMIN_EMAIL) {
    console.warn("[contact] ADMIN_EMAIL is not set — inbox row written, no email sent.");
    return { message: "Thanks — we'll come back to you shortly." };
  }
  try {
    const { getEmailSender } = await import("@/lib/adapters/email");
    await getEmailSender().send({
      to: ADMIN_EMAIL,
      subject: `New ${kind} enquiry from ${name}`,
      text: `${name} <${email}>\n\n${message}`,
    });
  } catch (e) {
    // The sender throws on a provider rejection so failures are visible. The
    // enquiry is already safe in the console inbox (line 35), so the visitor
    // must still get their acknowledgement — losing the send is not losing
    // the message.
    console.error("[contact] admin notification failed:", e);
  }
  return { message: "Thanks — we'll come back to you shortly." };
}

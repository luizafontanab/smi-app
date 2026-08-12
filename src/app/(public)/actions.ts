"use server";

import { serviceDb } from "@/lib/db/server";
import { ADMIN_EMAIL } from "@/lib/notify-admin";

export async function subscribeNewsletter(_prev: { message: string }, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { message: "Please enter a valid email." };
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
  return { message: "Subscribed — see you next issue." };
}

export async function sendContactMessage(_prev: { message: string }, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const kind = formData.get("kind") === "advertising" ? "advertising" : "contact";
  if (!name || !email || !message) return { message: "All fields are required." };
  const db = serviceDb();
  await db.from("inbox_messages").insert({ kind, name, email, message });
  const { getEmailSender } = await import("@/lib/adapters/email");
  await getEmailSender().send({
    to: ADMIN_EMAIL,
    subject: `New ${kind} enquiry from ${name}`,
    text: `${name} <${email}>\n\n${message}`,
  });
  return { message: "Thanks — we'll come back to you shortly." };
}

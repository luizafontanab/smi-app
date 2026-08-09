"use server";

import { redirect } from "next/navigation";
import { serviceDb, sessionDb } from "@/lib/db/server";
import { getPayments } from "@/lib/adapters/payments";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/**
 * V13/M1 — become a member: checkout (Stripe in prod, simulated locally,
 * promo codes either way) → account + draft company page → straight into
 * the member area. Page goes public once the editor approves it.
 */
export async function joinCheckout(_prev: { message: string }, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const company = String(formData.get("company") ?? "").trim();
  const promoCode = String(formData.get("promo") ?? "").trim() || undefined;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { message: "Please enter a valid email." };
  if (password.length < 8) return { message: "Password needs at least 8 characters." };
  if (!company) return { message: "Company name is required." };

  const payment = await getPayments().createCheckout({ email, companyName: company, promoCode });
  if (payment.kind === "error") return { message: payment.message };
  if (payment.kind === "redirect") redirect(payment.url);

  const db = serviceDb();
  const { data: user, error: authErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authErr) {
    return { message: authErr.message.includes("already") ? "An account with this email already exists — try logging in." : authErr.message };
  }

  const { data: member, error: memberErr } = await db.from("members").insert({
    slug: `${slugify(company)}-${Date.now().toString(36)}`,
    name: company,
    status: "draft",
    billing_mode: "card",
    joined_at: new Date().toISOString().slice(0, 10),
  }).select("id").single();
  if (memberErr || !member) {
    await db.auth.admin.deleteUser(user.user.id); // don't leave a half-created account
    return { message: "Could not create your company page — please try again." };
  }
  await db.from("profiles").insert({ user_id: user.user.id, role: "member", member_id: member.id, display_name: company });
  await db.from("notification_prefs").insert({ member_id: member.id });

  const session = await sessionDb();
  await session.auth.signInWithPassword({ email, password });
  redirect("/member?submitted=welcome");
}

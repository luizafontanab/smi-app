import { serviceDb } from "./db/server";
import type { CheckoutResult } from "./adapters/payments";

export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export type ProvisionResult = { memberId: string } | { error: string };

/**
 * V13 step 1 — account + draft company page (payment comes after, approval last).
 * Kept out of the server action so it's testable without request context.
 */
export async function provisionMember(opts: {
  email: string;
  password: string;
  company: string;
}): Promise<ProvisionResult> {
  const db = serviceDb();
  const { data: user, error: authErr } = await db.auth.admin.createUser({
    email: opts.email,
    password: opts.password,
    email_confirm: true,
  });
  if (authErr) {
    return {
      error: authErr.message.includes("already")
        ? "An account with this email already exists — try logging in."
        : authErr.message,
    };
  }

  const { data: member, error: memberErr } = await db.from("members").insert({
    slug: `${slugify(opts.company)}-${Date.now().toString(36)}`,
    name: opts.company,
    status: "draft",
    billing_mode: "card",
    contact_email: opts.email,
    joined_at: new Date().toISOString().slice(0, 10),
  }).select("id").single();
  if (memberErr || !member) {
    await db.auth.admin.deleteUser(user.user.id); // don't leave a half-created account
    return { error: "Could not create your company page — please try again." };
  }
  await db.from("profiles").insert({ user_id: user.user.id, role: "member", member_id: member.id, display_name: opts.company });
  await db.from("notification_prefs").insert({ member_id: member.id });
  return { memberId: member.id };
}

/**
 * V13 step 2 — persist what checkout settled: card payment (+ invoice the
 * member can see under Billing) or comped months from a promo code.
 * The future Stripe webhook route calls this too — keep it the single seam.
 */
export async function applyPaymentResult(memberId: string, result: CheckoutResult): Promise<void> {
  const db = serviceDb();
  if (result.kind === "paid") {
    const now = new Date();
    await db.from("members").update({ paid_at: now.toISOString() }).eq("id", memberId);
    await db.from("invoices").insert({
      member_id: memberId,
      number: `SMI-JOIN-${now.getTime().toString(36).toUpperCase()}`,
      amount_pennies: 4000,
      issued_on: now.toISOString().slice(0, 10),
      status: "paid",
    });
  } else if (result.kind === "comped") {
    // date-only arithmetic: UTC noon dodges TZ off-by-one at month boundaries
    const d = new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + result.months);
    await db.from("members").update({ comped_until: d.toISOString().slice(0, 10) }).eq("id", memberId);
  }
}

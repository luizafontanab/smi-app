import { serviceDb } from "./db/server";
import type { CheckoutResult } from "./adapters/payments";

export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export type ProvisionResult = { memberId: string } | { error: string };

export type MemberStatus = "draft" | "active" | "grace" | "lapsed";

export const MEMBER_STATUSES: readonly MemberStatus[] = ["draft", "active", "grace", "lapsed"];
export const BILLING_MODES: readonly string[] = ["card", "invoice"];

/**
 * V13 step 4 (A17) — a draft member only goes live once a payment or comp is on
 * record. Both the list-page Activate button and the console edit form POST
 * directly, so this is a guard, not a UI nicety: it is evaluated against the
 * values about to be written, which lets "mark paid and activate" happen in one
 * save while still refusing a bare activation.
 *
 * Returns the message to show, or null when the transition is allowed.
 */
export function activationBlocked(
  current: { status: MemberStatus },
  next: { status: MemberStatus; paid_at: string | null; comped_until: string | null },
): string | null {
  if (current.status !== "draft" || next.status !== "active") return null;
  if (next.paid_at || next.comped_until) return null;
  return "Activating a draft member needs a payment or comp on record — use “Record payment” or set a comped-until date first.";
}

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
/**
 * Queue a member notification without ever failing the caller.
 *
 * Every caller here has already committed the thing that matters — the payment
 * is recorded, the comp is applied — so a queue hiccup must not surface as a
 * failed payment to someone whose money has moved.
 */
async function notifyQuietly(memberId: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const { enqueue } = await import("./jobs");
    await enqueue("notify_member", { member_id: memberId, ...payload });
  } catch (e) {
    console.error("[membership] notification could not be queued:", e);
  }
}

export async function applyPaymentResult(memberId: string, result: CheckoutResult): Promise<void> {
  const db = serviceDb();
  if (result.kind === "paid") {
    const now = new Date();
    const number = `SMI-JOIN-${now.getTime().toString(36).toUpperCase()}`;
    await db.from("members").update({ paid_at: now.toISOString() }).eq("id", memberId);
    await db.from("invoices").insert({
      member_id: memberId,
      number,
      amount_pennies: 4000,
      issued_on: now.toISOString().slice(0, 10),
      status: "paid",
    });
    // Gated, not unconditional: while payments are stubbed a "paid" result means
    // nothing was charged (GAPS C1), and a receipt for money that never moved is
    // a false record in a member's inbox. Flips on with the Stripe adapter — and
    // because the webhook route will call this same seam, it works there too.
    const { paymentsAreLive } = await import("./adapters/payments");
    if (paymentsAreLive()) {
      await notifyQuietly(memberId, { kind: "payment_receipt", amount: "£40.00", invoice_ref: number });
    }
  } else if (result.kind === "comped") {
    // date-only arithmetic: UTC noon dodges TZ off-by-one at month boundaries
    const d = new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + result.months);
    const until = d.toISOString().slice(0, 10);
    await db.from("members").update({ comped_until: until }).eq("id", memberId);
    // A comp is real whether or not Stripe exists, so this one always sends.
    await notifyQuietly(memberId, { kind: "comp_applied", months: result.months, comped_until: until });
  }
}

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * `/api/stripe/webhook` is the highest-risk new route in this area: it is
 * unauthenticated except for a hand-rolled HMAC check, and a bug here either
 * lets anyone forge a "paid" event or leaves a real failed payment unnoticed.
 * Both are integration-shaped (real signature bytes, real `members` row, real
 * `applyPaymentResult`/`applyPaymentFailure` writes), so this runs against
 * the local Supabase stack rather than mocking the DB — same approach as
 * `tests/unit/resend-webhook.test.ts`.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const KEY = process.env.SUPABASE_SECRET_KEY;
const SECRET = "whsec_test_stripe_secret";

function sign(secret: string, body: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function request(body: string, headers: Record<string, string>) {
  return new Request("http://localhost/api/stripe/webhook", { method: "POST", headers, body }) as never;
}

describe.skipIf(!KEY)("/api/stripe/webhook", () => {
  const db = createClient(URL_, KEY!, { auth: { persistSession: false } });
  const savedSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const ts = Date.now();
  const memberIds: string[] = [];
  const memberEmails: string[] = [];

  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  });

  afterEach(async () => {
    if (savedSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = savedSecret;
    if (memberIds.length) {
      await db.from("invoices").delete().in("member_id", memberIds);
      await db.from("inbox_messages").delete().in("email", memberEmails);
      await db.from("members").delete().in("id", memberIds);
    }
    memberIds.length = 0;
    memberEmails.length = 0;
  });

  async function makeMember(name: string) {
    const email = `${name}@test.local`;
    const { data: member } = await db.from("members")
      .insert({ slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${ts}`, name, status: "active", contact_email: email })
      .select("id").single();
    memberIds.push(member!.id);
    memberEmails.push(email);
    return member!.id;
  }

  it("rejects when STRIPE_WEBHOOK_SECRET is not set", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { client_reference_id: "m1" } } });
    const res = await POST(request(body, { "stripe-signature": sign(SECRET, body) }));
    expect(res.status).toBe(503);
  });

  it("rejects a bad signature", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { client_reference_id: "m1" } } });
    const res = await POST(request(body, { "stripe-signature": "t=1,v1=not-a-real-signature" }));
    expect(res.status).toBe(401);
  });

  it("rejects a stale timestamp (replay protection)", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const staleTs = Math.floor(Date.now() / 1000) - 10 * 60;
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { client_reference_id: "m1" } } });
    const signature = createHmac("sha256", SECRET).update(`${staleTs}.${body}`).digest("hex");
    const res = await POST(request(body, { "stripe-signature": `t=${staleTs},v1=${signature}` }));
    expect(res.status).toBe(401);
  });

  it("checkout.session.completed marks the member paid with an invoice", async () => {
    const memberId = await makeMember(`Stripe Paid ${ts}`);
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { client_reference_id: memberId } } });
    const res = await POST(request(body, { "stripe-signature": sign(SECRET, body) }));
    expect(res.status).toBe(200);

    const { data } = await db.from("members").select("paid_at").eq("id", memberId).single();
    expect(data?.paid_at).not.toBeNull();
    const { data: invoice } = await db.from("invoices").select("status").eq("member_id", memberId).single();
    expect(invoice?.status).toBe("paid");
  });

  it("invoice.payment_failed moves the member to grace with an inbox note", async () => {
    const memberId = await makeMember(`Stripe Failed ${ts}`);
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const body = JSON.stringify({ type: "invoice.payment_failed", data: { object: { metadata: { member_id: memberId } } } });
    const res = await POST(request(body, { "stripe-signature": sign(SECRET, body) }));
    expect(res.status).toBe(200);

    const { data } = await db.from("members").select("status, grace_until").eq("id", memberId).single();
    expect(data?.status).toBe("grace");
    expect(data?.grace_until).not.toBeNull();
    // Found by member_id, not email: a notification has no correspondent and
    // writes an empty email (fix-list 71) — which is also what the console
    // checks before deciding whether a reply form makes sense.
    const { data: inbox } = await db.from("inbox_messages").select("kind, category, email").eq("member_id", memberId).single();
    expect(inbox).toMatchObject({ kind: "payment_failed", category: "notification", email: "" });
  });

  it("checkout.session.completed remembers the subscription and customer ids (GAPS B1.5)", async () => {
    const memberId = await makeMember(`Stripe Sub ${ts}`);
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const body = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { client_reference_id: memberId, subscription: "sub_abc", customer: "cus_abc" } },
    });
    const res = await POST(request(body, { "stripe-signature": sign(SECRET, body) }));
    expect(res.status).toBe(200);

    const { data } = await db.from("members").select("stripe_subscription_id, stripe_customer_id").eq("id", memberId).single();
    expect(data?.stripe_subscription_id).toBe("sub_abc");
    expect(data?.stripe_customer_id).toBe("cus_abc");
  });

  it("customer.subscription.deleted ends the membership with an inbox note", async () => {
    const memberId = await makeMember(`Stripe Ended ${ts}`);
    await db.from("members").update({ cancel_requested_at: new Date().toISOString() }).eq("id", memberId);
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const body = JSON.stringify({ type: "customer.subscription.deleted", data: { object: { metadata: { member_id: memberId } } } });
    const res = await POST(request(body, { "stripe-signature": sign(SECRET, body) }));
    expect(res.status).toBe(200);

    const { data } = await db.from("members").select("status, cancel_requested_at").eq("id", memberId).single();
    expect(data?.status).toBe("lapsed");
    expect(data?.cancel_requested_at).toBeNull();
    const { data: inbox } = await db.from("inbox_messages").select("kind, category").eq("member_id", memberId).single();
    expect(inbox).toMatchObject({ kind: "subscription_ended", category: "notification" });
  });

  it("ignores an event with no member reference rather than throwing", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: {} } });
    const res = await POST(request(body, { "stripe-signature": sign(SECRET, body) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ignored: "no member reference" });
  });
});

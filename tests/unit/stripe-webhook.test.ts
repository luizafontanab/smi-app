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
      // Console notes (payment_taken) carry no email, only the member.
      await db.from("inbox_messages").delete().in("member_id", memberIds);
      await db.from("members").delete().in("id", memberIds);
      for (const id of memberIds) await db.from("jobs").delete().eq("kind", "notify_member").eq("payload->>member_id", id);
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

  // Review finding 7: Stripe retries an event it didn't see a 2xx for, and the
  // retry used to raise a second SMI-JOIN invoice (and receipt).
  it("checkout.session.completed retried for the same session records the payment once", async () => {
    const memberId = await makeMember(`Stripe Replay ${ts}`);
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: `cs_test_replay_${ts}`, client_reference_id: memberId } } });
    expect((await POST(request(body, { "stripe-signature": sign(SECRET, body) }))).status).toBe(200);
    expect((await POST(request(body, { "stripe-signature": sign(SECRET, body) }))).status).toBe(200);

    const { data: invoices } = await db.from("invoices").select("number, stripe_session_id").eq("member_id", memberId);
    expect(invoices).toHaveLength(1);
    expect(invoices?.[0]).toMatchObject({ number: expect.stringMatching(/^SMI-JOIN-/), stripe_session_id: `cs_test_replay_${ts}` });
  });

  // GAPS B1.7: a live card payment used to reach Jas in silence. The note goes
  // once, from whichever of the webhook and the return page records it first.
  it("checkout.session.completed tells Jas once, even when Stripe retries", async () => {
    const memberId = await makeMember(`Stripe Note ${ts}`);
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: `cs_test_note_${ts}`, client_reference_id: memberId } } });
    expect((await POST(request(body, { "stripe-signature": sign(SECRET, body) }))).status).toBe(200);
    expect((await POST(request(body, { "stripe-signature": sign(SECRET, body) }))).status).toBe(200);

    const { data: notes } = await db.from("inbox_messages").select("message").eq("member_id", memberId).eq("kind", "payment_taken");
    expect(notes).toEqual([{ message: "Paid £40/month by card. Next step: build their page." }]);
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

  // #93: a cancel or undo done in Stripe's own dashboard reaches the app as
  // customer.subscription.updated, whose object IS the subscription.
  async function subscribedMember(name: string, fields: { cancel_requested_at?: string | null } = {}) {
    const memberId = await makeMember(name);
    const subscriptionId = `sub_sync_${memberId}`;
    await db.from("members").update({ stripe_subscription_id: subscriptionId, ...fields }).eq("id", memberId);
    return { memberId, subscriptionId };
  }
  function subscriptionUpdated(subscriptionId: string, cancelAtPeriodEnd: boolean, memberId?: string) {
    return JSON.stringify({
      type: "customer.subscription.updated",
      data: { object: { id: subscriptionId, object: "subscription", cancel_at_period_end: cancelAtPeriodEnd, metadata: memberId ? { member_id: memberId } : {} } },
    });
  }
  async function queuedEmails(memberId: string) {
    const { data } = await db.from("jobs").select("payload").eq("kind", "notify_member").eq("payload->>member_id", memberId);
    return (data ?? []).map((j) => (j.payload as { kind?: string }).kind);
  }
  async function pendingCancel(memberId: string) {
    const { data } = await db.from("members").select("status, cancel_requested_at").eq("id", memberId).single();
    return data;
  }

  it("customer.subscription.updated with cancel_at_period_end stamps the pending cancel and queues the scheduled email", async () => {
    const { memberId, subscriptionId } = await subscribedMember(`Stripe Cancel ${ts}`);
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const body = subscriptionUpdated(subscriptionId, true, memberId);
    expect((await POST(request(body, { "stripe-signature": sign(SECRET, body) }))).status).toBe(200);

    const after = await pendingCancel(memberId);
    expect(after?.status).toBe("active");
    expect(after?.cancel_requested_at).not.toBeNull();
    expect(await queuedEmails(memberId)).toEqual(["membership_cancel_requested"]);
  });

  it("customer.subscription.updated without cancel_at_period_end clears a pending cancel and queues the will-continue email", async () => {
    const { memberId, subscriptionId } = await subscribedMember(`Stripe Undo ${ts}`, { cancel_requested_at: new Date().toISOString() });
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const body = subscriptionUpdated(subscriptionId, false, memberId);
    expect((await POST(request(body, { "stripe-signature": sign(SECRET, body) }))).status).toBe(200);

    expect(await pendingCancel(memberId)).toEqual({ status: "active", cancel_requested_at: null });
    expect(await queuedEmails(memberId)).toEqual(["membership_cancel_undone"]);
  });

  it("a repeated customer.subscription.updated changes nothing and queues no second email", async () => {
    const { memberId, subscriptionId } = await subscribedMember(`Stripe Repeat ${ts}`);
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const body = subscriptionUpdated(subscriptionId, true, memberId);
    expect((await POST(request(body, { "stripe-signature": sign(SECRET, body) }))).status).toBe(200);
    const stamped = (await pendingCancel(memberId))?.cancel_requested_at;
    expect(stamped).not.toBeNull();

    expect((await POST(request(body, { "stripe-signature": sign(SECRET, body) }))).status).toBe(200);
    expect((await pendingCancel(memberId))?.cancel_requested_at).toBe(stamped);
    expect(await queuedEmails(memberId)).toEqual(["membership_cancel_requested"]);
  });

  it("Stripe's echo of a console cancel finds the row in sync and sends no second email", async () => {
    const { memberId, subscriptionId } = await subscribedMember(`Stripe Echo ${ts}`);
    const { requestCancellation } = await import("@/lib/membership");
    expect(await requestCancellation(memberId)).toEqual({ ok: true, changed: true }); // stub mode: row only
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const body = subscriptionUpdated(subscriptionId, true, memberId);
    expect((await POST(request(body, { "stripe-signature": sign(SECRET, body) }))).status).toBe(200);

    expect(await queuedEmails(memberId)).toEqual(["membership_cancel_requested"]);
  });

  // B1.6: the member's own id in the subscription metadata is not enough —
  // only the subscription id this site stored counts.
  it("customer.subscription.updated for a subscription that isn't the member's stored one changes nothing", async () => {
    const { memberId } = await subscribedMember(`Stripe Other Sub ${ts}`);
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const body = subscriptionUpdated(`sub_not_ours_${ts}`, true, memberId);
    const res = await POST(request(body, { "stripe-signature": sign(SECRET, body) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ignored: "unknown subscription" });

    expect((await pendingCancel(memberId))?.cancel_requested_at).toBeNull();
    expect(await queuedEmails(memberId)).toEqual([]);
  });

  it("a late customer.subscription.updated never re-stamps a membership that has already ended", async () => {
    const { memberId, subscriptionId } = await subscribedMember(`Stripe Late ${ts}`);
    await db.from("members").update({ status: "lapsed" }).eq("id", memberId);
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const body = subscriptionUpdated(subscriptionId, true, memberId);
    expect((await POST(request(body, { "stripe-signature": sign(SECRET, body) }))).status).toBe(200);

    expect(await pendingCancel(memberId)).toEqual({ status: "lapsed", cancel_requested_at: null });
    expect(await queuedEmails(memberId)).toEqual([]);
  });

  it("ignores an event with no member reference rather than throwing", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: {} } });
    const res = await POST(request(body, { "stripe-signature": sign(SECRET, body) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ignored: "no member reference" });
  });
});

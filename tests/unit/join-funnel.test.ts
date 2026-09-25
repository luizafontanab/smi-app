import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * V13 join funnel — account → pay → draft page → activation, with the
 * console/inbox trail for Jas. Runs against the local Supabase stack.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const KEY = process.env.SUPABASE_SECRET_KEY;

const ts = Date.now();

describe.skipIf(!KEY)("payments stub", () => {
  // Self-seeded: nothing else guarantees these codes exist locally — the seed
  // scripts don't create promo codes, so without this the test only passed
  // against a database an admin had hand-populated.
  const codes = [
    { code: "SMI-FREE-YEAR", months: 12 },
    { code: "SMI-FREE-MONTH", months: 1 },
  ];
  const inserted: string[] = [];

  beforeAll(async () => {
    const db = createClient(URL_, KEY!, { auth: { persistSession: false } });
    for (const { code, months } of codes) {
      const { data: existing } = await db.from("promo_codes").select("id").eq("code", code).maybeSingle();
      if (existing) continue;
      const { data, error } = await db.from("promo_codes").insert({ code, months, active: true }).select("id").single();
      if (error) throw new Error(`could not seed promo code ${code}: ${error.message}`);
      inserted.push(data.id);
    }
  });

  afterAll(async () => {
    if (inserted.length === 0) return;
    const db = createClient(URL_, KEY!, { auth: { persistSession: false } });
    await db.from("promo_codes").delete().in("id", inserted);
  });

  it("maps promo codes to comped months and rejects unknown codes", async () => {
    const { getPayments } = await import("@/lib/adapters/payments");
    expect(await getPayments().createCheckout({ memberId: "m1", email: "a@b.co", companyName: "X", promoCode: "smi-free-year" }))
      .toEqual({ kind: "comped", months: 12 });
    expect(await getPayments().createCheckout({ memberId: "m1", email: "a@b.co", companyName: "X", promoCode: "SMI-FREE-MONTH" }))
      .toEqual({ kind: "comped", months: 1 });
    expect(await getPayments().createCheckout({ memberId: "m1", email: "a@b.co", companyName: "X", promoCode: "NOPE" }))
      .toEqual({ kind: "error", message: "Unknown promo code." });
    expect(await getPayments().createCheckout({ memberId: "m1", email: "a@b.co", companyName: "X" }))
      .toEqual({ kind: "paid" });
  });
});

describe("activation gate (A17)", () => {
  it("blocks a draft going live with nothing on record, and clears once it is", async () => {
    const { activationBlocked } = await import("@/lib/membership");
    const draft = { status: "draft" as const };
    expect(activationBlocked(draft, { status: "active", paid_at: null, comped_until: null }))
      .toMatch(/payment or comp/);
    expect(activationBlocked(draft, { status: "active", paid_at: "2026-08-01T09:30:00Z", comped_until: null })).toBeNull();
    expect(activationBlocked(draft, { status: "active", paid_at: null, comped_until: "2027-08-01" })).toBeNull();
  });

  it("only gates the draft → active transition", async () => {
    const { activationBlocked } = await import("@/lib/membership");
    const bare = { paid_at: null, comped_until: null };
    expect(activationBlocked({ status: "draft" }, { status: "lapsed", ...bare })).toBeNull();
    expect(activationBlocked({ status: "grace" }, { status: "active", ...bare })).toBeNull();
    expect(activationBlocked({ status: "lapsed" }, { status: "active", ...bare })).toBeNull();
  });
});

describe.skipIf(!KEY)("join funnel", () => {
  const db = createClient(URL_, KEY!, { auth: { persistSession: false } });
  const email = `join-test-${ts}@test.local`;

  it("provisionMember creates auth user + draft member + profile + prefs with contact_email", async () => {
    const { provisionMember } = await import("@/lib/membership");
    const result = await provisionMember({ email, password: "local-dev-password", company: `Join Test Ltd ${ts}` });
    expect("memberId" in result).toBe(true);
    if (!("memberId" in result)) return;

    const { data: member } = await db.from("members")
      .select("status, contact_email, paid_at, comped_until, draft_submitted_at, billing_mode")
      .eq("id", result.memberId).single();
    expect(member?.status).toBe("draft");
    expect(member?.contact_email).toBe(email);
    expect(member?.paid_at).toBeNull();
    expect(member?.comped_until).toBeNull();
    expect(member?.draft_submitted_at).toBeNull();

    const { data: profile } = await db.from("profiles").select("role, user_id").eq("member_id", result.memberId).single();
    expect(profile?.role).toBe("member");
    const { data: prefs } = await db.from("notification_prefs").select("member_id").eq("member_id", result.memberId).single();
    expect(prefs).not.toBeNull();
  });

  it("provisionMember rejects a duplicate email without leaving debris", async () => {
    const { provisionMember } = await import("@/lib/membership");
    const result = await provisionMember({ email, password: "local-dev-password", company: "Dupe Ltd" });
    expect("error" in result && /already exists/i.test(result.error)).toBe(true);
    const { count } = await db.from("members").select("*", { count: "exact", head: true }).eq("name", "Dupe Ltd");
    expect(count).toBe(0);
  });

  it("applyPaymentResult(paid) stamps paid_at and raises a paid £40 invoice", async () => {
    const { data: member } = await db.from("members").select("id").eq("contact_email", email).single();
    const { applyPaymentResult } = await import("@/lib/membership");
    await applyPaymentResult(member!.id, { kind: "paid" });

    const { data: after } = await db.from("members").select("paid_at").eq("id", member!.id).single();
    expect(after?.paid_at).not.toBeNull();
    const { data: invoice } = await db.from("invoices")
      .select("amount_pennies, status").eq("member_id", member!.id).single();
    expect(invoice).toMatchObject({ amount_pennies: 4000, status: "paid" });
  });

  it("applyPaymentResult(comped) persists comped_until ≈ today + months", async () => {
    const { provisionMember, applyPaymentResult } = await import("@/lib/membership");
    const result = await provisionMember({
      email: `join-comp-${ts}@test.local`, password: "local-dev-password", company: `Comp Test Ltd ${ts}`,
    });
    if (!("memberId" in result)) throw new Error("provision failed");
    await applyPaymentResult(result.memberId, { kind: "comped", months: 12 });

    const { data: member } = await db.from("members").select("comped_until").eq("id", result.memberId).single();
    const expected = new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`);
    expected.setUTCMonth(expected.getUTCMonth() + 12);
    expect(member?.comped_until).toBe(expected.toISOString().slice(0, 10));
  });

  // The category is what the console filters on (fix-list 71) — a funnel step
  // is a notification, not an enquiry waiting on a reply.
  it("notifyAdminFunnel lands a categorised row in the console inbox", async () => {
    const { notifyAdminFunnel } = await import("@/lib/notify-admin");
    await notifyAdminFunnel({
      category: "notification", kind: "signup_started",
      name: `Funnel Test ${ts}`, email, message: "step reached",
    });
    const { data: row } = await db.from("inbox_messages")
      .select("kind, category, message, read").eq("name", `Funnel Test ${ts}`).single();
    expect(row).toMatchObject({ kind: "signup_started", category: "notification", message: "step reached", read: false });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("requestCancellation (GAPS B1.5) stamps cancel_requested_at in stub mode, idempotently", async () => {
    const name = `Cancel Test Ltd ${ts}`;
    const { data: member } = await db.from("members").insert({
      slug: `cancel-test-${ts}`, name, status: "active", contact_email: `cancel-${ts}@test.local`,
    }).select("id").single();

    const { requestCancellation } = await import("@/lib/membership");
    const first = await requestCancellation(member!.id);
    expect(first).toEqual({ ok: true });

    const { data: after } = await db.from("members").select("status, cancel_requested_at").eq("id", member!.id).single();
    expect(after?.status).toBe("active"); // stays active — cancel-at-period-end, not immediate
    expect(after?.cancel_requested_at).not.toBeNull();

    const second = await requestCancellation(member!.id);
    expect(second).toEqual({ ok: true });
    const { data: unchanged } = await db.from("members").select("cancel_requested_at").eq("id", member!.id).single();
    expect(unchanged?.cancel_requested_at).toBe(after?.cancel_requested_at); // never re-stamped
  });

  it("requestCancellation refuses when live and no stripe_subscription_id is on record", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    const name = `Cancel NoSub Ltd ${ts}`;
    const { data: member } = await db.from("members").insert({
      slug: `cancel-nosub-${ts}`, name, status: "active", contact_email: `cancel-nosub-${ts}@test.local`,
    }).select("id").single();

    const { requestCancellation } = await import("@/lib/membership");
    const result = await requestCancellation(member!.id);

    expect(result).toEqual({ ok: false, error: expect.stringContaining("No active subscription") });
    const { data: after } = await db.from("members").select("cancel_requested_at").eq("id", member!.id).single();
    expect(after?.cancel_requested_at).toBeNull();
  });

  it("comp_expiry sweep moves an expired comp to grace and notes it for Jas", async () => {
    const name = `Expired Comp Ltd ${ts}`;
    const { data: member } = await db.from("members").insert({
      slug: `expired-comp-${ts}`, name, status: "active",
      contact_email: `expired-${ts}@test.local`, comped_until: "2026-01-31",
    }).select("id").single();

    const { enqueue, runDueJobs } = await import("@/lib/jobs");
    await enqueue("comp_expiry");
    await runDueJobs();

    const { data: after } = await db.from("members").select("status, grace_until").eq("id", member!.id).single();
    expect(after?.status).toBe("grace");
    expect(after?.grace_until).toBe("2026-03-02"); // 2026-01-31 + 30 days
    const { data: note } = await db.from("inbox_messages").select("kind, category, message").eq("name", name).single();
    expect(note?.kind).toBe("comp_expired");
    expect(note?.category).toBe("notification"); // fix-list 71 — not an enquiry
    expect(note?.message).toMatch(/comp expired/i);
  });
});

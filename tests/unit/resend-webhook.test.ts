import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * `/api/webhooks/resend` is the highest-risk new route in this area: it is
 * unauthenticated except for a hand-rolled HMAC check, and a bug here either
 * lets anyone forge unsubscribe events or leaves `contacts` silently drifting
 * from what Resend actually did. Both are integration-shaped (real signature
 * bytes, real `contacts` row), so this runs against the local Supabase stack
 * rather than mocking the DB.
 */
// Bigin is an outside service — stub the write-through and assert it was asked.
const { syncContactToCrm } = vi.hoisted(() => ({ syncContactToCrm: vi.fn(async () => {}) }));
vi.mock("@/lib/adapters/crm", () => ({ syncContactToCrm }));

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const KEY = process.env.SUPABASE_SECRET_KEY;
const SECRET = "whsec_dGVzdC13ZWJob29rLXNlY3JldC1iYXNlNjQ=";

function sign(id: string, timestamp: string, body: string): string {
  const key = Buffer.from(SECRET.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${sig}`;
}

function request(body: string, headers: Record<string, string>) {
  return new Request("http://localhost/api/webhooks/resend", { method: "POST", headers, body }) as never;
}

function signedHeaders(body: string, opts?: { id?: string; timestamp?: string }) {
  const id = opts?.id ?? "msg_test";
  const timestamp = opts?.timestamp ?? String(Math.floor(Date.now() / 1000));
  return { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": sign(id, timestamp, body) };
}

describe.skipIf(!KEY)("/api/webhooks/resend", () => {
  const db = createClient(URL_, KEY!, { auth: { persistSession: false } });
  const savedSecret = process.env.RESEND_WEBHOOK_SECRET;
  const emails: string[] = [];

  beforeEach(() => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
  });

  afterEach(async () => {
    if (savedSecret === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET = savedSecret;
    if (emails.length) await db.from("contacts").delete().in("email", emails);
    emails.length = 0;
    syncContactToCrm.mockClear();
  });

  async function makeContact(email: string, opts?: { unsubscribed_at?: string; bounced_at?: string }) {
    emails.push(email);
    await db.from("contacts").insert({ email, subscribed: true, unsubscribed_at: opts?.unsubscribed_at ?? null, bounced_at: opts?.bounced_at ?? null });
  }

  it("rejects when RESEND_WEBHOOK_SECRET is not set", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const { POST } = await import("@/app/api/webhooks/resend/route");
    const body = JSON.stringify({ type: "email.bounced", data: { email: "x@test.local" } });
    const res = await POST(request(body, signedHeaders(body)));
    expect(res.status).toBe(503);
  });

  it("rejects a bad signature", async () => {
    const { POST } = await import("@/app/api/webhooks/resend/route");
    const body = JSON.stringify({ type: "email.bounced", data: { email: "x@test.local" } });
    const res = await POST(request(body, { "svix-id": "msg_1", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,not-a-real-signature" }));
    expect(res.status).toBe(401);
  });

  it("rejects a stale timestamp (replay protection)", async () => {
    const { POST } = await import("@/app/api/webhooks/resend/route");
    const body = JSON.stringify({ type: "email.bounced", data: { email: "x@test.local" } });
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 10 * 60);
    const res = await POST(request(body, signedHeaders(body, { timestamp: staleTimestamp })));
    expect(res.status).toBe(401);
  });

  it("unsubscribes on contact.updated with unsubscribed: true", async () => {
    const email = `webhook-test-${Date.now()}@test.local`;
    await makeContact(email);
    const { POST } = await import("@/app/api/webhooks/resend/route");
    const body = JSON.stringify({ type: "contact.updated", data: { email, unsubscribed: true } });
    const res = await POST(request(body, signedHeaders(body)));
    expect(res.status).toBe(200);

    const { data } = await db.from("contacts").select("id, subscribed, unsubscribed_at").eq("email", email).single();
    expect(data?.subscribed).toBe(false);
    expect(data?.unsubscribed_at).not.toBeNull();
    // …and Bigin is told, so the office's copy of the list agrees (S6)
    expect(syncContactToCrm).toHaveBeenCalledWith(data?.id);
  });

  // Gap review area 7: a hard bounce is its own state, not an unsubscribe.
  it("marks a hard bounce bounced, leaves opt-in state alone and tells Bigin nothing; ignores a soft one", async () => {
    const soft = `webhook-soft-${Date.now()}@test.local`;
    const hard = `webhook-hard-${Date.now()}@test.local`;
    await makeContact(soft);
    await makeContact(hard);
    syncContactToCrm.mockClear();
    const { POST } = await import("@/app/api/webhooks/resend/route");

    const softBody = JSON.stringify({ type: "email.bounced", data: { to: [soft], bounce: { type: "Transient" } } });
    await POST(request(softBody, signedHeaders(softBody, { id: "msg_soft" })));
    const hardBody = JSON.stringify({ type: "email.bounced", data: { to: [hard], bounce: { type: "Permanent" } } });
    await POST(request(hardBody, signedHeaders(hardBody, { id: "msg_hard" })));

    const { data: softRow } = await db.from("contacts").select("subscribed, unsubscribed_at, bounced_at").eq("email", soft).single();
    const { data: hardRow } = await db.from("contacts").select("subscribed, unsubscribed_at, bounced_at").eq("email", hard).single();
    // A full mailbox or a temporary server hiccup must not cost a member their
    // place on the list — only a permanent failure stops mail.
    expect(softRow).toMatchObject({ unsubscribed_at: null, bounced_at: null });
    expect(hardRow?.bounced_at).not.toBeNull();
    expect(hardRow).toMatchObject({ subscribed: true, unsubscribed_at: null });
    expect(syncContactToCrm).not.toHaveBeenCalled();
  });

  it("keeps the first bounce's date", async () => {
    const email = `webhook-rebounce-${Date.now()}@test.local`;
    const first = "2026-01-01T00:00:00+00:00";
    await makeContact(email, { bounced_at: first });
    const { POST } = await import("@/app/api/webhooks/resend/route");
    const body = JSON.stringify({ type: "email.bounced", data: { to: [email], bounce: { type: "Permanent" } } });
    await POST(request(body, signedHeaders(body)));

    const { data } = await db.from("contacts").select("bounced_at").eq("email", email).single();
    expect(new Date(data!.bounced_at!).toISOString()).toBe(new Date(first).toISOString());
  });

  it("never restamps an already-unsubscribed contact", async () => {
    const email = `webhook-restamp-${Date.now()}@test.local`;
    const firstUnsub = "2026-01-01T00:00:00.000Z";
    await makeContact(email, { unsubscribed_at: firstUnsub });
    const { POST } = await import("@/app/api/webhooks/resend/route");
    const body = JSON.stringify({ type: "email.complained", data: { email } });
    await POST(request(body, signedHeaders(body)));

    const { data } = await db.from("contacts").select("unsubscribed_at").eq("email", email).single();
    // Postgres round-trips the timestamptz as "+00:00" rather than the "Z" it
    // was written with — compare instants, not string representations.
    expect(new Date(data!.unsubscribed_at!).getTime()).toBe(new Date(firstUnsub).getTime());
  });
});

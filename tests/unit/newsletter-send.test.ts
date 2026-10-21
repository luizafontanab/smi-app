import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * The newsletter_send job (lib/jobs.ts) used to flip an issue to 'sent'
 * unconditionally (GAPS C3), then — once that was fixed to depend on the
 * sender's result — still had a gap: if the broadcast actually went out but
 * the status write that follows it threw, a retry of the same job would call
 * sendIssue() again with no way to tell "already sent" from "never tried",
 * mailing the whole subscriber list a second time. The fix is an
 * Idempotency-Key derived from the job's own id, so a retry of the SAME job
 * reuses it (Resend dedupes) while a deliberate re-send — a new job — gets a
 * fresh one. This test verifies jobs.ts computes that key correctly; it
 * cannot verify Resend's own dedup behaviour without a live account (see the
 * adapter's own caveat).
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const KEY = process.env.SUPABASE_SECRET_KEY;

describe.skipIf(!KEY)("newsletter_send idempotency", () => {
  const db = createClient(URL_, KEY!, { auth: { persistSession: false } });
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = ["RESEND_API_KEY", "RESEND_SEGMENT_ID", "EMAIL_FROM"] as const;
  let issueId = "";
  let contactEmail = "";
  const jobIds: string[] = [];

  beforeAll(async () => {
    const number = 900_000 + Math.floor(Math.random() * 90_000);
    const { data: issue } = await db.from("newsletter_issues").insert({
      number,
      subject: "Idempotency test issue",
      status: "draft",
      // Approved, since the job refuses anything else (gap review area 4).
      approved_at: new Date().toISOString(),
    }).select("id").single();
    issueId = issue!.id;
    contactEmail = `newsletter-test-${number}@test.local`;
    await db.from("contacts").insert({ email: contactEmail, subscribed: true });
  });

  afterAll(async () => {
    if (issueId) await db.from("newsletter_issues").delete().eq("id", issueId);
    if (contactEmail) await db.from("contacts").delete().eq("email", contactEmail);
    for (const id of jobIds) await db.from("jobs").delete().eq("id", id);
  });

  beforeEach(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_SEGMENT_ID = "seg_test";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.restoreAllMocks();
  });

  it("reuses the same Idempotency-Key when the same job is retried, and a new one for a deliberate re-send", async () => {
    const seenKeys: (string | null)[] = [];
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("api.resend.com/broadcasts")) {
        const headers = new Headers(init?.headers);
        seenKeys.push(headers.get("Idempotency-Key"));
        return new Response('{"id":"broadcast_test"}', { status: 200 });
      }
      // Supabase's own client uses global fetch for every REST call — only the
      // Resend calls above are what this test is about.
      return realFetch(input, init);
    });

    vi.resetModules();
    const { enqueue, runJobById } = await import("@/lib/jobs");

    await enqueue("newsletter_send", { issue_id: issueId });
    const { data: job1 } = await db.from("jobs").select("id").eq("kind", "newsletter_send")
      .eq("status", "pending").order("created_at", { ascending: false }).limit(1).single();
    jobIds.push(job1!.id);

    // Targeted rather than runDueJobs()'s table-wide sweep, which would race
    // against any other test file's pending jobs on this same local stack.
    await runJobById(job1!.id);
    const { data: afterFirst } = await db.from("newsletter_issues").select("status").eq("id", issueId).single();
    expect(afterFirst?.status).toBe("sent");
    expect(seenKeys).toHaveLength(1);
    expect(seenKeys[0]).toBe(`newsletter-${job1!.id}`);

    // Simulate: the broadcast succeeded but the status write that follows it
    // never landed (crash/network blip), so the issue is still not 'sent',
    // and the runner retries the SAME job.
    await db.from("newsletter_issues").update({ status: "draft" }).eq("id", issueId);
    await db.from("jobs").update({ status: "pending", due_at: new Date().toISOString() }).eq("id", job1!.id);
    await runJobById(job1!.id);

    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[1]).toBe(seenKeys[0]); // same job → same key, so Resend can dedupe

    // A deliberate re-send (the console's "Try again") enqueues a brand new
    // job, which must NOT reuse the previous key — it should actually resend.
    await db.from("newsletter_issues").update({ status: "draft" }).eq("id", issueId);
    await enqueue("newsletter_send", { issue_id: issueId });
    const { data: job2 } = await db.from("jobs").select("id").eq("kind", "newsletter_send")
      .eq("status", "pending").order("created_at", { ascending: false }).limit(1).single();
    jobIds.push(job2!.id);
    await runJobById(job2!.id);

    expect(seenKeys).toHaveLength(3);
    expect(seenKeys[2]).not.toBe(seenKeys[0]);
    expect(seenKeys[2]).toBe(`newsletter-${job2!.id}`);
  });

  it("marks the issue send_failed, not sent, when the provider rejects the broadcast", async () => {
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("api.resend.com/broadcasts")) return new Response("domain not verified", { status: 403 });
      return realFetch(input, init);
    });

    vi.resetModules();
    const { enqueue, runJobById } = await import("@/lib/jobs");
    await db.from("newsletter_issues").update({ status: "draft" }).eq("id", issueId);
    await enqueue("newsletter_send", { issue_id: issueId });
    const { data: job } = await db.from("jobs").select("id").eq("kind", "newsletter_send")
      .eq("status", "pending").order("created_at", { ascending: false }).limit(1).single();
    jobIds.push(job!.id);

    await runJobById(job!.id);

    const { data: issue } = await db.from("newsletter_issues").select("status, send_error").eq("id", issueId).single();
    // GAPS C3: must never land on "sent" for a send that didn't happen.
    expect(issue?.status).toBe("send_failed");
    expect(issue?.send_error).toContain("403");
    // A failed send to the whole list must dead-letter, not vanish.
    const { data: failedJob } = await db.from("jobs").select("status, last_error").eq("id", job!.id).single();
    expect(failedJob?.status === "dead" || failedJob?.status === "pending").toBe(true);
  });

  it("refuses an unapproved issue: send_failed, and nothing reaches Resend", async () => {
    const broadcasts: string[] = [];
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("api.resend.com")) {
        broadcasts.push(url);
        return new Response('{"id":"broadcast_test"}', { status: 200 });
      }
      return realFetch(input, init);
    });

    vi.resetModules();
    const { enqueue, runJobById } = await import("@/lib/jobs");
    await db.from("newsletter_issues").update({ status: "draft", approved_at: null }).eq("id", issueId);
    await enqueue("newsletter_send", { issue_id: issueId });
    const { data: job } = await db.from("jobs").select("id").eq("kind", "newsletter_send")
      .eq("status", "pending").order("created_at", { ascending: false }).limit(1).single();
    jobIds.push(job!.id);

    await runJobById(job!.id);

    const { data: issue } = await db.from("newsletter_issues").select("status, send_error").eq("id", issueId).single();
    expect(issue?.status).toBe("send_failed");
    expect(issue?.send_error).toContain("Not approved");
    expect(broadcasts).toEqual([]);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * The member-notification path end to end: enqueue → job runs → notification
 * row → real email. Runs against the local Supabase stack and Mailpit.
 *
 * Worth an integration test rather than more mocking, because the two things
 * that used to be wrong here were both integration-shaped: the send was never
 * checked for success, and `notifications.emailed_at` was declared but written
 * by nothing, so there was no record of what actually went out.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const KEY = process.env.SUPABASE_SECRET_KEY;
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:56324";

describe.skipIf(!KEY)("notify_member", () => {
  const db = createClient(URL_, KEY ?? "skipped", { auth: { persistSession: false } });
  const email = `notify-test-${Date.now()}@test.local`;
  let memberId = "";
  const created: string[] = [];

  beforeAll(async () => {
    const { data } = await db.from("members").insert({
      slug: `notify-test-${Date.now().toString(36)}`,
      name: "Notify Test Ltd",
      status: "draft",
      contact_email: email,
    }).select("id").single();
    memberId = data!.id;
    // The local Postgres regularly takes several seconds per statement; the
    // 5s default turns that into a flake rather than a failure worth reading.
  });

  afterAll(async () => {
    if (memberId) await db.from("members").delete().eq("id", memberId);
    for (const id of created) {
      await fetch(`${MAILPIT}/api/v1/messages`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IDs: [id] }),
      });
    }
  });

  it("writes the notification, sends the email and stamps emailed_at", async () => {
    const { enqueue, runJobById } = await import("@/lib/jobs");
    await enqueue("notify_member", {
      member_id: memberId,
      kind: "advert_ending_soon",
      booking_id: "booking-under-test",
      ends_on: "2026-09-30",
    });
    // Targeted rather than runDueJobs()'s table-wide sweep, which would race
    // against any other test file's pending jobs on this same local stack.
    const { data: job } = await db.from("jobs").select("id").eq("kind", "notify_member")
      .eq("status", "pending").order("created_at", { ascending: false }).limit(1).single();
    await runJobById(job!.id);

    const { data: note } = await db
      .from("notifications")
      .select("kind, emailed_at")
      .eq("member_id", memberId)
      .single();
    expect(note?.kind).toBe("advert_ending_soon");
    // The column existed unused before this — a send with no record of it is
    // indistinguishable from no send at all.
    expect(note?.emailed_at).not.toBeNull();

    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const found = (await res.json()) as { messages?: { ID: string; Subject: string }[] };
    const message = found.messages?.[0];
    created.push(...(found.messages ?? []).map((m) => m.ID));

    expect(message).toBeDefined();
    // The kind-specific subject, not the "Update from SMI" fallback.
    expect(message!.Subject).toBe("Your advert run ends soon");

    const body = await fetch(`${MAILPIT}/api/v1/message/${message!.ID}`).then((r) => r.json()) as { Text: string; HTML: string };
    expect(body.Text).toContain("2026-09-30");
    // Deep-links to the renewal form: "log in and renew" was previously advice
    // with no reachable path (GAPS A2.5).
    expect(body.Text).toContain("/dashboard/advert/booking-under-test");
    expect(body.HTML).toContain("Sheet Metal");
  }, 120_000);

  it("does not duplicate the notification or the email if the same job runs again", async () => {
    // Regression test for the bug this job used to have: insert the
    // notification, send, THEN stamp emailed_at as three separate steps meant
    // a job that ran again after already sending (e.g. the runner retrying it
    // for an unrelated reason) had no way to tell it had already gone out —
    // it inserted a second row and mailed the member twice.
    const { enqueue, runJobById } = await import("@/lib/jobs");
    await enqueue("notify_member", {
      member_id: memberId,
      kind: "advert_ending_soon",
      booking_id: "retry-test-booking",
      ends_on: "2026-10-01",
    });
    const { data: jobRow } = await db
      .from("jobs")
      .select("id")
      .eq("kind", "notify_member")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(jobRow).toBeTruthy();

    await runJobById(jobRow!.id);
    // Put the same job back in front of the runner, as if it were being
    // retried — this is the exact scenario the job_id-keyed lookup exists for.
    await db.from("jobs").update({ status: "pending", due_at: new Date().toISOString() }).eq("id", jobRow!.id);
    await runJobById(jobRow!.id);

    const { data: notes } = await db.from("notifications").select("id, emailed_at").eq("job_id", jobRow!.id);
    expect(notes).toHaveLength(1);
    expect(notes![0].emailed_at).not.toBeNull();

    // The previous test also mails this same address, with the same subject —
    // so identify this test's message(s) by its distinct ends_on date rather
    // than by subject or recipient alone.
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const found = (await res.json()) as { messages?: { ID: string }[] };
    created.push(...(found.messages ?? []).map((m) => m.ID));
    const bodies = await Promise.all(
      (found.messages ?? []).map((m) => fetch(`${MAILPIT}/api/v1/message/${m.ID}`).then((r) => r.json() as Promise<{ Text: string }>)),
    );
    expect(bodies.filter((b) => b.Text.includes("2026-10-01"))).toHaveLength(1);
  }, 120_000);
});

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
  const db = createClient(URL_, KEY!, { auth: { persistSession: false } });
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
    const { enqueue, runDueJobs } = await import("@/lib/jobs");
    await enqueue("notify_member", {
      member_id: memberId,
      kind: "advert_ending_soon",
      booking_id: "booking-under-test",
      ends_on: "2026-09-30",
    });
    await runDueJobs();

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
});

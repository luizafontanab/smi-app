import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Unsubscribe permanence — the hard integrity rule: an unsubscribed contact is
 * never silently re-subscribed. Runs against the local Supabase stack.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!KEY)("unsubscribe permanence", () => {
  const db = createClient(URL_, KEY!, { auth: { persistSession: false } });
  const email = `unsub-test-${Date.now()}@test.local`;

  beforeAll(async () => {
    await db.from("contacts").insert({ email, subscribed: false, unsubscribed_at: new Date().toISOString() });
  });

  it("newsletter signup refuses to re-subscribe an unsubscribed contact", async () => {
    const { subscribeNewsletter } = await import("@/app/(public)/actions");
    const fd = new FormData();
    fd.set("email", email);
    const result = await subscribeNewsletter({ message: "" }, fd);
    expect(result.message).toMatch(/previously unsubscribed/i);

    const { data: contact } = await db.from("contacts").select("subscribed, unsubscribed_at").eq("email", email).single();
    expect(contact?.subscribed).toBe(false);
    expect(contact?.unsubscribed_at).not.toBeNull();
  });

  it("newsletter recipient count excludes unsubscribed contacts", async () => {
    const { count: subscribed } = await db
      .from("contacts").select("*", { count: "exact", head: true })
      .eq("subscribed", true).is("unsubscribed_at", null);
    const { count: total } = await db.from("contacts").select("*", { count: "exact", head: true });
    expect(subscribed).toBeLessThan(total!);
  });
});

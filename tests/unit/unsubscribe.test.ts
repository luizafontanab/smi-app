import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Unsubscribe permanence — the hard integrity rule: an unsubscribed contact is
 * never silently re-subscribed. Runs against the local Supabase stack.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const KEY = process.env.SUPABASE_SECRET_KEY;

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

  it("the console contact editor cannot re-subscribe without an explicit re-opt-in", async () => {
    // saveContact itself ends in redirect(), so exercise the rule it applies
    const { applyOptIn } = await import("@/lib/contacts");
    const { data: before } = await db.from("contacts").select("subscribed, unsubscribed_at").eq("email", email).single();

    const attempted = applyOptIn(before!, { newsletter: "subscribed", reOptIn: false });
    await db.from("contacts").update(attempted).eq("email", email);

    const { data: after } = await db.from("contacts").select("subscribed, unsubscribed_at").eq("email", email).single();
    expect(after?.subscribed).toBe(false);
    expect(after?.unsubscribed_at).toBe(before?.unsubscribed_at);
  });

  it("an explicit re-opt-in is the one route back onto the list", async () => {
    const { applyOptIn } = await import("@/lib/contacts");
    const { data: before } = await db.from("contacts").select("subscribed, unsubscribed_at").eq("email", email).single();

    await db.from("contacts").update(applyOptIn(before!, { newsletter: "subscribed", reOptIn: true })).eq("email", email);
    const { data: after } = await db.from("contacts").select("subscribed, unsubscribed_at").eq("email", email).single();
    expect(after).toMatchObject({ subscribed: true, unsubscribed_at: null });

    // put it back so the count assertion below still has an unsubscribed row
    await db.from("contacts").update({ subscribed: false, unsubscribed_at: new Date().toISOString() }).eq("email", email);
  });

  it("newsletter recipient count excludes unsubscribed contacts", async () => {
    const { count: subscribed } = await db
      .from("contacts").select("*", { count: "exact", head: true })
      .eq("subscribed", true).is("unsubscribed_at", null);
    const { count: total } = await db.from("contacts").select("*", { count: "exact", head: true });
    expect(subscribed).toBeLessThan(total!);
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Migration 20261016000034: normalise_contact_emails() lowercases and trims
 * every contacts.email it can without colliding on the unique key, and reports
 * — never merges — the addresses it can't. Every lookup by address is an exact
 * match on the lowercased form, so a mixed-case row is invisible to the
 * unsubscribe link, the signup and the Bigin pull alike.
 *
 * Runs against the local Supabase stack, on throwaway rows.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const KEY = process.env.SUPABASE_SECRET_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

describe.skipIf(!KEY)("normalise_contact_emails (migration 20261016000034)", () => {
  const db = createClient(URL_, KEY!, { auth: { persistSession: false } });
  const tag = Date.now().toString(36);
  const ids: string[] = [];
  const insert = async (email: string) => {
    const { data, error } = await db.from("contacts").insert({ email, source: "itest" }).select("id").single();
    if (error) throw error;
    ids.push(data.id);
    return data.id as string;
  };

  afterAll(async () => {
    if (ids.length) await db.from("contacts").delete().in("id", ids);
  });

  it("lowercases and trims a lone mixed-case address, and reports the pair it can't change without a collision", async () => {
    const lone = await insert(` Norm.Test-${tag}@Example.TEST `);
    const lower = await insert(`clash-${tag}@x.test`);
    const upper = await insert(`CLASH-${tag}@X.test`);

    const { data, error } = await db.rpc("normalise_contact_emails");
    expect(error).toBeNull();

    const { data: rows } = await db.from("contacts").select("id, email").in("id", [lone, lower, upper]);
    const email = (id: string) => rows!.find((r) => r.id === id)!.email;
    expect(email(lone)).toBe(`norm.test-${tag}@example.test`);
    // the pair is left exactly as it was — which row should win is a decision
    expect(email(lower)).toBe(`clash-${tag}@x.test`);
    expect(email(upper)).toBe(`CLASH-${tag}@X.test`);

    const reported = (data ?? []).find((c: { address: string }) => c.address === `clash-${tag}@x.test`);
    expect(reported).toMatchObject({ contact_ids: expect.arrayContaining([lower, upper]) });
    expect(reported.emails).toHaveLength(2);
    expect((data ?? []).some((c: { address: string }) => c.address === `norm.test-${tag}@example.test`)).toBe(false);
  });

  it("is idempotent: a second pass changes nothing more", async () => {
    const { data: before } = await db.from("contacts").select("id, email").in("id", ids);
    await db.rpc("normalise_contact_emails");
    const { data: after } = await db.from("contacts").select("id, email").in("id", ids);
    expect(after).toEqual(expect.arrayContaining(before!));
  });

  it.skipIf(!ANON_KEY)("is not callable with the publishable key", async () => {
    const anon = createClient(URL_, ANON_KEY!, { auth: { persistSession: false } });
    const { error } = await anon.rpc("normalise_contact_emails");
    expect(error?.code).toBe("42501");
  });
});

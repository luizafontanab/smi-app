import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

/**
 * members_in_taxonomies (migration 20261016000040) — the directory's taxonomy
 * filters, matched in the database instead of as a member-id list in the URL
 * (review, 16 Oct). The mocked queries.test.ts can only check what is sent;
 * this checks what the function answers, through the anon key the public
 * directory uses, so RLS is part of the result.
 *
 * Fixture (own industries/services/types, so the seed doesn't matter):
 *   A  active  industries i1       services s1   types —
 *   B  active  industries i1, i2   services s2   types t1
 *   C  active  industries i2       services —    types t1
 *   D  draft   industries i1       (hidden from the public by members RLS)
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

describe.skipIf(!ANON_KEY || !SECRET_KEY)("members_in_taxonomies", () => {
  const admin = createClient<Database>(URL_, SECRET_KEY ?? "skipped", { auth: { persistSession: false } });
  const anon = createClient<Database>(URL_, ANON_KEY ?? "skipped", { auth: { persistSession: false } });
  const tag = `mit-${Date.now().toString(36)}`;
  const slug = (s: string) => `${tag}-${s}`;
  const ids = { members: [] as string[], industries: [] as number[], services: [] as number[], types: [] as number[] };

  beforeAll(async () => {
    const { data: industries } = await admin.from("industries")
      .insert([{ slug: slug("i1"), name: `${tag} I1` }, { slug: slug("i2"), name: `${tag} I2` }]).select("id, slug").throwOnError();
    const { data: services } = await admin.from("services")
      .insert([{ slug: slug("s1"), name: `${tag} S1` }, { slug: slug("s2"), name: `${tag} S2` }]).select("id, slug").throwOnError();
    const { data: types } = await admin.from("membership_types")
      .insert([{ slug: slug("t1"), name: `${tag} T1` }]).select("id, slug").throwOnError();
    const { data: members } = await admin.from("members")
      .insert([
        { slug: slug("a"), name: `${tag} A`, status: "active" },
        { slug: slug("b"), name: `${tag} B`, status: "active" },
        { slug: slug("c"), name: `${tag} C`, status: "active" },
        { slug: slug("d"), name: `${tag} D`, status: "draft" },
      ]).select("id, slug").throwOnError();
    ids.industries = industries!.map((r) => r.id);
    ids.services = services!.map((r) => r.id);
    ids.types = types!.map((r) => r.id);
    ids.members = members!.map((r) => r.id);
    const [i1, i2] = ids.industries;
    const [s1, s2] = ids.services;
    const [t1] = ids.types;
    const [a, b, c, d] = ids.members;
    await admin.from("member_industries").insert([
      { member_id: a, industry_id: i1 }, { member_id: b, industry_id: i1 }, { member_id: b, industry_id: i2 },
      { member_id: c, industry_id: i2 }, { member_id: d, industry_id: i1 },
    ]).throwOnError();
    await admin.from("member_services").insert([{ member_id: a, service_id: s1 }, { member_id: b, service_id: s2 }]).throwOnError();
    await admin.from("member_membership_types").insert([{ member_id: b, membership_type_id: t1 }, { member_id: c, membership_type_id: t1 }]).throwOnError();
  });

  afterAll(async () => {
    // join rows cascade with their member (and with services/types)
    if (ids.members.length) await admin.from("members").delete().in("id", ids.members);
    if (ids.industries.length) await admin.from("industries").delete().in("id", ids.industries);
    if (ids.services.length) await admin.from("services").delete().in("id", ids.services);
    if (ids.types.length) await admin.from("membership_types").delete().in("id", ids.types);
  });

  /** Which fixture members (by letter) the public directory query returns. */
  async function names(args: Database["public"]["Functions"]["members_in_taxonomies"]["Args"]) {
    const { data, error } = await anon.rpc("members_in_taxonomies", args).select("name").like("name", `${tag} %`).order("name");
    expect(error).toBeNull();
    return (data ?? []).map((m) => m.name.slice(-1));
  }

  it("ORs the slugs within an axis", async () => {
    expect(await names({ p_industries: [slug("i1"), slug("i2")] })).toEqual(["A", "B", "C"]);
  });

  it("ANDs the axes", async () => {
    expect(await names({ p_industries: [slug("i1")], p_membership_types: [slug("t1")] })).toEqual(["B"]);
    expect(await names({ p_industries: [slug("i2")], p_services: [slug("s1")] })).toEqual([]);
  });

  it("matches every industry a member is in, not only a primary", async () => {
    expect(await names({ p_industries: [slug("i2")] })).toEqual(["B", "C"]);
  });

  it("doesn't filter on an axis left out, and matches nothing for an empty one", async () => {
    expect(await names({})).toEqual(["A", "B", "C"]);
    expect(await names({ p_services: [] })).toEqual([]);
    expect(await names({ p_industries: [slug("no-such-industry")] })).toEqual([]);
  });

  it("keeps the public's members RLS — a draft member never appears", async () => {
    expect(await names({ p_industries: [slug("i1")] })).toEqual(["A", "B"]);
  });

  it("supports the directory's embed and an exact count on its rows", async () => {
    const { data, count, error } = await anon
      .rpc("members_in_taxonomies", { p_industries: [slug("i1")] }, { count: "exact" })
      .select("slug, industry:industries!members_industry_id_fkey(slug, name)")
      .eq("status", "active")
      .like("name", `${tag} %`);
    expect(error).toBeNull();
    expect(count).toBe(2);
    expect(data?.[0]).toHaveProperty("industry", null);
  });
});

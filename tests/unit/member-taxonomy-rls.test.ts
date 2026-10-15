import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Migration 20261016000031: the three member ↔ taxonomy join tables are
 * readable by anon only for members anon can see (active/grace, not archived —
 * public_read_active_members). They were `using (true)`, which listed the
 * industries, services and membership types of draft, lapsed and archived
 * members to anyone with the publishable key.
 *
 * One throwaway member, walked through the states that matter, with a link in
 * each table. Runs against the local Supabase stack.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const JOINS = ["member_industries", "member_services", "member_membership_types"] as const;

describe.skipIf(!ANON_KEY || !SECRET_KEY)("member taxonomy links follow member visibility (migration 20261016000031)", () => {
  const service = createClient(URL_, SECRET_KEY!, { auth: { persistSession: false } });
  const anon = createClient(URL_, ANON_KEY!, { auth: { persistSession: false } });
  let memberId = "";

  /** Which join tables anon can see this member's link in. */
  const visibleTo = async () => {
    const seen: string[] = [];
    for (const table of JOINS) {
      const { data, error } = await anon.from(table).select("member_id").eq("member_id", memberId);
      expect(error).toBeNull();
      if (data?.length) seen.push(table);
    }
    return seen;
  };
  const setMember = async (patch: { status?: "draft" | "active" | "grace" | "lapsed"; archived_at?: string | null }) => {
    const { error } = await service.from("members").update(patch).eq("id", memberId);
    expect(error).toBeNull();
  };

  beforeAll(async () => {
    const tag = Date.now().toString(36);
    const { data: member, error } = await service
      .from("members")
      .insert({ slug: `rls-taxonomy-test-${tag}`, name: "RLS Taxonomy Test Ltd", status: "draft" })
      .select("id")
      .single();
    if (error) throw error;
    memberId = member.id;
    const [{ data: industry }, { data: svc }, { data: type }] = await Promise.all([
      service.from("industries").select("id").limit(1).single(),
      service.from("services").select("id").limit(1).single(),
      service.from("membership_types").select("id").limit(1).single(),
    ]);
    for (const [table, row] of [
      ["member_industries", { member_id: memberId, industry_id: industry!.id }],
      ["member_services", { member_id: memberId, service_id: svc!.id }],
      ["member_membership_types", { member_id: memberId, membership_type_id: type!.id }],
    ] as const) {
      const { error: linkError } = await service.from(table).insert(row as never);
      if (linkError) throw linkError;
    }
  });

  afterAll(async () => {
    // cascades to all three join tables
    if (memberId) await service.from("members").delete().eq("id", memberId);
  });

  it("hides a draft member's links from anon", async () => {
    await setMember({ status: "draft", archived_at: null });
    expect(await visibleTo()).toEqual([]);
  });

  it("hides a lapsed member's links from anon", async () => {
    await setMember({ status: "lapsed", archived_at: null });
    expect(await visibleTo()).toEqual([]);
  });

  it("shows an active member's links — the directory filter and profile still work", async () => {
    await setMember({ status: "active", archived_at: null });
    expect(await visibleTo()).toEqual([...JOINS]);
  });

  it("shows a member in grace, like the members policy does", async () => {
    await setMember({ status: "grace", archived_at: null });
    expect(await visibleTo()).toEqual([...JOINS]);
  });

  it("hides an archived member's links even while active", async () => {
    await setMember({ status: "active", archived_at: new Date().toISOString() });
    expect(await visibleTo()).toEqual([]);
  });

  it("keeps the profile page's embed working for a visible member", async () => {
    await setMember({ status: "active", archived_at: null });
    // memberBySlug's embed (src/lib/queries.ts), cut down to the join tables
    const { data, error } = await anon
      .from("members")
      .select("id, member_membership_types(membership_type:membership_types(slug)), member_services(service:services(slug))")
      .eq("id", memberId)
      .single();
    expect(error).toBeNull();
    expect(data!.member_services).toHaveLength(1);
    expect(data!.member_membership_types).toHaveLength(1);
  });

  it("the service role still sees every link, whatever the member's state", async () => {
    await setMember({ status: "draft", archived_at: null });
    for (const table of JOINS) {
      const { data } = await service.from(table).select("member_id").eq("member_id", memberId);
      expect(data, table).toHaveLength(1);
    }
  });
});

/**
 * Migration 20261016000032 revoked story_summary from PUBLIC and pinned its
 * search_path. It is a computed field on every story card, so anon must still
 * be able to execute it — this is the regression that revoke could cause.
 */
describe.skipIf(!ANON_KEY)("story_summary stays readable by anon (migration 20261016000032)", () => {
  it("serves excerpt:story_summary on a published story to the publishable key", async () => {
    const anon = createClient(URL_, ANON_KEY!, { auth: { persistSession: false } });
    const { data, error } = await anon.from("stories").select("slug, excerpt:story_summary").eq("status", "published").limit(3);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });
});

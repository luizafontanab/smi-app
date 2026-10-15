import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Locks in migration 20261016000060: a member holding their own access token
 * and the public publishable key cannot insert content rows directly. Every
 * row below would have passed the dropped policies (own member_id, the
 * statuses they required), so a 42501 here is the policy being gone, not a
 * malformed row. Runs against the local Supabase stack.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

describe.skipIf(!ANON_KEY || !SECRET_KEY)("member insert lockdown (migration 20261016000060)", () => {
  const service = createClient(URL_, SECRET_KEY!, { auth: { persistSession: false } });
  const tag = `ins-${Date.now()}`;
  const email = `${tag}@test.local`;
  const password = `pw-${tag}-Aa1!`;
  let memberId = "";
  let userId = "";
  let asMember: SupabaseClient;

  beforeAll(async () => {
    const { data: member, error: memberError } = await service.from("members")
      .insert({ name: `${tag} Ltd`, slug: tag, status: "active" }).select("id").single();
    if (memberError) throw memberError;
    memberId = member.id;
    const { data: created, error: userError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (userError) throw userError;
    userId = created.user.id;
    const { error: profileError } = await service.from("profiles").insert({ user_id: userId, role: "member", member_id: memberId });
    if (profileError) throw profileError;
    asMember = createClient(URL_, ANON_KEY!, { auth: { persistSession: false } });
    const { error: signInError } = await asMember.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;
  });

  afterAll(async () => {
    // Nothing should have been written; clean up by member in case a policy came back.
    for (const table of ["stories", "events", "videos", "member_revisions", "visibility_requests"] as const) {
      await service.from(table).delete().eq("member_id", memberId);
    }
    if (userId) await service.auth.admin.deleteUser(userId);
    if (memberId) await service.from("members").delete().eq("id", memberId);
  });

  const rows = () => ({
    stories: { title: `${tag} story`, slug: `${tag}-story`, member_id: memberId, source: "member", status: "awaiting_approval", body: "<p>x</p>" },
    events: { title: `${tag} event`, slug: `${tag}-event`, starts_on: "2027-01-01", member_id: memberId, source: "member", status: "awaiting_approval" },
    videos: { title: `${tag} video`, slug: `${tag}-video`, url: "https://www.youtube.com/watch?v=x", member_id: memberId, source: "member", status: "awaiting_approval" },
    // The shape that made decideRevision dangerous: account columns, not profile ones.
    member_revisions: { member_id: memberId, payload: { status: "active", billing_mode: "invoice", paid_at: "2099-01-01T00:00:00Z" } },
    visibility_requests: { member_id: memberId, product: "x" },
  });

  for (const table of ["stories", "events", "videos", "member_revisions", "visibility_requests"] as const) {
    it(`refuses a member-session insert into ${table}`, async () => {
      const { data, error } = await asMember.from(table).insert(rows()[table] as Record<string, unknown>).select("id");
      expect(data).toBeNull();
      expect(error?.code).toBe("42501");
      const { count } = await service.from(table).select("id", { count: "exact", head: true }).eq("member_id", memberId);
      expect(count).toBe(0);
    });
  }

  it("still lets the member read their own revisions (read policies are untouched)", async () => {
    const { error } = await asMember.from("member_revisions").select("id").eq("member_id", memberId);
    expect(error).toBeNull();
  });
});

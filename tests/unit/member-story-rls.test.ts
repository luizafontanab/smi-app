import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Locks in migration 20261016000020: with their own access token and the
 * public publishable key, a member reads what they wrote and what is
 * published about them — never the desk's unpublished work about them. The
 * app never reads `stories` with a member session, so this is the only test
 * of the policy. Runs against the local Supabase stack.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

describe.skipIf(!ANON_KEY || !SECRET_KEY)("member_read_own_stories (migration 20261016000020)", () => {
  const service = createClient(URL_, SECRET_KEY!, { auth: { persistSession: false } });
  const tag = `rls-${Date.now()}`;
  const email = `${tag}@test.local`;
  const password = `pw-${tag}-Aa1!`;
  let memberId = "";
  let userId = "";
  let asMember: SupabaseClient;
  const stories: Record<string, string> = {};

  // Every row names the member as its subject; only who wrote it and its state differ.
  const ROWS = {
    ownDraft: { status: "draft", source: "member", member_draft: true },
    ownWaiting: { status: "awaiting_approval", source: "member" },
    ownSentBack: { status: "rejected", source: "member" },
    ownWithdrawn: { status: "withdrawn", source: "member" },
    ownScheduled: { status: "scheduled", source: "member" },
    ownReturnedToDraft: { status: "draft", source: "member", member_draft: false },
    deskDraft: { status: "draft", source: "admin" },
    deskWaiting: { status: "awaiting_approval", source: "admin" },
    deskScheduled: { status: "scheduled", source: "admin" },
    deskPublished: { status: "published", source: "admin" },
  } as const;

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
    for (const [key, row] of Object.entries(ROWS)) {
      const { data, error } = await service.from("stories")
        .insert({ title: `${tag} ${key}`, slug: `${tag}-${key}`, member_id: memberId, ...row }).select("id").single();
      if (error) throw error;
      stories[key] = data.id;
    }
    asMember = createClient(URL_, ANON_KEY!, { auth: { persistSession: false } });
    const { error: signInError } = await asMember.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;
  });

  afterAll(async () => {
    await service.from("stories").delete().in("id", Object.values(stories));
    if (userId) await service.auth.admin.deleteUser(userId);
    if (memberId) await service.from("members").delete().eq("id", memberId);
  });

  it("reads what they wrote — draft, waiting, sent back, withdrawn — and what is published about them; nothing else", async () => {
    const { data, error } = await asMember.from("stories").select("id").eq("member_id", memberId);
    expect(error).toBeNull();
    const seen = new Set((data ?? []).map((r) => r.id));
    const visible = Object.keys(ROWS).filter((key) => seen.has(stories[key])).sort();
    expect(visible).toEqual(["deskPublished", "ownDraft", "ownSentBack", "ownWaiting", "ownWithdrawn"].sort());
  });

  it("cannot read the desk's unpublished story about them even by id, body included", async () => {
    for (const key of ["deskDraft", "deskWaiting", "deskScheduled", "ownScheduled", "ownReturnedToDraft"]) {
      const { data } = await asMember.from("stories").select("id, body").eq("id", stories[key]);
      expect(data, key).toEqual([]);
    }
  });

  it("anon still sees only what is published", async () => {
    const anon = createClient(URL_, ANON_KEY!, { auth: { persistSession: false } });
    const { data } = await anon.from("stories").select("id").eq("member_id", memberId);
    expect((data ?? []).map((r) => r.id)).toEqual([stories.deskPublished]);
  });
});

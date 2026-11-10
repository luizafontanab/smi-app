import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { parseRevisionPayload, revisionChanges, REVISION_FIELD_LABELS } from "@/app/console/member-revision";
import { ownCompanyPageValuesFromForm } from "@/lib/member-form";

const M = "11111111-1111-1111-1111-111111111111";

describe("parseRevisionPayload", () => {
  it("keeps exactly the fields the member's own profile form writes", () => {
    // The allowlist must cover what the member's own save produces — if the
    // form grows a field, a member's edit to it would otherwise be dropped.
    // And no more: that save writes no industry, so neither does a revision.
    const fd = new FormData();
    fd.set("name", "Acme");
    const parsed = ownCompanyPageValuesFromForm(fd, { slug: "acme", status: "active", social: {} }, { logo_path: `members/${M}/a1.png`, hero_path: `members/${M}/b2.png` });
    if ("error" in parsed) throw new Error(parsed.error);
    expect(Object.keys(parsed.values).sort()).toEqual(Object.keys(REVISION_FIELD_LABELS).sort());
  });

  it("drops membership, billing and visibility fields and says which", () => {
    const r = parseRevisionPayload({
      name: "Acme", status: "active", billing_mode: "invoice", paid_at: "2026-10-01", is_bundle_account: true,
      archived_at: null, comped_until: "2099-01-01", grace_until: null, joined_at: null, draft_submitted_at: null,
      stripe_customer_id: "cus_x", search_tsv: "x", id: "other",
    }, M);
    expect(r.values).toEqual({ name: "Acme" });
    expect(r.ignored.map((i) => i.key).sort()).toEqual([
      "archived_at", "billing_mode", "comped_until", "draft_submitted_at", "grace_until", "id", "is_bundle_account",
      "joined_at", "paid_at", "search_tsv", "status", "stripe_customer_id",
    ]);
  });

  it("re-checks each value the way the form's parser does", () => {
    const r = parseRevisionPayload({
      name: "  ", slug: "Acme Ltd!", phone: "call me", contact_email: "nope", video_url: "https://vimeo.com/1",
      lat: 200, lng: -0.1, social: ["x"], logo_path: "members/other/a.png", hero_path: "../../etc",
    }, M);
    expect(r.values).toEqual({ slug: "acme-ltd", lng: -0.1 });
    expect(r.ignored.map((i) => i.key).sort()).toEqual(
      ["contact_email", "hero_path", "lat", "logo_path", "name", "phone", "social", "video_url"],
    );
  });

  it("stores a website the way the form does: absolute http(s), junk refused, blank clears", () => {
    expect(parseRevisionPayload({ website: "www.acme.co.uk" }, M).values).toEqual({ website: "https://www.acme.co.uk" });
    expect(parseRevisionPayload({ website: "" }, M).values).toEqual({ website: null });
    for (const website of ["javascript:alert(1)", "/go/elsewhere", "see our LinkedIn"]) {
      const r = parseRevisionPayload({ website }, M);
      expect(r.values, website).toEqual({});
      expect(r.ignored.map((i) => i.key), website).toEqual(["website"]);
    }
  });

  it("sanitises the description", () => {
    const r = parseRevisionPayload({ description: "<script>alert(1)</script><p>Hi</p>" }, M);
    expect(r.values.description).not.toContain("<script>");
    expect(r.values.description).toContain("Hi");
  });

  it("removing a logo (null) is allowed; the member's own upload is allowed", () => {
    expect(parseRevisionPayload({ logo_path: null, hero_path: `members/${M}/mfx2k.webp` }, M).values)
      .toEqual({ logo_path: null, hero_path: `members/${M}/mfx2k.webp` });
  });

  it("id lists: absent is null (leave alone), a list is deduped, junk is ignored", () => {
    const r = parseRevisionPayload({ service_ids: [3, 3, 7], membership_type_ids: [1, "x"] }, M);
    expect(r.serviceIds).toEqual([3, 7]);
    expect(r.membershipTypeIds).toBeNull();
    expect(r.ignored).toEqual([{ key: "membership_type_ids", reason: "not a list of ids" }]);
  });

  it("legacy keys from dropped columns are dropped silently", () => {
    expect(parseRevisionPayload({ testimonials: [], category_id: 3 }, M)).toMatchObject({ values: {}, ignored: [] });
  });

  // Industries are Jas's alone since 2 Nov. A revision submitted before then
  // still carries the member's pick; approving it must not overwrite her tags.
  it("industry fields from a revision submitted before 2 Nov are dropped silently", () => {
    const r = parseRevisionPayload({ website: "https://x.example", industry_id: 8, industry_ids: [2, 7] }, M);
    expect(r.values).toEqual({ website: "https://x.example" });
    expect(r).not.toHaveProperty("industryIds");
    expect(r.ignored).toEqual([]);
  });

  it("a payload that isn't an object applies nothing", () => {
    expect(parseRevisionPayload(null, M).values).toEqual({});
    expect(parseRevisionPayload([1], M).values).toEqual({});
  });
});

describe("revisionChanges", () => {
  it("lists only fields that differ, in form order, ignoring social key order", () => {
    const changes = revisionChanges(
      { website: "https://new.test", name: "Acme", social: { x: "a", linkedin: "b" } },
      { name: "Acme", website: "https://old.test", social: { linkedin: "b", x: "a" } },
    );
    expect(changes).toEqual([{ field: "website", label: "Website", from: "https://old.test", to: "https://new.test" }]);
  });

  it("a cleared field shows as a change to nothing", () => {
    expect(revisionChanges({ phone: null }, { phone: "0161 555 0100" })).toEqual([
      { field: "phone", label: "Phone", from: "0161 555 0100", to: null },
    ]);
  });
});

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

// Migration 20261016000011: a signed-in member can't write a revision straight
// to PostgREST any more — only dashboard submitProfileEdit, via the service role.
describe.skipIf(!ANON_KEY || !SECRET_KEY)("member_revisions writes (local stack)", () => {
  const admin = createClient<Database>(URL_, SECRET_KEY ?? "skipped", { auth: { persistSession: false } });
  const tag = Date.now().toString(36);
  const email = `rev-rls-${tag}@smi.test`;
  const password = `pw-${tag}-local`;
  let userId = "";
  let memberId = "";

  beforeAll(async () => {
    const { data: m } = await admin.from("members").insert({ slug: `rev-rls-${tag}`, name: "Rev RLS Ltd", status: "active" }).select("id").single();
    memberId = m!.id;
    const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    userId = u.user.id;
    await admin.from("profiles").upsert({ user_id: userId, role: "member", member_id: memberId });
  });

  afterAll(async () => {
    if (memberId) await admin.from("member_revisions").delete().eq("member_id", memberId);
    if (userId) await admin.auth.admin.deleteUser(userId);
    if (memberId) await admin.from("members").delete().eq("id", memberId);
  });

  it("a member's own direct insert is refused", async () => {
    const member = createClient<Database>(URL_, ANON_KEY!, { auth: { persistSession: false } });
    const { error: signInError } = await member.auth.signInWithPassword({ email, password });
    expect(signInError).toBeNull();
    const { error } = await member.from("member_revisions").insert({ member_id: memberId, payload: { status: "active", paid_at: "2026-10-01" } });
    expect(error?.code).toBe("42501");
    const { count } = await admin.from("member_revisions").select("id", { count: "exact", head: true }).eq("member_id", memberId);
    expect(count).toBe(0);
  });
});

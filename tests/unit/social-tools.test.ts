import { describe, expect, it, vi } from "vitest";
import { sendChannelDraft, TOOL_MESSAGES, writeChannelWording } from "@/lib/social-tools";
import type { ChannelNetworks, SocialPublisher } from "@/lib/adapters/social";
import type { SocialWriter } from "@/lib/adapters/social-writer";
import { postFingerprint } from "@/lib/social-post";
import { siteUrl } from "@/lib/site-url";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";

const STORY = {
  id: "s1", title: "Acme wins award", slug: "acme-wins-award", cover_path: "c.jpg", member_id: "m1",
  status: "draft", social_at: null, social_text: null, social_skip: false, published_at: null,
  summary: "Acme took the top prize.", story_summary: "Acme took the top prize.",
  body: "<p>Acme Engineering took the <b>top prize</b> at the awards.</p>",
  member: { name: "Acme Engineering", social: {}, status: "active", archived_at: null },
  story_members: [{ member: { name: "Acme Engineering" } }, { member: { name: "BLM Group" } }],
};
const known: ChannelNetworks = { kind: "known", services: new Map([["li", "linkedin"]]) };

/** Story s1 with channel li; every read of its channel rows sees `rows`, every write lands on the same builder. */
function db(o: { rows?: unknown[]; channels?: string[] } = {}) {
  const posts = queryBuilder(dbOk(o.rows ?? []));
  const d = asDb(mockDb({ from: fromByTable({
    stories: () => queryBuilder(dbOk(STORY)),
    story_members: () => queryBuilder(dbOk([])),
    settings: () => queryBuilder(dbOk({ value: { channelIds: o.channels ?? ["li"] } })),
    social_channel_posts: () => posts,
  }) }));
  return { d, posts };
}
const writer = (result: Awaited<ReturnType<SocialWriter["write"]>>) => ({ write: vi.fn(async () => result) });

describe("writeChannelWording", () => {
  it("gives Claude the story, its companies and that network's limit, and saves the wording as Claude's", async () => {
    const { d, posts } = db();
    const w = writer({ ok: true, text: "Acme Engineering took the top prize." });

    expect(await writeChannelWording(d, { story_id: "s1" }, "li", { writer: w, networks: async () => known })).toEqual({ ok: true });

    expect(w.write).toHaveBeenCalledWith({
      network: "linkedin",
      title: "Acme wins award",
      summary: "Acme took the top prize.",
      body: "Acme Engineering took the top prize at the awards.",
      companies: ["Acme Engineering", "BLM Group"],
      maxLength: 1500,
    });
    expect(posts.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ story_id: "s1", channel_id: "li", lead_text: "Acme Engineering took the top prize.", lead_ai: true }),
      { onConflict: "story_id,channel_id" },
    );
  });

  it.each([
    ["a channel that isn't connected", { channels: ["x"] }, known, TOOL_MESSAGES.notConnected],
    ["a network Buffer couldn't name", {}, { kind: "failed" } as ChannelNetworks, TOOL_MESSAGES.noNetwork],
    ["a post already with Buffer", { rows: [{ channel_id: "li", skip: false, handed_at: "2026-11-05T12:00:00Z", posted_at: null }] }, known, TOOL_MESSAGES.withBuffer],
  ])("writes nothing for %s", async (_, o, networks, error) => {
    const { d, posts } = db(o);
    const w = writer({ ok: true, text: "x" });

    expect(await writeChannelWording(d, { story_id: "s1" }, "li", { writer: w, networks: async () => networks })).toEqual({ ok: false, error });
    expect(w.write).not.toHaveBeenCalled();
    expect(posts.upsert).not.toHaveBeenCalled();
  });

  it("passes on why Claude's wording wasn't used, and saves nothing", async () => {
    const { d, posts } = db();
    const result = await writeChannelWording(d, { story_id: "s1" }, "li", { writer: writer({ ok: false, reason: "Too long." }), networks: async () => known });
    expect(result).toEqual({ ok: false, error: "Too long." });
    expect(posts.upsert).not.toHaveBeenCalled();
  });
});

describe("sendChannelDraft", () => {
  const post = { channelId: "li", text: `Acme took the top prize.\n\n${siteUrl()}/news/acme-wins-award`, imagePath: "c.jpg" };
  const publisher = (draft: { id: string } | null = { id: "d2" }) => ({
    publishChannel: vi.fn(async () => (draft ? { ...draft, service: "linkedin", status: "draft", link: null } : null)),
    deletePost: vi.fn(async () => true),
    channelNetworks: vi.fn(),
    channelDetails: vi.fn(),
    postLinks: vi.fn(),
  }) satisfies SocialPublisher;

  it("puts exactly what the channel would receive into Buffer as a draft, and records it", async () => {
    const { d, posts } = db();
    const p = publisher();

    expect(await sendChannelDraft(d, { story_id: "s1" }, "li", postFingerprint(post), { publisher: p, live: true, networks: async () => known }))
      .toEqual({ ok: true });

    expect(p.publishChannel).toHaveBeenCalledWith(post, { kind: "draft" }, { aiAssisted: false });
    expect(posts.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ channel_id: "li", draft_post_id: "d2", draft_text: post.text, draft_image: "c.jpg", draft_at: expect.any(String) }),
      { onConflict: "story_id,channel_id" },
    );
  });

  it("replaces the channel's previous draft", async () => {
    const { d } = db({ rows: [{ channel_id: "li", skip: false, posted_at: null, draft_post_id: "d1", draft_text: "old", draft_at: "2026-11-05T10:00:00Z" }] });
    const p = publisher();

    await sendChannelDraft(d, { story_id: "s1" }, "li", postFingerprint(post), { publisher: p, live: true, networks: async () => known });

    expect(p.deletePost).toHaveBeenCalledWith("d1");
  });

  it("makes no draft when the post changed after the page loaded", async () => {
    const { d } = db();
    const p = publisher();

    expect(await sendChannelDraft(d, { story_id: "s1" }, "li", "an old fingerprint", { publisher: p, live: true, networks: async () => known }))
      .toEqual({ ok: false, error: TOOL_MESSAGES.changed });
    expect(p.publishChannel).not.toHaveBeenCalled();
  });

  it("makes no draft without Buffer, and says so", async () => {
    const { d } = db();
    const p = publisher();

    expect(await sendChannelDraft(d, { story_id: "s1" }, "li", postFingerprint(post), { publisher: p, live: false, networks: async () => known }))
      .toEqual({ ok: false, error: TOOL_MESSAGES.noBuffer });
    expect(p.publishChannel).not.toHaveBeenCalled();
  });

  it("records nothing when Buffer didn't take the draft", async () => {
    const { d, posts } = db();
    const p = publisher();
    p.publishChannel.mockRejectedValueOnce(new Error("down"));

    expect(await sendChannelDraft(d, { story_id: "s1" }, "li", postFingerprint(post), { publisher: p, live: true, networks: async () => known }))
      .toEqual({ ok: false, error: TOOL_MESSAGES.draftFailed });
    expect(posts.upsert).not.toHaveBeenCalled();
  });
});

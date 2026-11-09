import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSocialPanel, postFingerprint, saveChannelLeads, socialWaiting, storySocialItem } from "@/lib/social-post";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));

afterEach(() => logError.mockReset());

const NOW = new Date("2026-07-01T12:00:00Z");
const settings = () => queryBuilder(dbOk({ value: { channelIds: ["li", "x"] } }));

describe("socialWaiting", () => {
  it("asks the database for just the waiting items, with the connected channels, the delay and now", async () => {
    const rpc = vi.fn(async () => dbOk([
      { kind: "story", id: "s1", title: "Acme wins award", waiting: 1 },
      { kind: "video", id: "v1", title: "Factory tour", waiting: 2 },
    ]));
    const db = asDb(mockDb({ from: fromByTable({ settings }), rpc }));

    const waiting = await socialWaiting(db, { delayMinutes: 30, now: NOW });

    expect(rpc).toHaveBeenCalledWith("social_waiting_items", { p_channel_ids: ["li", "x"], p_delay_minutes: 30, p_now: NOW.toISOString() });
    expect(waiting).toEqual([
      { kind: "story", id: "s1", title: "Acme wins award", waiting: 1, total: 2, href: "/console/stories/s1#social" },
      { kind: "video", id: "v1", title: "Factory tour", waiting: 2, total: 2, href: "/console/videos/v1#social" },
    ]);
  });

  it("doesn't ask at all with no channels connected", async () => {
    const rpc = vi.fn(async () => dbOk([]));
    const db = asDb(mockDb({ from: fromByTable({ settings: () => queryBuilder(dbOk({ value: {} })) }), rpc }));

    expect(await socialWaiting(db, { delayMinutes: 30, now: NOW })).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("logs a failed read and lists nothing, rather than everything as waiting", async () => {
    const db = asDb(mockDb({ from: fromByTable({ settings }), rpc: async () => dbError("timeout") }));

    expect(await socialWaiting(db, { delayMinutes: 30, now: NOW })).toEqual([]);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ area: "social:waiting", error: expect.stringContaining("timeout") }));
  });
});

describe("storySocialItem image (Jas 28/10, open items #6)", () => {
  const base = {
    id: "s1", title: "T", slug: "t", cover_path: null, member_id: "m1", status: "published",
    social_at: null, social_text: null, social_skip: false, published_at: null, summary: null,
  };
  const live = { social: {}, status: "active", archived_at: null, logo_path: "members/acme.png" };

  it("posts the member's logo when the story has no cover, or when the admin chose it", () => {
    expect(storySocialItem({ ...base, member: live }, []).post.imagePath).toBe("members/acme.png");
    expect(storySocialItem({ ...base, cover_path: "c.jpg", cover_use_logo: true, member: live }, []).post.imagePath).toBe("members/acme.png");
    expect(storySocialItem({ ...base, cover_path: "c.jpg", member: live }, []).post.imagePath).toBe("c.jpg");
  });

  it("never posts the logo of a member it wouldn't tag", () => {
    const archived = { ...live, archived_at: "2026-10-01T00:00:00Z" };
    expect(storySocialItem({ ...base, member: archived }, []).post.imagePath).toBeNull();
  });
});

describe("loadSocialPanel", () => {
  const story = {
    id: "s1", title: "Acme wins award", slug: "acme-wins-award", cover_path: "c.jpg", member_id: null, status: "draft",
    social_at: null, social_text: null, social_skip: false, published_at: null, summary: "Acme took the top prize.", member: null,
  };

  it("builds from the editor's own row without reading the story again, with each channel's fingerprint", async () => {
    const from = fromByTable({ settings, social_channel_posts: () => queryBuilder(dbOk([])) });
    const db = asDb(mockDb({ from }));

    const panel = await loadSocialPanel(db, { story_id: "s1" }, {
      networks: async () => ({ kind: "unknown" }), details: async () => ({ kind: "unknown", reason: "no-key" }),
      delayMinutes: 30, now: NOW, item: storySocialItem(story, []),
    });

    expect(from).not.toHaveBeenCalledWith("stories");
    expect(panel?.channels.map((c) => c.state)).toEqual(["waiting", "waiting"]);
    expect(panel?.channels[0].fingerprint).toBe(postFingerprint(panel!.channels[0].post));
  });

  it("names each channel from Buffer's details, without changing what it posts", async () => {
    const db = asDb(mockDb({ from: fromByTable({ settings, social_channel_posts: () => queryBuilder(dbOk([])) }) }));
    const detail = { id: "li", service: "linkedin", name: "Sheet Metal Industries", disconnected: false, locked: false, profileUrl: null };
    const deps = { networks: async () => ({ kind: "unknown" as const }), delayMinutes: 30, now: NOW, item: storySocialItem(story, []) };

    const named = await loadSocialPanel(db, { story_id: "s1" }, { ...deps, details: async () => ({ kind: "known", channels: new Map([["li", detail]]) }) });
    const plain = await loadSocialPanel(db, { story_id: "s1" }, { ...deps, details: async () => ({ kind: "failed" }) });

    expect(named?.channels.map((c) => c.label)).toEqual(["LinkedIn · Sheet Metal Industries", "Channel x"]);
    expect(plain?.channels.map((c) => c.label)).toEqual(["Channel li", "Channel x"]);
    expect(named?.channels.map((c) => c.fingerprint)).toEqual(plain?.channels.map((c) => c.fingerprint));
  });

  it("gives a different fingerprint when the text or the image changes", () => {
    const base = { text: "Hello", imagePath: "a.jpg" };
    expect(postFingerprint(base)).toBe(postFingerprint({ ...base }));
    expect(postFingerprint(base)).not.toBe(postFingerprint({ ...base, text: "Hello!" }));
    expect(postFingerprint(base)).not.toBe(postFingerprint({ ...base, imagePath: null }));
  });
});

describe("saveChannelLeads", () => {
  const rows = (records: unknown[]) => {
    const b = queryBuilder(dbOk(records));
    return { b, db: asDb(mockDb({ from: fromByTable({ social_channel_posts: () => b }) })) };
  };

  it("saves only the boxes that changed; an edit of Claude's wording stays AI-assisted, an emptied box doesn't", async () => {
    const { b, db } = rows([
      { channel_id: "li", skip: false, posted_at: null, lead_text: "Claude's words.", lead_ai: true },
      { channel_id: "fb", skip: false, posted_at: null, lead_text: "Same.", lead_ai: false },
      { channel_id: "x", skip: false, posted_at: null, lead_text: "Claude's X words.", lead_ai: true },
    ]);

    await saveChannelLeads(db, { story_id: "s1" }, new Map([["li", "Claude's words, edited."], ["fb", "Same."], ["x", ""], ["ig", "Typed by hand."]]));

    expect(b.upsert).toHaveBeenCalledWith([
      expect.objectContaining({ story_id: "s1", channel_id: "li", lead_text: "Claude's words, edited.", lead_ai: true }),
      expect.objectContaining({ channel_id: "x", lead_text: null, lead_ai: false }),
      expect.objectContaining({ channel_id: "ig", lead_text: "Typed by hand.", lead_ai: false }),
    ], { onConflict: "story_id,channel_id" });
  });

  it("writes nothing when no box changed", async () => {
    const { b, db } = rows([{ channel_id: "li", skip: false, posted_at: null, lead_text: null, lead_ai: false }]);
    await saveChannelLeads(db, { story_id: "s1" }, new Map([["li", ""]]));
    expect(b.upsert).not.toHaveBeenCalled();
  });
});

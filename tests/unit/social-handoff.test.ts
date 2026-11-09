import { afterEach, describe, expect, it, vi } from "vitest";
import { capSlot, handOffTime, pullBack, reconcileHeldPosts } from "@/lib/social-handoff";
import type { ChannelNetworks, SocialPublisher } from "@/lib/adapters/social";
import { siteUrl } from "@/lib/site-url";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));
afterEach(() => logError.mockReset());

describe("handOffTime", () => {
  const NOW = new Date("2026-11-05T12:00:00Z");
  const base = { socialAt: null, publishedAt: "2026-11-05T11:00:00Z", delayMinutes: 30, now: NOW };

  it("is now for Publish now, whatever the post time", () => {
    expect(handOffTime({ ...base, mode: "now", socialAt: "2026-11-09T09:00:00Z" })).toEqual(NOW);
  });

  it("is the item's own post time for Schedule, when that's still to come", () => {
    expect(handOffTime({ ...base, mode: "schedule", socialAt: "2026-11-09T09:00:00Z" })).toEqual(new Date("2026-11-09T09:00:00Z"));
  });

  it("is publication plus the delay with no post time, and now once that has passed", () => {
    expect(handOffTime({ ...base, mode: "schedule", publishedAt: "2026-11-05T11:50:00Z" })).toEqual(new Date("2026-11-05T12:20:00Z"));
    expect(handOffTime({ ...base, mode: "schedule" })).toEqual(NOW); // 11:30 has passed
  });
});

describe("capSlot", () => {
  const o = { perDay: 3, delayMinutes: 30 };

  it("keeps the time when the channel's UK day has room", () => {
    const desired = new Date("2026-11-05T15:00:00Z");
    expect(capSlot({ ...o, desired, taken: [new Date("2026-11-05T09:00:00Z"), new Date("2026-11-05T12:00:00Z")] })).toEqual(desired);
  });

  it("moves a full day's post to 09:00 UK time the next day with room, a delay step per post already there", () => {
    const full = ["09:00", "12:00", "15:00"].map((t) => new Date(`2026-11-05T${t}:00Z`));
    // GMT in November: 09:00 UK is 09:00Z; 6 Nov has one already, so 09:30
    expect(capSlot({ ...o, desired: new Date("2026-11-05T17:00:00Z"), taken: [...full, new Date("2026-11-06T10:00:00Z")] }))
      .toEqual(new Date("2026-11-06T09:30:00Z"));
    // two full days in a row: the 7th, at 09:00
    const fullNext = ["09:00", "12:00", "15:00"].map((t) => new Date(`2026-11-06T${t}:00Z`));
    expect(capSlot({ ...o, desired: new Date("2026-11-05T17:00:00Z"), taken: [...full, ...fullNext] }))
      .toEqual(new Date("2026-11-07T09:00:00Z"));
  });

  it("counts UK days, not UTC ones: 23:30Z in summer is already tomorrow", () => {
    // 1 July 23:30Z is 2 July 00:30 BST; 2 July is full, so 3 July 09:00 BST = 08:00Z
    const full = ["08:00", "12:00", "16:00"].map((t) => new Date(`2026-07-02T${t}:00Z`));
    expect(capSlot({ ...o, desired: new Date("2026-07-01T23:30:00Z"), taken: full })).toEqual(new Date("2026-07-03T08:00:00Z"));
  });
});

/** A publisher whose Buffer calls are spies. */
function publisher(o: { deleted?: boolean; networks?: ChannelNetworks } = {}) {
  return {
    publishChannel: vi.fn(async () => ({ id: "new", service: "linkedin", status: "scheduled", link: null })),
    deletePost: vi.fn(async () => o.deleted ?? true),
    channelNetworks: vi.fn(async () => o.networks ?? ({ kind: "known", services: new Map([["li", "linkedin"]]) } as ChannelNetworks)),
    channelDetails: vi.fn(),
    postLinks: vi.fn(async () => []),
  } satisfies SocialPublisher;
}

const STORY = {
  id: "s1", title: "Acme wins award", slug: "acme-wins-award", cover_path: "c.jpg", member_id: null,
  status: "published", social_at: "2099-01-01T10:00:00Z", social_text: null, social_skip: false,
  published_at: "2026-11-05T11:00:00Z", summary: "Acme took the top prize.", member: null,
};
const TEXT = () => `Acme took the top prize.\n\n${siteUrl()}/news/acme-wins-award`;
/** A channel Buffer holds, scheduled for the story's 2099 time with exactly TEXT(). */
const held = (o: Record<string, unknown> = {}) => ({
  channel_id: "li", skip: false, posted_at: null, confirmed_text: TEXT(), confirmed_image: "c.jpg", confirmed_at: "2026-11-05T10:00:00Z",
  send_mode: "schedule", handed_at: "2026-11-05T11:00:00Z", due_at: "2099-01-01T10:00:00Z", buffer_post_id: "p1", buffer_status: "scheduled",
  confirmer: null, ...o,
});

/**
 * One story with channel li. Every read of social_channel_posts sees `rows`
 * (they don't change underneath: this checks what's asked of Buffer and what's
 * written, not the state after), and every write lands on the same builder.
 */
function db(o: { story?: Record<string, unknown>; rows?: unknown[] } = {}) {
  const writes = queryBuilder(dbOk(o.rows ?? [held()]));
  const from = fromByTable({
    stories: () => queryBuilder(dbOk({ ...STORY, ...o.story })),
    story_members: () => queryBuilder(dbOk([])),
    settings: () => queryBuilder(dbOk({ value: { channelIds: ["li"], per_day: 3, delay_minutes: 30 } })),
    social_channel_posts: () => writes,
  });
  return { db: asDb(mockDb({ from })), writes };
}

describe("pullBack", () => {
  it("deletes each held post from Buffer and forgets it, keeping the schedule when asked", async () => {
    const { db: d, writes } = db();
    const p = publisher();

    expect(await pullBack(d, { story_id: "s1" }, { channels: "all", keepConfirmation: true }, { publisher: p })).toEqual({ pulled: ["li"], failed: [] });

    expect(p.deletePost).toHaveBeenCalledWith("p1");
    const [values] = (writes.update as ReturnType<typeof vi.fn>).mock.calls[0] as [Record<string, unknown>];
    expect(values).toEqual(expect.objectContaining({ handed_at: null, due_at: null, buffer_post_id: null }));
    expect(values).not.toHaveProperty("confirmed_at");
  });

  it("puts the channel back to waiting when the post itself changed", async () => {
    const { db: d, writes } = db();

    await pullBack(d, { story_id: "s1" }, { channels: ["li"], keepConfirmation: false }, { publisher: publisher() });

    expect(writes.update).toHaveBeenCalledWith(expect.objectContaining({ confirmed_at: null, confirmed_text: null, send_mode: null }));
  });

  it("leaves a post Buffer wouldn't delete recorded as with Buffer, and reports it", async () => {
    const { db: d, writes } = db();

    expect(await pullBack(d, { story_id: "s1" }, { channels: "all", keepConfirmation: true }, { publisher: publisher({ deleted: false }) }))
      .toEqual({ pulled: [], failed: ["li"] });
    expect(writes.update).not.toHaveBeenCalled();
  });

  it("never touches a post Buffer already sent", async () => {
    const { db: d } = db({ rows: [held({ posted_at: "2026-11-05T12:00:00Z" })] });
    const p = publisher();

    expect(await pullBack(d, { story_id: "s1" }, { channels: "all", keepConfirmation: true }, { publisher: p })).toEqual({ pulled: [], failed: [] });
    expect(p.deletePost).not.toHaveBeenCalled();
  });
});

describe("reconcileHeldPosts", () => {
  const deps = (p: SocialPublisher) => ({ publisher: p, live: true, enqueue: vi.fn(async () => {}), now: new Date("2026-11-05T12:00:00Z") });

  it("leaves a held post alone when nothing about it changed", async () => {
    const { db: d } = db();
    const p = publisher();

    expect(await reconcileHeldPosts(d, { story_id: "s1" }, deps(p))).toEqual({ pulled: [], rescheduled: [], failed: [], unchecked: false });
    expect(p.deletePost).not.toHaveBeenCalled();
  });

  it("takes a post back out of Buffer when the text changed, and the channel waits again", async () => {
    const { db: d, writes } = db({ story: { social_text: "A new lead-in." } });
    const p = publisher();

    expect((await reconcileHeldPosts(d, { story_id: "s1" }, deps(p))).pulled).toEqual(["li"]);
    expect(p.deletePost).toHaveBeenCalledWith("p1");
    expect(writes.update).toHaveBeenCalledWith(expect.objectContaining({ confirmed_at: null, send_mode: null }));
  });

  it("takes everything back out, still scheduled, when the item is no longer Live", async () => {
    const { db: d, writes } = db({ story: { status: "draft" } });
    const p = publisher();

    expect((await reconcileHeldPosts(d, { story_id: "s1" }, deps(p))).pulled).toEqual(["li"]);
    const [values] = (writes.update as ReturnType<typeof vi.fn>).mock.calls[0] as [Record<string, unknown>];
    expect(values).not.toHaveProperty("confirmed_at");
  });

  it("moves a scheduled post to its new time: out of Buffer, then handed over again", async () => {
    const { db: d } = db({ story: { social_at: "2099-02-01T10:00:00Z" } });
    const p = publisher();

    const result = await reconcileHeldPosts(d, { story_id: "s1" }, deps(p));

    expect(p.deletePost).toHaveBeenCalledWith("p1");
    expect(result.pulled).toEqual([]); // kept scheduled, not sent back to waiting
    expect(result.failed).toEqual([]);
  });

  it("compares nothing, and leaves held posts alone, when Buffer can't say which network each channel is", async () => {
    const { db: d } = db({ story: { social_text: "A new lead-in." } });
    const p = publisher({ networks: { kind: "failed" } });

    expect((await reconcileHeldPosts(d, { story_id: "s1" }, deps(p))).unchecked).toBe(true);
    expect(p.deletePost).not.toHaveBeenCalled();
  });
});

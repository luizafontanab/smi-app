import { describe, expect, it, vi } from "vitest";
import {
  channelSkipsFromForm,
  composeSocialText,
  CONFIRM_MESSAGES,
  confirmSocialPost,
  queueSocialPush,
  seenFromForm,
  socialFieldsFromForm,
  SOCIAL_LEAD_MAX,
  fillStoryPostLinks,
} from "@/lib/social-push";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { channelPosts, type ChannelNetworks } from "@/lib/adapters/social";
import { postFingerprint, storySocialItem, type SocialStoryRow } from "@/lib/social-post";

const NOW = new Date("2026-07-01T12:00:00Z");
const caps = { per_day: 3, delay_minutes: 45 };

describe("composeSocialText", () => {
  it("is the lead-in, a blank line, then the link", () => {
    expect(composeSocialText("Acme wins.", "https://x.test/news/a")).toBe("Acme wins.\n\nhttps://x.test/news/a");
  });

  it("cuts a long lead-in on a word boundary within the budget", () => {
    const lead = composeSocialText("word ".repeat(80), "u").split("\n\n")[0];
    expect(lead.length).toBeLessThanOrEqual(SOCIAL_LEAD_MAX);
    expect(lead.endsWith("word…")).toBe(true);
  });
});

describe("socialFieldsFromForm", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("leaves stored values alone when the fieldset wasn't posted", () => {
    expect(socialFieldsFromForm(form({ title: "x" }))).toEqual({});
  });

  it("stores a lead-in left as the prefill (or blank) as null, so it keeps following the summary", () => {
    for (const text of ["The summary.", "  The   summary. ", ""]) {
      const r = socialFieldsFromForm(form({ social_at: "", social_text: text, social_text_default: "The summary." }));
      expect(r).toEqual({ value: { social_text: null, social_at: null, social_skip: false } });
    }
  });

  it("keeps an edited lead-in, reads the time as UK time and the opt-out tick", () => {
    const r = socialFieldsFromForm(form({ social_at: "2026-07-01T10:00", social_text: "Our words.", social_text_default: "The summary.", social_skip: "on" }));
    expect(r).toEqual({ value: { social_text: "Our words.", social_at: "2026-07-01T09:00:00.000Z", social_skip: true } });
  });

  it("refuses a lead-in over the budget and a time it can't read", () => {
    expect(socialFieldsFromForm(form({ social_at: "", social_text: "x".repeat(SOCIAL_LEAD_MAX + 1) }))).toHaveProperty("error");
    expect(socialFieldsFromForm(form({ social_at: "soon" }))).toHaveProperty("error");
  });
});

describe("channelSkipsFromForm", () => {
  const form = (pairs: [string, string][]) => {
    const f = new FormData();
    for (const [k, v] of pairs) f.append(k, v);
    return f;
  };

  it("reads every channel the form listed and the ones ticked Don't post", () => {
    expect(channelSkipsFromForm(form([["social_channel", "li"], ["social_channel", "x"], ["social_skip_channel", "x"]])))
      .toEqual({ shown: ["li", "x"], skipped: ["x"] });
  });

  it("ignores a tick for a channel the form didn't list, and leaves everything alone when it listed none", () => {
    expect(channelSkipsFromForm(form([["social_channel", "li"], ["social_skip_channel", "fb"]]))).toEqual({ shown: ["li"], skipped: [] });
    expect(channelSkipsFromForm(form([["title", "x"]]))).toBeUndefined();
  });
});

/** A live story with channels li and x connected, and the given channel rows. */
function liveItemDb(o: { story?: Record<string, unknown>; rows?: unknown[]; channels?: string[] } = {}) {
  const jobs = queryBuilder(dbOk(null));
  const rows = queryBuilder(dbOk(o.rows ?? []));
  const db = asDb(mockDb({ from: fromByTable({
    stories: () => queryBuilder(dbOk({ status: "published", social_at: null, social_skip: false, published_at: NOW.toISOString(), ...o.story })),
    settings: () => queryBuilder(dbOk({ value: { channelIds: o.channels ?? ["li", "x"] } })),
    social_channel_posts: () => rows,
    jobs: () => jobs,
  }) }));
  return { db, jobs, rows };
}

describe("queueSocialPush", () => {
  const confirmed = (channel_id: string, confirmed_at: string, extra: Record<string, unknown> = {}) =>
    ({ channel_id, skip: false, posted_at: null, confirmed_at, ...extra });

  it("replaces any pending push, then queues one for the earliest confirmed channel still to post", async () => {
    const { db, jobs } = liveItemDb({
      story: { social_at: "2099-01-01T10:00:00Z" },
      rows: [
        confirmed("li", "2099-01-02T08:00:00Z"),
        confirmed("x", "2026-06-30T08:00:00Z"),
        confirmed("gone", "2026-06-30T08:00:00Z"), // no longer connected
        confirmed("fb", "2026-06-30T08:00:00Z", { posted_at: "2026-07-01T09:00:00Z" }),
      ],
      channels: ["li", "x", "fb"],
    });
    const enqueue = vi.fn(async () => {});

    const due = await queueSocialPush(db, { story_id: "s1" }, enqueue, caps);

    expect(jobs.delete).toHaveBeenCalled();
    expect(jobs.filter).toHaveBeenCalledWith("payload->>story_id", "eq", "s1");
    // x: its post time; li waits for its later confirmation
    expect(enqueue).toHaveBeenCalledWith("social_push", { story_id: "s1" }, new Date("2099-01-01T10:00:00Z"));
    expect(due?.toISOString()).toBe("2099-01-01T10:00:00.000Z");
  });

  it("queues nothing, and drops a pending push, when no channel is confirmed", async () => {
    const { db, jobs } = liveItemDb({ rows: [{ channel_id: "li", skip: false, posted_at: null, confirmed_at: null }] });
    const enqueue = vi.fn(async () => {});

    expect(await queueSocialPush(db, { story_id: "s1" }, enqueue, caps)).toBeNull();
    expect(jobs.delete).toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ["isn't Live", { status: "scheduled", published_at: null }],
    ["is marked Don't post", { social_skip: true }],
  ])("queues nothing for an item that %s", async (_why, story) => {
    const { db } = liveItemDb({ story, rows: [confirmed("li", "2026-06-30T08:00:00Z")] });
    const enqueue = vi.fn(async () => {});

    expect(await queueSocialPush(db, { story_id: "s1" }, enqueue, caps)).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("queues a channel confirmed for a time already past for now, never earlier", async () => {
    const { db } = liveItemDb({ story: { published_at: "2026-01-01T09:00:00Z" }, rows: [confirmed("li", "2026-01-02T09:00:00Z")] });
    const enqueue = vi.fn(async () => {});
    const before = Date.now();

    const due = await queueSocialPush(db, { story_id: "s1" }, enqueue, caps);

    expect(due!.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("queueSocialPush from the job's own run", () => {
  const confirmed = (channel_id: string, confirmed_at: string) => ({ channel_id, skip: false, posted_at: null, confirmed_at });

  it("leaves out held channels (over the limit, or failed and retrying), and runs at `also` when that is sooner", async () => {
    const { db } = liveItemDb({
      story: { social_at: "2026-06-30T10:00:00Z" },
      rows: [confirmed("li", "2026-06-30T08:00:00Z"), confirmed("x", "2099-01-02T08:00:00Z")],
    });
    const enqueue = vi.fn(async () => {});

    // li is due now but held; x is confirmed for 2099
    expect((await queueSocialPush(db, { story_id: "s1" }, enqueue, caps, { hold: ["li"] }))?.toISOString()).toBe("2099-01-02T08:00:00.000Z");

    const slot = new Date("2098-06-01T09:00:00Z");
    expect(await queueSocialPush(db, { story_id: "s1" }, enqueue, caps, { hold: ["li"], also: slot })).toEqual(slot);
  });

  it("still queues the overflow slot when every channel is held", async () => {
    const { db } = liveItemDb({ rows: [confirmed("li", "2026-06-30T08:00:00Z")] });
    const enqueue = vi.fn(async () => {});
    const slot = new Date("2099-01-01T09:00:00Z");

    expect(await queueSocialPush(db, { story_id: "s1" }, enqueue, caps, { hold: ["li"], also: slot })).toEqual(slot);
    expect(enqueue).toHaveBeenCalledWith("social_push", { story_id: "s1" }, slot);
  });

  it("never queues a long-published story nobody confirmed", async () => {
    const { db } = liveItemDb({ story: { published_at: "2020-01-01T09:00:00Z" }, rows: [] });
    const enqueue = vi.fn(async () => {});

    expect(await queueSocialPush(db, { story_id: "s1" }, enqueue)).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("seenFromForm", () => {
  it("reads each channel's fingerprint as the page showed it, and nothing else", () => {
    const f = new FormData();
    f.append("social_seen:li", "abc");
    f.append("social_seen:x", "def");
    f.append("confirm_channel", "all");
    expect(seenFromForm(f)).toEqual({ li: "abc", x: "def" });
  });
});

describe("confirmSocialPost", () => {
  const story = {
    id: "s1", title: "Acme wins award", slug: "acme-wins-award", cover_path: "c.jpg", member_id: null,
    status: "published", social_at: null, social_text: null, social_skip: false, published_at: NOW.toISOString(),
    summary: "Acme took the top prize.", member: null,
  };
  const knownNetworks: ChannelNetworks = { kind: "known", services: new Map([["li", "linkedin"], ["x", "twitter"]]) };
  const known = async () => knownNetworks;
  /** Each channel's fingerprint as the editor would have shown it for this story. */
  const shown = (o: Record<string, unknown> = {}) => Object.fromEntries(
    channelPosts(storySocialItem({ ...story, ...o } as SocialStoryRow, []).post, ["li", "x"], knownNetworks)
      .map(({ post }) => [post.channelId, postFingerprint(post)]),
  );
  /** `after`: the channel rows as the push reads them back, once the confirmation is written. */
  function db(o: { story?: Record<string, unknown> | null; rows?: unknown[]; after?: unknown[]; channels?: string[] } = {}) {
    const rows = queryBuilder(dbOk(o.rows ?? []));
    const readBack = queryBuilder(dbOk(o.after ?? o.rows ?? []));
    const jobs = queryBuilder(dbOk(null));
    let reads = 0;
    return {
      rows,
      jobs,
      // the records, then the upsert, on `rows`; the push's read after that sees `after`
      db: asDb(mockDb({ from: fromByTable({
        stories: () => queryBuilder(dbOk(o.story === null ? null : { ...story, ...o.story })),
        story_members: () => queryBuilder(dbOk([])),
        settings: () => queryBuilder(dbOk({ value: { channelIds: o.channels ?? ["li", "x"] } })),
        social_channel_posts: () => (reads++ < 2 ? rows : readBack),
        jobs: () => jobs,
      }) })),
    };
  }

  it("stores what each waiting channel would receive from the saved item, by whom, and queues the post", async () => {
    const { db: d, rows } = db({ after: [{ channel_id: "li", skip: false, posted_at: null, confirmed_at: NOW.toISOString() }] });
    const enqueue = vi.fn(async () => {});

    const res = await confirmSocialPost(d, { story_id: "s1" }, { only: "all", userId: "admin-1", seen: shown() }, { networks: known, enqueue });

    expect(res).toEqual({ ok: true, confirmed: ["li", "x"] });
    const [upserted, opts] = (rows.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [Record<string, unknown>[], unknown];
    expect(opts).toEqual({ onConflict: "story_id,channel_id" });
    expect(upserted[0]).toEqual(expect.objectContaining({
      story_id: "s1", channel_id: "li", confirmed_by: "admin-1", confirmed_image: "c.jpg",
      confirmed_text: expect.stringMatching(/^Acme took the top prize\.\n\nhttps?:\/\/.*\/news\/acme-wins-award$/),
      confirmed_at: expect.any(String),
    }));
    expect(enqueue).toHaveBeenCalledWith("social_push", { story_id: "s1" }, expect.any(Date));
  });

  it("confirms just the one channel asked for, leaving one already posted alone", async () => {
    const { db: d, rows } = db({ rows: [{ channel_id: "x", skip: false, posted_at: "2026-07-01T09:00:00Z", confirmed_text: "t", confirmed_image: null, confirmed_at: "2026-07-01T08:00:00Z" }] });

    const one = await confirmSocialPost(d, { story_id: "s1" }, { only: ["li"], userId: "a", seen: shown() }, { networks: known, enqueue: vi.fn(async () => {}) });
    expect(one).toEqual({ ok: true, confirmed: ["li"] });

    (rows.upsert as ReturnType<typeof vi.fn>).mockClear();
    const posted = await confirmSocialPost(d, { story_id: "s1" }, { only: ["x"], userId: "a", seen: shown() }, { networks: known, enqueue: vi.fn(async () => {}) });
    expect(posted).toEqual({ ok: false, error: CONFIRM_MESSAGES.nothingWaiting });
    expect(rows.upsert).not.toHaveBeenCalled();
  });

  it("confirms nothing when the post changed after the page loaded", async () => {
    // the page showed the old lead-in; someone saved a new one since
    const { db: d, rows } = db({ story: { social_text: "A newer lead-in." } });
    const enqueue = vi.fn(async () => {});

    const res = await confirmSocialPost(d, { story_id: "s1" }, { only: ["x"], userId: "a", seen: shown() }, { networks: known, enqueue });

    expect(res).toEqual({ ok: false, error: CONFIRM_MESSAGES.changed });
    expect(rows.upsert).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("confirms nothing for Confirm all when a waiting channel wasn't on the page at all", async () => {
    const { db: d, rows } = db();
    const { x } = shown();

    const res = await confirmSocialPost(d, { story_id: "s1" }, { only: "all", userId: "a", seen: { x } }, { networks: known, enqueue: vi.fn(async () => {}) });

    expect(res).toEqual({ ok: false, error: CONFIRM_MESSAGES.changed });
    expect(rows.upsert).not.toHaveBeenCalled();
  });

  it("confirms nothing while Buffer can't say which network each channel is", async () => {
    const { db: d, rows } = db();
    const res = await confirmSocialPost(d, { story_id: "s1" }, { only: "all", userId: "a", seen: shown() }, {
      networks: async () => ({ kind: "failed" }), enqueue: vi.fn(async () => {}),
    });
    expect(res).toEqual({ ok: false, error: CONFIRM_MESSAGES.lookupFailed });
    expect(rows.upsert).not.toHaveBeenCalled();
  });

  it("has nothing to confirm with no channels connected, or for a missing item", async () => {
    const deps = { networks: known, enqueue: vi.fn(async () => {}) };
    expect(await confirmSocialPost(db({ channels: [] }).db, { story_id: "s1" }, { only: "all", userId: "a", seen: shown() }, deps))
      .toEqual({ ok: false, error: CONFIRM_MESSAGES.noChannels });
    expect(await confirmSocialPost(db({ story: null }).db, { story_id: "s1" }, { only: "all", userId: "a", seen: shown() }, deps))
      .toEqual({ ok: false, error: CONFIRM_MESSAGES.notFound });
  });
});

describe("fillStoryPostLinks", () => {
  it("stores only links that pass the same check as a pasted one, and keeps waiting on unsent posts", async () => {
    const stories = queryBuilder(dbOk({ social_posts: {} }));
    const db = asDb(mockDb({ from: fromByTable({ stories: () => stories }) }));

    const waiting = await fillStoryPostLinks(db, "s1", [
      { id: "p1", service: "linkedin", status: "sent", link: "https://evil.example/not-linkedin" },
      { id: "p2", service: "facebook", status: "sent", link: "https://l.facebook.com/l.php?u=https://evil.example" },
      { id: "p3", service: "twitter", status: "sending", link: null },
      { id: "p4", service: "twitter", status: "error", link: null },
    ]);

    expect(stories.update).not.toHaveBeenCalled();
    expect(waiting.map((p) => p.id)).toEqual(["p3"]);
  });
});

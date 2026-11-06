import { describe, expect, it } from "vitest";
import { channelDueAt, channelStatusLines, planSocialPush, snapshotMatches, socialNotes, socialSummary, waitingSummary, type ChannelRecord } from "@/lib/social-confirm";

const confirmed = (o: Partial<{ confirmed_text: string | null; confirmed_image: string | null; confirmed_at: string | null }> = {}) => ({
  confirmed_text: "Acme wins.\n\nhttps://smi.test/news/a\n\nlinkedin:acme",
  confirmed_image: "covers/a.jpg",
  confirmed_at: "2026-11-05T14:02:00Z",
  ...o,
});
const post = (o: Partial<{ text: string; imagePath: string | null }> = {}) => ({
  text: "Acme wins.\n\nhttps://smi.test/news/a\n\nlinkedin:acme",
  imagePath: "covers/a.jpg",
  ...o,
});

describe("snapshotMatches", () => {
  it("holds when the channel would receive exactly what was confirmed", () => {
    expect(snapshotMatches(confirmed(), post())).toBe(true);
  });

  it("fails on any change to the text — lead-in, link or that network's tags", () => {
    expect(snapshotMatches(confirmed(), post({ text: "Acme wins big.\n\nhttps://smi.test/news/a\n\nlinkedin:acme" }))).toBe(false);
    expect(snapshotMatches(confirmed(), post({ text: "Acme wins.\n\nhttps://smi.test/news/a\n\nlinkedin:acme-ltd" }))).toBe(false);
  });

  it("fails when the image changed, appeared or went", () => {
    expect(snapshotMatches(confirmed(), post({ imagePath: "covers/b.jpg" }))).toBe(false);
    expect(snapshotMatches(confirmed(), post({ imagePath: null }))).toBe(false);
    expect(snapshotMatches(confirmed({ confirmed_image: null }), post())).toBe(false);
  });

  it("holds for a post with no image, confirmed with none", () => {
    expect(snapshotMatches(confirmed({ confirmed_image: null }), post({ imagePath: null }))).toBe(true);
  });

  it("never holds for a channel nobody confirmed", () => {
    expect(snapshotMatches(null, post())).toBe(false);
    expect(snapshotMatches(confirmed({ confirmed_at: null, confirmed_text: null }), post())).toBe(false);
  });
});

describe("channelDueAt", () => {
  const LIVE = "2026-11-05T12:00:00Z";
  const due = (o: Partial<Parameters<typeof channelDueAt>[0]>) =>
    channelDueAt({ socialAt: null, publishedAt: LIVE, confirmedAt: "2026-11-05T09:00:00Z", delayMinutes: 30, ...o })?.toISOString() ?? null;

  it("is publication plus the delay when confirmed beforehand and no time is set", () => {
    expect(due({})).toBe("2026-11-05T12:30:00.000Z");
  });

  it("is the item's own post time when that is the latest", () => {
    expect(due({ socialAt: "2026-11-05T15:00:00Z" })).toBe("2026-11-05T15:00:00.000Z");
  });

  it("is the moment it went Live for a post time set before that", () => {
    expect(due({ socialAt: "2026-11-05T08:00:00Z" })).toBe("2026-11-05T12:00:00.000Z");
  });

  it("is the confirmation, when that came after the post time", () => {
    expect(due({ confirmedAt: "2026-11-07T10:00:00Z" })).toBe("2026-11-07T10:00:00.000Z");
  });

  it("is never set before the item is Live, or before anyone confirmed", () => {
    expect(due({ publishedAt: null })).toBeNull();
    expect(due({ confirmedAt: null })).toBeNull();
  });
});

describe("planSocialPush", () => {
  const NOW = new Date("2026-11-05T15:00:00Z");
  const text = (ch: string) => `Acme wins.\n\nhttps://smi.test/news/a\n\n${ch}:acme`;
  const channel = (id: string, record: Partial<ChannelRecord> | null = {}) => ({
    post: { channelId: id, text: text(id), imagePath: "covers/a.jpg" },
    record: record && {
      channel_id: id, skip: false, posted_at: null,
      confirmed_text: text(id), confirmed_image: "covers/a.jpg", confirmed_at: "2026-11-05T10:00:00Z",
      ...record,
    },
  });
  const plan = (o: Partial<Parameters<typeof planSocialPush>[0]> = {}) => planSocialPush({
    now: NOW,
    item: { socialAt: null, publishedAt: "2026-11-05T12:00:00Z", skip: false },
    delayMinutes: 30,
    perDay: 3,
    channels: [channel("li")],
    postedToday: {},
    ...o,
  });
  const ids = (posts: { channelId: string }[]) => posts.map((p) => p.channelId);

  it("posts a confirmed channel whose time has come, with exactly the confirmed text", () => {
    const r = plan();
    expect(r.send).toEqual([{ channelId: "li", text: text("li"), imagePath: "covers/a.jpg" }]);
    expect(r.unconfirm).toEqual([]);
  });

  it("posts each confirmed channel while others still wait for confirmation", () => {
    const r = plan({ channels: [channel("li"), channel("x", null), channel("fb", { confirmed_at: null, confirmed_text: null })] });
    expect(ids(r.send)).toEqual(["li"]);
    expect(r.nextAt).toBeNull(); // nobody confirmed the others; confirming queues them
  });

  it("holds back a channel whose post changed since it was confirmed, and only that one", () => {
    const changed = channel("x");
    changed.post.text = text("x").replace("x:acme", "x:acme_ltd"); // a member edited their X handle
    const r = plan({ channels: [channel("li"), changed] });
    expect(ids(r.send)).toEqual(["li"]);
    expect(r.unconfirm).toEqual(["x"]);
  });

  it("never posts a channel already posted, or one marked Don't post", () => {
    expect(plan({ channels: [channel("li", { posted_at: "2026-11-05T13:00:00Z" }), channel("x", { skip: true })] }).send).toEqual([]);
  });

  it("posts nothing when the whole item is marked Don't post", () => {
    expect(plan({ item: { socialAt: null, publishedAt: "2026-11-05T12:00:00Z", skip: true } }).send).toEqual([]);
  });

  it("posts nothing before the item is Live", () => {
    expect(plan({ item: { socialAt: null, publishedAt: null, skip: false } })).toEqual({ send: [], unconfirm: [], overCap: [], nextAt: null });
  });

  it("waits for a post time still to come, and says when to look again", () => {
    const r = plan({ item: { socialAt: "2026-11-05T18:00:00Z", publishedAt: "2026-11-05T12:00:00Z", skip: false } });
    expect(r.send).toEqual([]);
    expect(r.nextAt?.toISOString()).toBe("2026-11-05T18:00:00.000Z");
  });

  it("counts the daily limit per channel: a full channel waits, the others still post", () => {
    const r = plan({ channels: [channel("li"), channel("x")], postedToday: { li: 3, x: 2 } });
    expect(ids(r.send)).toEqual(["x"]);
    expect(r.overCap).toEqual(["li"]);
  });
});

describe("channelStatusLines", () => {
  // 15:30 UK time (GMT in November)
  const NOW = new Date("2026-11-05T15:30:00Z");
  const text = "Acme wins.\n\nhttps://smi.test/news/a";
  const view = (label: string, record: Partial<ChannelRecord> | null, confirmedBy: string | null = "Jas") => ({
    label,
    confirmedBy,
    post: { channelId: label, text, imagePath: null },
    record: record && { channel_id: label, skip: false, posted_at: null, confirmed_text: null, confirmed_image: null, confirmed_at: null, ...record },
  });
  const confirmedAt = { confirmed_text: text, confirmed_at: "2026-11-05T14:02:00Z" };
  const lines = (channels: ReturnType<typeof view>[], item: Partial<Parameters<typeof channelStatusLines>[0]["item"]> = {}) =>
    channelStatusLines({
      now: NOW,
      delayMinutes: 30,
      item: { status: "published", socialAt: "2026-11-05T17:00:00Z", publishedAt: "2026-11-05T12:00:00Z", skip: false, ...item },
      channels,
    });

  it("gives one line per channel: confirmed, waiting, posted", () => {
    expect(lines([
      view("LinkedIn", confirmedAt),
      view("X", null),
      view("Facebook", { ...confirmedAt, posted_at: "2026-11-05T15:00:00Z" }),
    ])).toEqual([
      "LinkedIn: confirmed by Jas 5 Nov 14:02, posts 17:00",
      "X: waiting for confirmation",
      "Facebook: posted 5 Nov 15:00",
    ]);
  });

  it("says why a confirmed channel is waiting again", () => {
    expect(lines([view("X", { ...confirmedAt, confirmed_text: "an older text" })]))
      .toEqual(["X: waiting for confirmation — the post changed after Jas confirmed it"]);
  });

  it("names Don't post, per channel or for the whole item", () => {
    expect(lines([view("X", { skip: true })])).toEqual(["X: won't be posted (“Don't post” is ticked)"]);
    expect(lines([view("X", confirmedAt)], { skip: true })).toEqual(["X: won't be posted (“Don't post” is ticked)"]);
  });

  it("before Live, says the post waits for it", () => {
    expect(lines([view("LinkedIn", confirmedAt)], { status: "draft", publishedAt: null, socialAt: null }))
      .toEqual(["LinkedIn: confirmed by Jas 5 Nov 14:02, posts 30 minutes after it goes live"]);
    expect(lines([view("LinkedIn", confirmedAt)], { status: "scheduled", publishedAt: null, socialAt: "2026-11-09T09:00:00Z" }))
      .toEqual(["LinkedIn: confirmed by Jas 5 Nov 14:02, posts 9 Nov 09:00, or as soon as it goes live if that's later"]);
  });

  it("a confirmed channel whose time has passed posts on the next run", () => {
    expect(lines([view("LinkedIn", confirmedAt)], { socialAt: null })).toEqual(["LinkedIn: confirmed by Jas 5 Nov 14:02, posts on the next run"]);
  });

  it("falls back to 'an admin' when the confirmer's name isn't known", () => {
    expect(lines([view("LinkedIn", confirmedAt, null)])[0]).toMatch(/^LinkedIn: confirmed by an admin /);
  });
});

describe("waitingSummary", () => {
  it("counts the channels still needing confirmation out of those connected", () => {
    expect(waitingSummary(1, 3)).toBe("1 of 3 channels needs confirming");
    expect(waitingSummary(2, 3)).toBe("2 of 3 channels need confirming");
    expect(waitingSummary(1, 1)).toBe("1 of 1 channel needs confirming");
  });
});

describe("socialSummary", () => {
  it("counts the channels by where they stand", () => {
    expect(socialSummary(["posted", "confirmed", "waiting", "waiting"])).toBe("Social post: 1 posted, 1 confirmed, 2 waiting for confirmation.");
    expect(socialSummary(["skipped", "skipped"])).toBe("Social post: 2 not posted (“Don't post”).");
  });

  it("says when there is nothing to post to", () => {
    expect(socialSummary([])).toBe("No social channels connected.");
  });
});

describe("socialNotes", () => {
  it("says when nothing will really be posted, and when the last attempt failed", () => {
    expect(socialNotes({ live: true, job: null })).toEqual([]);
    expect(socialNotes({ live: false, job: null })).toEqual(["Buffer isn't connected here, so nothing will actually be posted."]);
    expect(socialNotes({ live: true, job: { status: "dead" } }))
      .toEqual(["The last attempt to post failed. It's listed in Needs You Today."]);
  });
});

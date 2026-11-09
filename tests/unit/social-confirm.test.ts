import { describe, expect, it } from "vitest";
import { channelState, channelStatusLines, snapshotMatches, socialNotes, socialSummary, waitingSummary, type ChannelRecord } from "@/lib/social-confirm";

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
  const confirmedAt = { confirmed_text: text, confirmed_at: "2026-11-05T14:02:00Z", send_mode: "schedule" as const };
  const lines = (channels: ReturnType<typeof view>[], item: Partial<Parameters<typeof channelStatusLines>[0]["item"]> = {}) =>
    channelStatusLines({
      now: NOW,
      delayMinutes: 30,
      item: { status: "published", socialAt: "2026-11-05T17:00:00Z", publishedAt: "2026-11-05T12:00:00Z", skip: false, ...item },
      channels,
    });

  it("gives one line per channel: with Buffer, waiting, posted", () => {
    expect(lines([
      view("LinkedIn", { ...confirmedAt, handed_at: "2026-11-05T14:02:05Z", due_at: "2026-11-05T17:00:00Z" }),
      view("X", null),
      view("Facebook", { ...confirmedAt, handed_at: "2026-11-05T14:02:05Z", posted_at: "2026-11-05T15:00:00Z" }),
    ])).toEqual([
      "LinkedIn: scheduled in Buffer for 17:00",
      "X: waiting — Schedule or Publish now",
      "Facebook: posted 5 Nov 15:00",
    ]);
  });

  it("says a post whose time has come is going out, and when Buffer couldn't send it", () => {
    expect(lines([view("X", { ...confirmedAt, handed_at: "2026-11-05T15:00:00Z", due_at: "2026-11-05T15:00:00Z" })]))
      .toEqual(["X: with Buffer, sending now"]);
    expect(lines([view("X", { ...confirmedAt, handed_at: "2026-11-05T15:00:00Z", due_at: "2026-11-05T15:00:00Z", buffer_status: "error" })]))
      .toEqual(["X: Buffer couldn't send it. Check the post in Buffer."]);
  });

  it("warns when Buffer still holds an older version it couldn't take back", () => {
    expect(lines([view("X", { ...confirmedAt, confirmed_text: "an older text", handed_at: "2026-11-05T14:00:00Z", due_at: "2026-11-05T17:00:00Z" })])[0])
      .toMatch(/^X: ⚠ Buffer still holds an older version/);
  });

  it("says why a scheduled channel is waiting again", () => {
    expect(lines([view("X", { ...confirmedAt, confirmed_text: "an older text" })]))
      .toEqual(["X: waiting — the post changed after Jas scheduled it"]);
  });

  it("names Don't post, per channel or for the whole item", () => {
    expect(lines([view("X", { skip: true })])).toEqual(["X: won't be posted (“Don't post” is ticked)"]);
    expect(lines([view("X", confirmedAt)], { skip: true })).toEqual(["X: won't be posted (“Don't post” is ticked)"]);
  });

  it("before Live, says the post waits for it, and how it'll go", () => {
    expect(lines([view("LinkedIn", confirmedAt)], { status: "draft", publishedAt: null, socialAt: null }))
      .toEqual(["LinkedIn: scheduled by Jas 5 Nov 14:02, posts 30 minutes after it goes live"]);
    expect(lines([view("LinkedIn", confirmedAt)], { status: "scheduled", publishedAt: null, socialAt: "2026-11-09T09:00:00Z" }))
      .toEqual(["LinkedIn: scheduled by Jas 5 Nov 14:02, posts 9 Nov 09:00, or as soon as it goes live if that's later"]);
    expect(lines([view("LinkedIn", { ...confirmedAt, send_mode: "now" })], { status: "draft", publishedAt: null }))
      .toEqual(["LinkedIn: to publish now by Jas 5 Nov 14:02, goes to Buffer as soon as it goes live"]);
  });

  it("a Live item's scheduled channel not yet with Buffer is on its way there", () => {
    expect(lines([view("LinkedIn", confirmedAt)])).toEqual(["LinkedIn: scheduled by Jas 5 Nov 14:02, going to Buffer"]);
  });

  it("falls back to 'an admin' when the scheduler's name isn't known", () => {
    expect(lines([view("LinkedIn", confirmedAt, null)])[0]).toMatch(/^LinkedIn: scheduled by an admin /);
  });
});

describe("channelState", () => {
  const p = { channelId: "li", text: "Hi", imagePath: null };
  const r = (o: Partial<ChannelRecord>): ChannelRecord => ({
    channel_id: "li", skip: false, posted_at: null, confirmed_text: "Hi", confirmed_image: null, confirmed_at: "2026-11-05T14:00:00Z", ...o,
  });
  it("is handed while Buffer holds it, posted once Buffer sent it — whatever else changed", () => {
    expect(channelState({ post: p, record: r({ handed_at: "2026-11-05T14:01:00Z" }) }, false)).toBe("handed");
    expect(channelState({ post: p, record: r({ handed_at: "2026-11-05T14:01:00Z", posted_at: "2026-11-05T15:00:00Z" }) }, true)).toBe("posted");
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
    expect(socialSummary(["posted", "handed", "confirmed", "waiting", "waiting"])).toBe("Social post: 1 posted, 1 with Buffer, 1 scheduled, 2 waiting.");
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

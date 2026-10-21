import { describe, expect, it, vi } from "vitest";
import {
  composeSocialText,
  queueSocialPush,
  rescheduleSocialPush,
  socialDueAt,
  socialFieldsFromForm,
  socialStatusLine,
  SOCIAL_LEAD_MAX,
  fillStoryPostLinks,
} from "@/lib/social-push";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder, sequence } from "../stubs/supabase";

const NOW = new Date("2026-07-01T12:00:00Z");
const caps = { per_day: 3, delay_minutes: 45 };

describe("socialDueAt", () => {
  it("is publication plus the delay when the item has no time of its own", () => {
    expect(socialDueAt({ socialAt: null, publishedAt: NOW, delayMinutes: 45, now: NOW }).toISOString()).toBe("2026-07-01T12:45:00.000Z");
  });

  it("uses the item's own time", () => {
    expect(socialDueAt({ socialAt: "2026-07-01T16:00:00Z", publishedAt: NOW, delayMinutes: 45, now: NOW }).toISOString()).toBe("2026-07-01T16:00:00.000Z");
  });

  it("never posts before now, even for a time set earlier than publication", () => {
    expect(socialDueAt({ socialAt: "2026-07-01T08:00:00Z", publishedAt: NOW, delayMinutes: 45, now: NOW })).toEqual(NOW);
  });
});

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

describe("queueSocialPush", () => {
  it("replaces any pending push for the item, then queues one for its time", async () => {
    const jobs = queryBuilder(dbOk(null));
    const db = asDb(mockDb({ from: fromByTable({
      stories: () => queryBuilder(dbOk({ social_at: "2099-01-01T10:00:00Z", social_posted_at: null, published_at: NOW.toISOString() })),
      jobs: () => jobs,
    }) }));
    const enqueue = vi.fn(async () => {});

    const due = await queueSocialPush(db, { story_id: "s1" }, enqueue, caps);

    expect(jobs.delete).toHaveBeenCalled();
    expect(jobs.filter).toHaveBeenCalledWith("payload->>story_id", "eq", "s1");
    expect(enqueue).toHaveBeenCalledWith("social_push", { story_id: "s1" }, new Date("2099-01-01T10:00:00Z"));
    expect(due?.toISOString()).toBe("2099-01-01T10:00:00.000Z");
  });

  it("does nothing for an item already posted", async () => {
    const db = asDb(mockDb({ from: fromByTable({
      videos: () => queryBuilder(dbOk({ social_at: null, social_posted_at: "2026-06-01T00:00:00Z", published_at: null })),
    }) }));
    const enqueue = vi.fn(async () => {});

    expect(await queueSocialPush(db, { video_id: "v1" }, enqueue, caps)).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("rescheduleSocialPush", () => {
  it("moves a pending push to the edited time", async () => {
    const jobs = sequence(dbOk([{ id: "j1" }]), dbOk(null));
    const update = queryBuilder(dbOk(null));
    let call = 0;
    const db = asDb(mockDb({ from: fromByTable({
      jobs: () => (call++ === 0 ? jobs() : update),
      stories: () => queryBuilder(dbOk({ social_at: "2099-01-01T10:00:00Z", published_at: NOW.toISOString() })),
      settings: () => queryBuilder(dbOk({ value: caps })),
    }) }));

    await rescheduleSocialPush(db, { story_id: "s1" });

    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ due_at: "2099-01-01T10:00:00.000Z" }));
    expect(update.insert).not.toHaveBeenCalled();
  });

  it("never creates a push — saving a long-published story must not post it", async () => {
    const jobs = queryBuilder(dbOk([]));
    const db = asDb(mockDb({ from: fromByTable({ jobs: () => jobs }) }));

    expect(await rescheduleSocialPush(db, { story_id: "s1" })).toBeNull();
    expect(jobs.insert).not.toHaveBeenCalled();
    expect(jobs.update).not.toHaveBeenCalled();
  });
});

describe("socialStatusLine", () => {
  const base = { status: "published", social_at: null, social_skip: false, social_posted_at: null, scheduled_at: null, job: null, caps, live: true };

  it("says when it was posted, in UK time", () => {
    expect(socialStatusLine({ ...base, social_posted_at: "2026-07-01T09:00:00Z" })).toMatch(/^Posted to social on .*10:00/);
  });

  it("says when a queued post goes, and admits when Buffer isn't connected", () => {
    const job = { status: "pending", due_at: "2026-07-01T09:00:00Z" };
    expect(socialStatusLine({ ...base, job })).toMatch(/^Posts to social on .*10:00/);
    expect(socialStatusLine({ ...base, job, live: false })).toContain("Buffer isn't connected here");
    expect(socialStatusLine({ ...base, job, social_skip: true })).toMatch(/^Won't be posted/);
  });

  it("previews an unpublished item, warning about a post time before its publish time", () => {
    expect(socialStatusLine({ ...base, status: "draft" })).toBe("Posts to social 45 minutes after it goes live.");
    expect(socialStatusLine({ ...base, status: "scheduled", social_at: "2026-07-01T08:00:00Z", scheduled_at: "2026-07-01T09:00:00Z" }))
      .toContain("before its publish time");
  });

  it("points a failed post at Needs You Today", () => {
    expect(socialStatusLine({ ...base, job: { status: "dead", due_at: NOW.toISOString() } })).toContain("Needs You Today");
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

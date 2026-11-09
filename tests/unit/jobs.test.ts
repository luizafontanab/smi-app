import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueue, runDueJobs, runJobById, type JobKind } from "@/lib/jobs";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, sequence, type DbResult } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { SendResult } from "@/lib/adapters/newsletter";
import type { ChannelNetworks, SentPost } from "@/lib/adapters/social";
import { siteUrl } from "@/lib/site-url";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const send = vi.fn(async () => {});
vi.mock("@/lib/adapters/email", () => ({ getEmailSender: vi.fn(() => ({ send })) }));

type ChannelSend = { channelId: string; text: string; imagePath: string | null };
const publishChannel = vi.fn<(send: ChannelSend) => Promise<SentPost | null>>(async () => null);
const channelNetworks = vi.fn<() => Promise<ChannelNetworks>>(async () => ({ kind: "unknown" }));
const postLinks = vi.fn<(ids: string[]) => Promise<SentPost[]>>(async () => []);
const socialLive = vi.fn(() => false);
// The real channelPosts/channelText: what each channel receives is part of what's under test.
vi.mock("@/lib/adapters/social", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/adapters/social")>()),
  getSocialPublisher: vi.fn(() => ({ publishChannel, channelNetworks, postLinks })),
  isSocialLive: () => socialLive(),
}));

const crmSync = vi.fn(async () => {});
const crmPush = vi.fn(async () => {});
vi.mock("@/lib/adapters/crm", () => ({ getCrmSync: vi.fn(() => ({ sync: crmSync, pushContact: crmPush })) }));

const syncContacts = vi.fn(async () => ({ pushed: 3, failed: 0 }));
const sendIssue = vi.fn<(issueId: string, idempotencyKey: string) => Promise<SendResult>>(
  async () => ({ ok: true, recipients: 10 }),
);
const newsletterIsLive = vi.fn(() => true);
const issueItemsNotLive = vi.fn<(issueId: string) => Promise<string[]>>(async () => []);
vi.mock("@/lib/adapters/newsletter", () => ({
  getNewsletterSender: vi.fn(() => ({ syncContacts, sendIssue })),
  newsletterIsLive,
  issueItemsNotLive,
}));

// Three sweeps raise a console notification (fix-list 71). Asserted through
// the spy rather than through the inbox_messages builder: notifyConsole owns
// the row's shape and has its own tests — what belongs here is that each sweep
// raises the right KIND, about the right thing.
const { notifyConsole } = vi.hoisted(() => ({ notifyConsole: vi.fn(async () => {}) }));
vi.mock("@/lib/notify-admin", () => ({ ADMIN_EMAIL: "jas@sheetmetalindustries.com", notifyConsole }));
const { storyCrawlerOn, runSourceCheck, syncCompanies } = vi.hoisted(() => ({
  storyCrawlerOn: vi.fn(async () => true),
  runSourceCheck: vi.fn(async () => ({ status: "done" })),
  syncCompanies: vi.fn(async () => null),
}));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: storyCrawlerOn }));
vi.mock("@/lib/sources/run", () => ({ runSourceCheck }));
vi.mock("@/lib/crm-companies/sync", () => ({ syncCompanies }));
const { pushCompanyNewsPage, retryPendingCompanyPushes, checkCompanyWriteAccess } = vi.hoisted(() => ({
  pushCompanyNewsPage: vi.fn(async (): Promise<"pushed" | "pending" | "nothing"> => "pushed"),
  retryPendingCompanyPushes: vi.fn(async () => ({ pushed: 0, failed: 0 })),
  checkCompanyWriteAccess: vi.fn(async () => null),
}));
vi.mock("@/lib/crm-companies/news-page", () => ({ pushCompanyNewsPage, retryPendingCompanyPushes, checkCompanyWriteAccess }));
const { refreshSocialFollowers } = vi.hoisted(() => ({
  refreshSocialFollowers: vi.fn(async (): Promise<{ instagramProblem: string | null }> => ({ instagramProblem: null })),
}));
vi.mock("@/lib/adapters/social-followers", () => ({ refreshSocialFollowers }));
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));

afterEach(() => {
  resetDbServerMocks();
  vi.restoreAllMocks();
  send.mockReset().mockResolvedValue(undefined);
  publishChannel.mockReset().mockResolvedValue(null);
  channelNetworks.mockReset().mockResolvedValue({ kind: "unknown" });
  postLinks.mockReset().mockResolvedValue([]);
  socialLive.mockReset().mockReturnValue(false);
  vi.useRealTimers();
  crmSync.mockReset().mockResolvedValue(undefined);
  syncContacts.mockReset().mockResolvedValue({ pushed: 3, failed: 0 });
  sendIssue.mockReset().mockResolvedValue({ ok: true, recipients: 10 });
  newsletterIsLive.mockReset().mockReturnValue(true);
  logError.mockReset();
});

function job(kind: JobKind, overrides: Partial<{
  id: string; attempts: number; max_attempts: number; due_at: string; payload: unknown;
}> = {}) {
  return { id: "job1", kind, payload: {}, attempts: 0, max_attempts: 3, due_at: new Date().toISOString(), ...overrides };
}

function callsOf(mockFn: unknown): unknown[][] {
  return (mockFn as ReturnType<typeof vi.fn>).mock.calls;
}

/**
 * Routes .from("jobs") through one pre-built builder per call, in call order
 * (repeating the last once exhausted — extra claim/insert/done bookkeeping
 * calls beyond what a test cares about all land there, harmlessly, since
 * their results are never read). Every other table gets its own builder from
 * `others`, or a no-op default.
 */
function dbFor(
  jobsCalls: ReturnType<typeof queryBuilder>[],
  others: Record<string, () => ReturnType<typeof queryBuilder>> = {},
  rpc?: (...args: unknown[]) => unknown,
) {
  let i = 0;
  const from = vi.fn((table: string) =>
    table === "jobs" ? jobsCalls[Math.min(i++, jobsCalls.length - 1)] : (others[table] ?? (() => queryBuilder(dbOk(null))))(),
  );
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from, ...(rpc ? { rpc } : {}) })));
  return from;
}

/** select → claim → (anything else, incl. the final done update) for a job that's expected to run cleanly to completion. */
function happyPath(j: ReturnType<typeof job>) {
  return [queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))];
}

describe("enqueue", () => {
  it("inserts a jobs row with the given kind, payload, and due date", async () => {
    const builder = queryBuilder(dbOk(null));
    dbFor([builder]);
    const due = new Date("2026-09-01T00:00:00.000Z");

    await enqueue("social_push", { story_id: "s1" }, due);

    expect(builder.insert).toHaveBeenCalledWith({ kind: "social_push", payload: { story_id: "s1" }, due_at: due.toISOString() });
  });

  it("defaults due_at to now", async () => {
    const builder = queryBuilder(dbOk(null));
    dbFor([builder]);

    await enqueue("crm_sync");

    const [row] = callsOf(builder.insert)[0] as [{ due_at: string }];
    expect(Date.now() - Date.parse(row.due_at)).toBeLessThan(5000);
  });
});

describe("runJobById / claim mechanics", () => {
  it("does nothing when the job no longer exists", async () => {
    const selectBuilder = queryBuilder(dbOk(null));
    dbFor([selectBuilder]);

    await expect(runJobById("missing")).resolves.toBeUndefined();

    expect(selectBuilder.eq).toHaveBeenCalledWith("id", "missing");
  });

  it("does not run the job body when another runner already claimed it", async () => {
    const j = job("crm_sync");
    const claimBuilder = queryBuilder(dbOk([]));
    dbFor([queryBuilder(dbOk(j)), claimBuilder]);

    await runJobById(j.id);

    expect(crmSync).not.toHaveBeenCalled();
  });

  it("claims the job optimistically, runs it, and marks it done", async () => {
    const j = job("crm_sync", { attempts: 0 });
    const claimBuilder = queryBuilder(dbOk([{ id: j.id }]));
    const doneBuilder = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), claimBuilder, doneBuilder]);

    await runJobById(j.id);

    expect(claimBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "running", attempts: 1 }));
    expect(claimBuilder.eq).toHaveBeenCalledWith("status", "pending");
    expect(crmSync).toHaveBeenCalled();
    expect(doneBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "done" }));
  });

  it("hands the job back to pending on a provider rate limit, undoing the claim's attempt increment", async () => {
    const j = job("notify_member", { payload: { member_id: "m1", kind: "story_live" }, attempts: 1 });
    const retryBuilder = queryBuilder(dbOk(null));
    send.mockRejectedValueOnce({ name: "EmailSendError", status: 429, retryAfterMs: 5000 });
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), retryBuilder], {
      members: () => queryBuilder(dbOk({ id: "m1", name: "Acme", contact_email: "acme@example.com" })),
      notifications: () => queryBuilder(dbOk(null)),
    });

    await runJobById(j.id);

    expect(retryBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", attempts: 1 }));
    const [row] = callsOf(retryBuilder.update)[0] as [{ due_at: string }];
    expect(Date.parse(row.due_at) - Date.now()).toBeGreaterThan(3000); // ~5s pause, not the minute-scale backoff
  });

  it("retries with a minute-scale backoff on an ordinary failure below max attempts", async () => {
    const j = job("rollup_daily", { attempts: 1, max_attempts: 3 });
    const retryBuilder = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), retryBuilder], {}, async () => dbError("rollup failed"));

    await runJobById(j.id);

    expect(retryBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", last_error: expect.stringContaining("rollup failed") }));
    const [row] = callsOf(retryBuilder.update)[0] as [{ due_at: string }];
    expect(Date.parse(row.due_at) - Date.now()).toBeGreaterThan(50_000);
  });

  it("dead-letters the job once max attempts is reached, keeping the original due_at", async () => {
    const j = job("rollup_daily", { attempts: 2, max_attempts: 3, due_at: "2026-01-01T00:00:00.000Z" });
    const deadBuilder = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), deadBuilder], {}, async () => dbError("rollup failed"));

    await runJobById(j.id);

    expect(deadBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "dead", due_at: j.due_at }));
  });
});

describe("runDueJobs", () => {
  it("enqueues each periodic sweep when none is pending, and runs nothing when nothing is due", async () => {
    const insertedKinds: string[] = [];
    const from = vi.fn((table: string) => {
      if (table !== "jobs") return queryBuilder(dbOk(null));
      const builder = queryBuilder(() => {
        const inserts = callsOf(builder.insert);
        if (inserts.length) {
          insertedKinds.push((inserts[0][0] as { kind: string }).kind);
          return dbOk(null);
        }
        return dbOk([]); // no existing periodic job pending, and no due jobs either
      });
      return builder;
    });
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));

    const result = await runDueJobs();

    expect(result).toEqual({ ran: 0, failed: 0 });
    expect(insertedKinds.sort()).toEqual(
      [
        "admin_digest",
        "advert_lifecycle",
        "comp_expiry",
        "crm_sync",
        "dev_error_digest",
        "lead_alert",
        "log_retention",
        "membership_lapse",
        "newsletter_sync",
        "publish_scheduled",
        "rollup_daily",
        "social_followers",
        "source_bigin_sync",
        "source_watch",
        "stats_summary",
        "upload_staging_sweep",
      ].sort(),
    );
  });

  it("does not re-enqueue a periodic sweep that's already pending", async () => {
    const from = vi.fn((table: string) =>
      table === "jobs" ? queryBuilder(dbOk([{ id: "existing" }])) : queryBuilder(dbOk(null)),
    );
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));

    await runDueJobs();

    expect(from.mock.calls.filter(([t]) => t === "jobs").length).toBeGreaterThan(0);
    // every "jobs" call in this scenario is a read (existing rows already found) — never an insert
    const jobsFrom = from("jobs") as ReturnType<typeof queryBuilder>;
    expect(callsOf(jobsFrom.insert)).toHaveLength(0);
  });

  it("processes due jobs and reports how many ran vs failed", async () => {
    const due = [job("crm_sync", { id: "j1" }), job("rollup_daily", { id: "j2" })];
    const jobsBuilder = () => {
      const builder = queryBuilder(() => {
        const updates = callsOf(builder.update);
        if (updates.length) {
          const status = (updates[0][0] as { status?: string }).status;
          return status === "running" ? dbOk([{ id: "claimed" }]) : dbOk(null);
        }
        if (callsOf(builder.insert).length) return dbOk(null);
        return dbOk(due); // both the periodic-existence checks and the main due-jobs select are satisfied by a non-empty list
      });
      return builder;
    };
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ jobs: jobsBuilder }, () => queryBuilder(dbOk(null))),
      rpc: async () => dbError("rollup failed"),
    })));

    const result = await runDueJobs();

    expect(result).toEqual({ ran: 1, failed: 1 });
    expect(crmSync).toHaveBeenCalled();
  });
});

describe("runJob kinds", () => {
  describe("story crawler jobs follow the Story crawler flag", () => {
    afterEach(() => {
      storyCrawlerOn.mockReset().mockResolvedValue(true);
      runSourceCheck.mockClear();
      syncCompanies.mockClear();
    });

    it.each([
      ["source_watch", runSourceCheck],
      ["source_bigin_sync", syncCompanies],
    ] as const)("%s runs while the flag is on", async (kind, fn) => {
      const j = job(kind);
      dbFor(happyPath(j));
      await runJobById(j.id);
      expect(storyCrawlerOn).toHaveBeenCalledWith("story_crawler");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["source_watch", runSourceCheck],
      ["source_bigin_sync", syncCompanies],
    ] as const)("%s does nothing while it's off, and still completes", async (kind, fn) => {
      storyCrawlerOn.mockResolvedValue(false);
      const j = job(kind);
      const [select, claim, tail] = happyPath(j);
      dbFor([select, claim, tail]);
      await runJobById(j.id);
      expect(fn).not.toHaveBeenCalled();
      expect(callsOf(tail.update)).toContainEqual([expect.objectContaining({ status: "done" })]);
    });

    it("source_watch comes back once the lock is free when another check holds it, instead of losing its turn", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const retryAt = new Date("2026-11-05T10:44:30Z");
      runSourceCheck.mockResolvedValueOnce({ status: "busy", run: null, retryAt } as never);
      const j = job("source_watch");
      const [select, claim, tail] = happyPath(j);
      dbFor([select, claim, tail]);

      await runJobById(j.id);

      expect(callsOf(tail.insert)).toContainEqual([{ kind: "source_watch", payload: { after_busy: j.id }, due_at: retryAt.toISOString() }]);
      // a skip isn't a failure: the job itself completes
      expect(callsOf(tail.update)).toContainEqual([expect.objectContaining({ status: "done" })]);
    });

    it("source_watch queues nothing extra when its check ran", async () => {
      const j = job("source_watch");
      const [select, claim, tail] = happyPath(j);
      dbFor([select, claim, tail]);
      await runJobById(j.id);
      expect(callsOf(tail.insert)).toEqual([]);
    });
  });

  it("publish_scheduled — publishes ready stories/videos and enqueues their follow-up jobs, but no unconfirmed social post", async () => {
    const j = job("publish_scheduled");
    const storiesBuilder = queryBuilder(dbOk([{ id: "s1", member_id: "m1" }]));
    const videosBuilder = queryBuilder(dbOk([{ id: "v1", member_id: "m2" }]));
    const settingsBuilder = queryBuilder(dbOk({ value: { delay_minutes: 30 } }));
    const jobsTail = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], {
      stories: () => storiesBuilder, videos: () => videosBuilder, settings: () => settingsBuilder,
    });

    await runJobById(j.id);

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
    expect(videosBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
    const kinds = callsOf(jobsTail.insert).map(([row]) => (row as { kind: string }).kind);
    // Issue #43: going Live posts nothing to social until a channel is confirmed.
    expect(kinds.filter((k) => k === "social_push")).toHaveLength(0);
    expect(kinds.filter((k) => k === "notify_member")).toHaveLength(2); // both ready items have a member_id
  });

  /** A live story as social_push reads it; override what the test is about. */
  const liveStory = (o: Record<string, unknown> = {}) => ({
    id: "s1", title: "Acme wins award", slug: "acme-wins-award", cover_path: "c.jpg", member_id: null,
    status: "published", social_at: null, social_text: null, social_skip: false,
    published_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    summary: "Acme took the top prize at the awards.", member: null, social_posts: {}, ...o,
  });
  const STORY_TEXT = () => `Acme took the top prize at the awards.\n\n${siteUrl()}/news/acme-wins-award`;
  /** A channel an admin confirmed an hour ago, receiving `text`. */
  const confirmedRow = (channel_id: string, text: string, o: Record<string, unknown> = {}) => ({
    channel_id, skip: false, posted_at: null, confirmed_text: text, confirmed_image: "c.jpg",
    confirmed_at: new Date(Date.now() - 3_600_000).toISOString(), confirmer: { display_name: "Jas" }, ...o,
  });

  /**
   * One social_push run for story s1 (or video v1). social_channel_posts is
   * read for the channel rows, then for today's posted count; every call after
   * that lands on `writes` — the clears, each channel's claim (which sees
   * `claimed`, by default the rows, so it wins), the hand-back, the Buffer id,
   * and the closing re-read that queues the next run (which sees the rows).
   */
  function socialRun(o: {
    payload?: Record<string, unknown>;
    story?: Record<string, unknown>;
    video?: Record<string, unknown>;
    rows?: unknown[];
    postedToday?: unknown[];
    channels?: string[];
    caps?: Record<string, unknown>;
    members?: unknown[];
    jobs?: ReturnType<typeof queryBuilder>[];
    claimed?: unknown[];
  } = {}) {
    const j = job("social_push", { payload: o.payload ?? { story_id: "s1" } });
    const tail = queryBuilder(dbOk(null));
    const writes = queryBuilder(dbOk(o.claimed ?? o.rows ?? []));
    const stories = queryBuilder(dbOk(liveStory(o.story)));
    const reads = [queryBuilder(dbOk(o.rows ?? [])), queryBuilder(dbOk(o.postedToday ?? []))];
    let n = 0;
    dbFor(o.jobs ?? [queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), tail], {
      stories: () => stories,
      videos: () => queryBuilder(dbOk(o.video ?? null)),
      story_members: () => queryBuilder(dbOk(o.members ?? [])),
      settings: () => queryBuilder(dbOk({ value: { channelIds: o.channels ?? ["li"], per_day: 3, delay_minutes: 30, ...o.caps } })),
      social_channel_posts: () => reads[n++] ?? writes,
    });
    return { j, tail, writes, stories };
  }
  const sentTo = () => publishChannel.mock.calls.map(([p]) => p.channelId);

  it("social_push — posts a confirmed channel exactly what was confirmed, with the image", async () => {
    const { j } = socialRun({ rows: [confirmedRow("li", STORY_TEXT())] });

    await runJobById(j.id);

    expect(publishChannel).toHaveBeenCalledWith({ channelId: "li", text: STORY_TEXT(), imagePath: "c.jpg" });
  });

  it("social_push — stamps a channel posted only when Buffer is really connected", async () => {
    for (const live of [false, true]) {
      socialLive.mockReturnValue(live);
      publishChannel.mockResolvedValueOnce({ id: "p1", service: "linkedin", status: "sending", link: null });
      const { j, writes } = socialRun({ rows: [confirmedRow("li", STORY_TEXT())] });
      await runJobById(j.id);
      const stamped = callsOf(writes.update).some(([v]) => !!(v as { posted_at?: string }).posted_at);
      expect(stamped).toBe(live);
      if (live) {
        expect(writes.update).toHaveBeenCalledWith(expect.objectContaining({ buffer_post_id: "p1" }));
        expect(writes.eq).toHaveBeenCalledWith("channel_id", "li");
      }
    }
  });

  it("social_push — claims each channel before sending it, so two runs can't both post it", async () => {
    socialLive.mockReturnValue(true);
    const { j, writes } = socialRun({ rows: [confirmedRow("li", STORY_TEXT())] });

    await runJobById(j.id);

    // stamped only while still unstamped, still confirmed with this text, and not Don't post — then sent
    const [claim] = callsOf(writes.update)[0] as [{ posted_at: string }];
    expect(claim.posted_at).toEqual(expect.any(String));
    expect(writes.is).toHaveBeenCalledWith("posted_at", null);
    expect(writes.eq).toHaveBeenCalledWith("confirmed_text", STORY_TEXT());
    expect(publishChannel).toHaveBeenCalledTimes(1);
  });

  it("social_push — doesn't send a channel another run claimed first", async () => {
    socialLive.mockReturnValue(true);
    const { j } = socialRun({ rows: [confirmedRow("li", STORY_TEXT())], claimed: [] });

    await runJobById(j.id);

    expect(publishChannel).not.toHaveBeenCalled();
  });

  it("social_push — when it ends, queues the next run afresh, replacing a push queued while it ran", async () => {
    const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const { j, tail } = socialRun({
      channels: ["li", "x"],
      rows: [confirmedRow("li", STORY_TEXT()), confirmedRow("x", STORY_TEXT(), { confirmed_at: later })],
    });

    await runJobById(j.id);

    expect(tail.delete).toHaveBeenCalled(); // any pending duplicate for s1 is dropped
    const pushes = callsOf(tail.insert).map(([r]) => r as { kind: string; due_at: string }).filter((r) => r.kind === "social_push");
    expect(pushes).toEqual([expect.objectContaining({ due_at: later })]); // one job, for x
  });

  it("social_push — posts the confirmed channel while another still waits for confirmation", async () => {
    const { j, tail } = socialRun({ channels: ["li", "x"], rows: [confirmedRow("li", STORY_TEXT())] });

    await runJobById(j.id);

    expect(sentTo()).toEqual(["li"]);
    // nothing re-queued for x: confirming it queues its post
    expect(callsOf(tail.insert).some(([r]) => (r as { kind: string }).kind === "social_push")).toBe(false);
  });

  it("social_push — a post that changed since it was confirmed doesn't go out, and waits for confirmation again", async () => {
    const { j, writes } = socialRun({ rows: [confirmedRow("li", "What it said when Jas confirmed it")] });

    await runJobById(j.id);

    expect(publishChannel).not.toHaveBeenCalled();
    expect(writes.update).toHaveBeenCalledWith(expect.objectContaining({ confirmed_text: null, confirmed_at: null, confirmed_by: null }));
    expect(writes.in).toHaveBeenCalledWith("channel_id", ["li"]);
  });

  it("social_push — a member editing their X handle holds back only the X post", async () => {
    channelNetworks.mockResolvedValue({ kind: "known", services: new Map([["li", "linkedin"], ["x", "twitter"]]) });
    const { j, writes } = socialRun({
      channels: ["li", "x"],
      story: { member: { name: "Acme", social: { linkedin: "acme-ltd", x: "acme_new" }, status: "active", archived_at: null } },
      rows: [
        confirmedRow("li", `${STORY_TEXT()}\n\nlinkedin:acme-ltd`),
        confirmedRow("x", `${STORY_TEXT()}\n\nx:@acme_old`),
      ],
    });

    await runJobById(j.id);

    expect(sentTo()).toEqual(["li"]);
    expect(writes.in).toHaveBeenCalledWith("channel_id", ["x"]);
  });

  it("social_push — doesn't post anything, or ask Buffer anything, when nobody confirmed", async () => {
    const { j } = socialRun({ rows: [] });
    await runJobById(j.id);
    expect(channelNetworks).not.toHaveBeenCalled();
    expect(publishChannel).not.toHaveBeenCalled();
  });

  // Re-checked when it runs, not when it was queued.
  it.each([
    ["taken off the site inside the delay", { story: { status: "draft" } }],
    ["“don't post” ticked for the whole item", { story: { social_skip: true } }],
    ["“don't post” ticked for that channel", { rows: [{ skip: true }] }],
    ["that channel already posted", { rows: [{ posted_at: "2026-10-20T09:00:00Z" }] }],
  ])("social_push (story) — doesn't post when %s", async (_why, o: { story?: Record<string, unknown>; rows?: Record<string, unknown>[] }) => {
    const { j, writes } = socialRun({ story: o.story, rows: [confirmedRow("li", STORY_TEXT(), o.rows?.[0])] });

    await runJobById(j.id);

    expect(publishChannel).not.toHaveBeenCalled();
    expect(writes.update).not.toHaveBeenCalled();
  });

  it("social_push — waits for a post time moved later after it was queued", async () => {
    const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const { j, tail } = socialRun({ story: { social_at: later }, rows: [confirmedRow("li", STORY_TEXT())] });

    await runJobById(j.id);

    expect(publishChannel).not.toHaveBeenCalled();
    expect(callsOf(tail.insert)[0]?.[0]).toEqual(expect.objectContaining({ kind: "social_push", due_at: later }));
  });

  it("social_push — retries rather than posting when Buffer can't say which network each channel is", async () => {
    channelNetworks.mockResolvedValue({ kind: "failed" });
    const { j, tail, writes } = socialRun({ rows: [confirmedRow("li", STORY_TEXT())] });

    await runJobById(j.id);

    expect(publishChannel).not.toHaveBeenCalled();
    expect(writes.update).not.toHaveBeenCalled(); // the confirmation stands
    expect(tail.update).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", last_error: expect.stringContaining("network") }));
  });

  it("social_push (story) — the editor's lead-in wins over the summary, and the title is the last resort", async () => {
    for (const [row, lead] of [
      [{ social_text: "Our own words." }, "Our own words."],
      [{ summary: null }, "Acme wins award"],
    ] as const) {
      publishChannel.mockClear();
      const text = `${lead}\n\n${siteUrl()}/news/acme-wins-award`;
      const { j } = socialRun({ story: row, rows: [confirmedRow("li", text)] });
      await runJobById(j.id);
      expect(publishChannel.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ text }));
    }
  });

  // Jas 13/10 item 12: every member the story features is tagged, not only the primary.
  it("social_push (story) — also tags the members featured alongside the primary", async () => {
    const text = `${STORY_TEXT()}\n\nx:@acme x:@blmgroup`; // the primary isn't repeated as an extra
    const { j } = socialRun({
      story: { member_id: "m1", member: { name: "Acme", social: { x: "acme" }, status: "active", archived_at: null } },
      members: [
        { member: { id: "m1", slug: "acme", name: "Acme", logo_path: null, social: { x: "acme" }, status: "active", archived_at: null } },
        { member: { id: "m2", slug: "blm", name: "BLM", logo_path: null, social: { x: "blmgroup" }, status: "active", archived_at: null } },
      ],
      rows: [confirmedRow("li", text)],
    });

    await runJobById(j.id);

    expect(publishChannel.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ text }));
  });

  // Review finding 12 (ask-jas 14 still open): no tag for a member without a
  // public page — archived, or lapsed — primary or extra alike.
  it("social_push (story) — tags no member who isn't linkable, primary or extra", async () => {
    const text = `${STORY_TEXT()}\n\nx:@cutters`;
    const { j } = socialRun({
      story: { member_id: "m1", member: { name: "Acme", social: { x: "acme" }, status: "lapsed", archived_at: null } },
      members: [
        { member: { id: "m1", slug: "acme", name: "Acme", logo_path: null, social: { x: "acme" }, status: "lapsed", archived_at: null } },
        { member: { id: "m2", slug: "blm", name: "BLM", logo_path: null, social: { x: "blmgroup" }, status: "active", archived_at: "2026-10-01T00:00:00Z" } },
        { member: { id: "m3", slug: "cut", name: "Cutters", logo_path: null, social: { x: "cutters" }, status: "grace", archived_at: null } },
      ],
      rows: [confirmedRow("li", text)],
    });

    await runJobById(j.id);

    expect(publishChannel.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ text }));
  });

  const liveVideo = (o: Record<string, unknown> = {}) => ({
    id: "v1", title: "Laser demo", slug: "laser-demo", thumbnail_path: null, description: "<p>The new <b>6kW</b> laser cutting 20mm plate.</p>",
    status: "published", social_at: null, social_text: null, social_skip: false,
    published_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    member: { name: "Acme", social: { x: "acme" }, status: "active", archived_at: "2026-10-01T00:00:00Z" }, ...o,
  });

  it("social_push (video) — leads with its description, links to /video, and doesn't tag an archived member", async () => {
    const text = `The new 6kW laser cutting 20mm plate.\n\n${siteUrl()}/video/laser-demo`;
    const { j } = socialRun({ payload: { video_id: "v1" }, video: liveVideo(), rows: [confirmedRow("li", text, { confirmed_image: null })] });

    await runJobById(j.id);

    expect(publishChannel).toHaveBeenCalledWith({ channelId: "li", text, imagePath: null });
  });

  it("social_push (video) — doesn't post a video that isn't live", async () => {
    const text = `The new 6kW laser cutting 20mm plate.\n\n${siteUrl()}/video/laser-demo`;
    const { j } = socialRun({ payload: { video_id: "v1" }, video: liveVideo({ status: "withdrawn" }), rows: [confirmedRow("li", text, { confirmed_image: null })] });

    await runJobById(j.id);

    expect(publishChannel).not.toHaveBeenCalled();
  });

  it("publish_scheduled — tells each co-featured member their story is live", async () => {
    const j = job("publish_scheduled");
    const jobsTail = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], {
      stories: () => queryBuilder(dbOk([{ id: "s1", member_id: "m1" }])),
      videos: () => queryBuilder(dbOk([])),
      story_members: () => queryBuilder(dbOk([
        { member: { id: "m1", slug: "a", name: "A", logo_path: null, social: {}, status: "active", archived_at: null } },
        { member: { id: "m2", slug: "b", name: "B", logo_path: null, social: {}, status: "grace", archived_at: null } },
        { member: { id: "m3", slug: "c", name: "C", logo_path: null, social: {}, status: "active", archived_at: "2026-10-01" } },
      ])),
      settings: () => queryBuilder(dbOk({ value: { delay_minutes: 30 } })),
    });

    await runJobById(j.id);

    const notices = callsOf(jobsTail.insert)
      .map(([row]) => row as { kind: string; payload: { member_id: string; kind: string } })
      .filter((r) => r.kind === "notify_member")
      .map((r) => `${r.payload.member_id}:${r.payload.kind}`);
    expect(notices).toEqual(["m1:story_live", "m2:story_featured"]); // the archived m3 is skipped
  });

  /** A channel confirmed before the item went Live. */
  const confirmedEarlier = { channel_id: "li", skip: false, posted_at: null, confirmed_at: new Date(Date.now() - 3_600_000).toISOString() };

  it("publish_scheduled — queues a confirmed social post for the story's own post time", async () => {
    const at = new Date(Date.now() + 5 * 3_600_000).toISOString();
    const j = job("publish_scheduled");
    const jobsTail = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], {
      // ready list → publish update (the conditional write returns the row it changed) → queueSocialPush's read of the row
      stories: sequence<unknown>(dbOk([{ id: "s1", member_id: null }]), dbOk({ id: "s1" }), dbOk({ status: "published", social_at: at, social_skip: false, published_at: new Date().toISOString() })),
      videos: () => queryBuilder(dbOk([])),
      settings: () => queryBuilder(dbOk({ value: { delay_minutes: 30, channelIds: ["li"] } })),
      social_channel_posts: () => queryBuilder(dbOk([confirmedEarlier])),
    });

    await runJobById(j.id);

    const push = callsOf(jobsTail.insert).map(([row]) => row as { kind: string; due_at: string }).find((r) => r.kind === "social_push");
    expect(push?.due_at).toBe(at);
  });

  it("publish_scheduled — a row whose write fails is logged, and the next row is still published", async () => {
    const j = job("publish_scheduled");
    const jobsTail = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], {
      // ready list → s1's write fails → s2's write lands → queueSocialPush's read of s2
      stories: sequence<unknown>(
        dbOk([{ id: "s1", member_id: "m1" }, { id: "s2", member_id: "m2" }]),
        dbError("deadlock detected"),
        dbOk({ id: "s2" }),
        dbOk({ status: "published", social_at: null, social_skip: false, published_at: new Date().toISOString() }),
      ),
      videos: () => queryBuilder(dbOk([])),
      story_members: () => queryBuilder(dbOk([])),
      settings: () => queryBuilder(dbOk({ value: { delay_minutes: 30, channelIds: ["li"] } })),
      social_channel_posts: () => queryBuilder(dbOk([confirmedEarlier])),
    });

    await runJobById(j.id);

    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({
      source: "job",
      area: "job:publish_scheduled",
      error: "deadlock detected",
      context: { kind: "story", id: "s1" },
    }));
    const rows = callsOf(jobsTail.insert).map(([row]) => row as { kind: string; payload: Record<string, unknown> });
    expect(rows.filter((r) => r.kind === "social_push").map((r) => r.payload)).toEqual([{ story_id: "s2" }]);
    expect(rows.filter((r) => r.kind === "notify_member").map((r) => r.payload.member_id)).toEqual(["m2"]);
    // the job itself still completes — one bad row doesn't fail the sweep
    expect(callsOf(jobsTail.update)).toContainEqual([expect.objectContaining({ status: "done" })]);
  });

  it("publish_scheduled — a row someone else already moved is skipped: no post, no email, no log", async () => {
    const j = job("publish_scheduled");
    const jobsTail = queryBuilder(dbOk(null));
    const stories = sequence<unknown>(dbOk([{ id: "s1", member_id: "m1" }]), dbOk(null)); // the write matched no row
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], {
      stories,
      videos: () => queryBuilder(dbOk([])),
      story_members: () => queryBuilder(dbOk([{ member: { id: "m1", slug: "a", name: "A", logo_path: null, social: {}, status: "active", archived_at: null } }])),
      settings: () => queryBuilder(dbOk({ value: { delay_minutes: 30 } })),
    });

    await runJobById(j.id);

    const kinds = callsOf(jobsTail.insert).map(([row]) => (row as { kind: string }).kind);
    expect(kinds).not.toContain("social_push");
    expect(kinds).not.toContain("notify_member");
    expect(send).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  // 21 Oct: the story's post-link fields are filled from Buffer, not pasted.
  const LI = "https://www.linkedin.com/feed/update/urn:li:share:1";
  const FB = "https://www.facebook.com/smi/posts/1";

  it("social_push (story) — writes the links Buffer already has, and looks up the rest later", async () => {
    publishChannel
      .mockResolvedValueOnce({ id: "p1", service: "linkedin", status: "sent", link: LI })
      .mockResolvedValueOnce({ id: "p2", service: "twitter", status: "sending", link: null })
      .mockResolvedValueOnce({ id: "p3", service: "instagram", status: "sending", link: null }); // no field for it
    const { j, tail, stories } = socialRun({
      channels: ["li", "x", "ig"],
      rows: ["li", "x", "ig"].map((c) => confirmedRow(c, STORY_TEXT())),
    });

    await runJobById(j.id);

    expect(stories.update).toHaveBeenCalledWith({ social_posts: { linkedin: LI } });
    const follow = callsOf(tail.insert).map(([r]) => r as { kind: string; payload: unknown }).find((r) => r.kind === "social_links");
    expect(follow?.payload).toEqual({ story_id: "s1", post_ids: ["p2"], tries: 0 });
  });

  it("social_push — one channel failing doesn't stop the others, and the retry posts only the one still owed", async () => {
    socialLive.mockReturnValue(true);
    publishChannel
      .mockResolvedValueOnce({ id: "p1", service: "linkedin", status: "sent", link: LI })
      .mockRejectedValueOnce(new Error("[social] Buffer publish failed for channel x — too long"));
    const { j, tail, writes, stories } = socialRun({
      channels: ["li", "x"],
      rows: [confirmedRow("li", STORY_TEXT()), confirmedRow("x", STORY_TEXT())],
    });

    await runJobById(j.id);

    expect(sentTo()).toEqual(["li", "x"]);
    // li is claimed before sending and keeps its Buffer id; x's claim is handed back; the job fails, so it retries
    expect(writes.update).toHaveBeenCalledWith(expect.objectContaining({ posted_at: expect.any(String) }));
    expect(writes.update).toHaveBeenCalledWith(expect.objectContaining({ buffer_post_id: "p1" }));
    expect(writes.update).toHaveBeenCalledWith(expect.objectContaining({ posted_at: null }));
    expect(stories.update).toHaveBeenCalledWith({ social_posts: { linkedin: LI } });
    expect(tail.update).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", last_error: expect.stringContaining("too long") }));

    // the retry: li now carries its stamp
    publishChannel.mockClear().mockResolvedValue(null);
    const retry = socialRun({
      channels: ["li", "x"],
      rows: [confirmedRow("li", STORY_TEXT(), { posted_at: new Date().toISOString() }), confirmedRow("x", STORY_TEXT())],
    });
    await runJobById(retry.j.id);
    expect(sentTo()).toEqual(["x"]);
  });

  it("social_push — a failing channel doesn't strand one confirmed for later: its run is queued before the job fails", async () => {
    socialLive.mockReturnValue(true);
    publishChannel.mockRejectedValueOnce(new Error("[social] Buffer publish failed for channel li — down"));
    const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const { j, tail } = socialRun({
      channels: ["li", "x"],
      rows: [confirmedRow("li", STORY_TEXT()), confirmedRow("x", STORY_TEXT(), { confirmed_at: later })],
    });

    await runJobById(j.id);

    // x's run at its own time, not li's retry (that is this job's own)
    expect(callsOf(tail.insert)).toContainEqual([expect.objectContaining({ kind: "social_push", due_at: later })]);
    expect(tail.update).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", last_error: expect.stringContaining("down") }));
  });

  it("social_push (story) — never overwrites a link someone pasted", async () => {
    publishChannel.mockResolvedValue({ id: "p1", service: "linkedin", status: "sent", link: LI });
    const { j, stories } = socialRun({
      story: { social_posts: { linkedin: "https://www.linkedin.com/posts/pasted" } },
      rows: [confirmedRow("li", STORY_TEXT())],
    });

    await runJobById(j.id);

    expect(stories.update).not.toHaveBeenCalledWith(expect.objectContaining({ social_posts: expect.anything() }));
  });

  it("social_links — fills the links Buffer now has and asks again about the rest, later each time", async () => {
    postLinks.mockResolvedValue([
      { id: "p1", service: "facebook", status: "sent", link: FB },
      { id: "p2", service: "twitter", status: "sending", link: null },
    ]);
    const j = job("social_links", { payload: { story_id: "s1", post_ids: ["p1", "p2", "p3"], tries: 0 } });
    const jobsTail = queryBuilder(dbOk(null));
    const stories = queryBuilder(dbOk({ social_posts: { linkedin: LI } }));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], { stories: () => stories });
    const before = Date.now();

    await runJobById(j.id);

    expect(postLinks).toHaveBeenCalledWith(["p1", "p2", "p3"]);
    expect(stories.update).toHaveBeenCalledWith({ social_posts: { linkedin: LI, facebook: FB } });
    const [row] = callsOf(jobsTail.insert)[0] as [{ kind: string; payload: { post_ids: string[]; tries: number }; due_at: string }];
    expect(row.kind).toBe("social_links");
    expect(row.payload.post_ids.sort()).toEqual(["p2", "p3"]); // still sending, and not found this time
    expect(row.payload.tries).toBe(1);
    expect(new Date(row.due_at).getTime()).toBeGreaterThanOrEqual(before + 10 * 60_000);
  });

  it("social_links — stops asking after the last try, and drops a post Buffer failed to send", async () => {
    postLinks.mockResolvedValue([{ id: "p1", service: "twitter", status: "error", link: null }]);
    const j = job("social_links", { payload: { story_id: "s1", post_ids: ["p1", "p2"], tries: 4 } });
    const jobsTail = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], { stories: () => queryBuilder(dbOk({ social_posts: {} })) });

    await runJobById(j.id);

    expect(callsOf(jobsTail.insert).some(([r]) => (r as { kind: string }).kind === "social_links")).toBe(false);
  });

  it("social_push — the daily limit counts per channel: a full channel waits for tomorrow, the other still posts", async () => {
    const j = job("social_push", { payload: { story_id: "s1" } });
    const tail = queryBuilder(dbOk(null));
    socialRun({
      channels: ["li", "x"],
      rows: [confirmedRow("li", STORY_TEXT()), confirmedRow("x", STORY_TEXT())],
      // li has had its 3 today; x has had 2
      postedToday: [{ channel_id: "li" }, { channel_id: "li" }, { channel_id: "li" }, { channel_id: "x" }, { channel_id: "x" }],
      // select → claim → tomorrow's pending count → the re-enqueue insert (and anything after)
      jobs: [queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null, 0)), tail],
    });

    await runJobById(j.id);

    expect(sentTo()).toEqual(["x"]);
    const kinds = callsOf(tail.insert).map(([row]) => (row as { kind: string }).kind);
    expect(kinds).toContain("social_push"); // re-enqueued for tomorrow, for li
  });

  it("social_push — spaces a second overflow item past 09:00 UK time tomorrow, whatever the server's zone", async () => {
    // 23:30 UTC on 1 July is already 00:30 on 2 July in London: "tomorrow" is 3 July, 09:00 BST = 08:00Z.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-01T23:30:00Z"));
    const j = job("social_push", { payload: { story_id: "s1" } });
    const tail = queryBuilder(dbOk(null));
    socialRun({
      rows: [confirmedRow("li", STORY_TEXT())],
      postedToday: [{ channel_id: "li" }, { channel_id: "li" }, { channel_id: "li" }],
      // select → claim → tomorrow-queued count (1 already pending) → the re-enqueue insert
      jobs: [queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null, 1)), tail],
    });

    await runJobById(j.id);

    const [row] = callsOf(tail.insert)[0] as [{ due_at: string }];
    expect(row.due_at).toBe("2026-07-03T08:30:00.000Z"); // 09:00 BST plus one delay for the item ahead of it
  });

  it("notify_member — never emails a member with no contact address, but still records the in-app notification", async () => {
    const j = job("notify_member", { payload: { member_id: "m1", kind: "story_live" } });
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], {
      members: () => queryBuilder(dbOk({ id: "m1", name: "Acme", contact_email: null })),
      notifications: () => queryBuilder(dbOk(null)),
    });

    await runJobById(j.id);

    expect(send).not.toHaveBeenCalled();
  });

  it("notify_member — does not re-email when this job already sent one on a prior attempt", async () => {
    const j = job("notify_member", { payload: { member_id: "m1", kind: "story_live" } });
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], {
      members: () => queryBuilder(dbOk({ id: "m1", name: "Acme", contact_email: "acme@example.com" })),
      notifications: () => queryBuilder(dbOk({ id: "n1", emailed_at: "2026-01-01T00:00:00.000Z" })),
    });

    await runJobById(j.id);

    expect(send).not.toHaveBeenCalled();
  });

  it("notify_member — emails once and stamps emailed_at when nothing has gone out yet", async () => {
    const j = job("notify_member", { payload: { member_id: "m1", kind: "story_live" } });
    const notificationsBuilder = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], {
      members: () => queryBuilder(dbOk({ id: "m1", name: "Acme", contact_email: "acme@example.com" })),
      notifications: () => notificationsBuilder,
    });

    await runJobById(j.id);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "acme@example.com" }), { idempotencyKey: `notify-${j.id}` });
  });

  it("notify_member — sends the console's edited copy, not the shipped default", async () => {
    // The whole point of email_templates: an edit made in the console has to
    // reach the member on the very next tick, with no deploy and no cache to
    // invalidate. Everything either side of this is inference.
    const j = job("notify_member", { payload: { member_id: "m1", kind: "story_live" } });
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], {
      members: () => queryBuilder(dbOk({ id: "m1", name: "Acme", contact_email: "acme@example.com" })),
      notifications: () => queryBuilder(dbOk(null)),
      email_templates: () =>
        queryBuilder(dbOk([{ kind: "story_live", subject: "You're on the front page", body_text: null }])),
    });

    await runJobById(j.id);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "You're on the front page" }),
      { idempotencyKey: `notify-${j.id}` },
    );
    // body_text was left null, so the shipped paragraph still comes through.
    expect(callsOf(send)[0]?.[0]).toMatchObject({ text: expect.stringContaining("has been approved") });
  });

  it("admin_digest — sends nothing on a quiet day (every count is zero)", async () => {
    const j = job("admin_digest");
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], {
      stories: () => queryBuilder(dbOk(null, 0)),
      videos: () => queryBuilder(dbOk(null, 0)),
      events: () => queryBuilder(dbOk(null, 0)),
      featured_machines: () => queryBuilder(dbOk(null, 0)),
      member_revisions: () => queryBuilder(dbOk(null, 0)),
      advert_bookings: () => queryBuilder(dbOk(null, 0)),
      visibility_requests: () => queryBuilder(dbOk(null, 0)),
      members: () => queryBuilder(dbOk(null, 0)),
    });

    await runJobById(j.id);

    expect(send).not.toHaveBeenCalled();
  });

  it("admin_digest — summarises only the non-zero counts", async () => {
    const j = job("admin_digest");
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], {
      stories: () => queryBuilder(dbOk(null, 2)),
      videos: () => queryBuilder(dbOk(null, 0)),
      events: () => queryBuilder(dbOk(null, 0)),
      featured_machines: () => queryBuilder(dbOk(null, 0)),
      member_revisions: () => queryBuilder(dbOk(null, 0)),
      advert_bookings: () => queryBuilder(dbOk(null, 0)),
      visibility_requests: () => queryBuilder(dbOk(null, 1)),
      members: () => queryBuilder(dbOk(null, 0)),
    });

    await runJobById(j.id);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: "jas@sheetmetalindustries.com",
      subject: "SMI — 3 items waiting for you",
      text: expect.stringContaining("2 — Stories ready to review"),
    }));
  });

  it("admin_digest — lists each Live item whose post time passed with a channel still unconfirmed, once, with its link", async () => {
    const j = job("admin_digest");
    // the database works out which items are waiting (social_waiting_items)
    const rpc = vi.fn(async (fn: unknown) => fn === "social_waiting_items"
      ? dbOk([{ kind: "story", id: "s1", title: "Acme wins award", waiting: 1 }])
      : dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], {
      stories: () => queryBuilder(dbOk(null, 0)),
      videos: () => queryBuilder(dbOk(null, 0)),
      events: () => queryBuilder(dbOk(null, 0)),
      featured_machines: () => queryBuilder(dbOk(null, 0)),
      member_revisions: () => queryBuilder(dbOk(null, 0)),
      advert_bookings: () => queryBuilder(dbOk(null, 0)),
      visibility_requests: () => queryBuilder(dbOk(null, 0)),
      members: () => queryBuilder(dbOk(null, 0)),
      settings: () => queryBuilder(dbOk({ value: { channelIds: ["li", "x", "fb"], delay_minutes: 30 } })),
    }, rpc);

    await runJobById(j.id);

    expect(rpc).toHaveBeenCalledWith("social_waiting_items", expect.objectContaining({ p_channel_ids: ["li", "x", "fb"], p_delay_minutes: 30 }));
    const text = String((send.mock.calls[0] as unknown as [{ text: string }])?.[0]?.text);
    expect(text).toContain(`“Acme wins award”: 1 of 3 channels needs confirming — ${siteUrl()}/console/stories/s1#social`);
  });

  it("admin_digest — skips silently when ADMIN_EMAIL isn't configured", async () => {
    // Run last among admin_digest cases: resetModules() clears the whole
    // module cache, and doMock (unlike doUnmock) leaves a clean, known value
    // in place rather than falling through to the real, unmocked module.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.doMock("@/lib/notify-admin", () => ({ ADMIN_EMAIL: undefined }));
    vi.resetModules();
    const fresh = await import("@/lib/jobs");
    const j = job("admin_digest");
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))]);

    await fresh.runJobById(j.id);

    expect(warnSpy).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("comp_expiry — moves an expired promo comp to grace and notes it for Jas", async () => {
    const j = job("comp_expiry");
    const membersBuilder = queryBuilder(dbOk([{ id: "m1", name: "Acme", comped_until: "2026-01-01" }]));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], {
      members: () => membersBuilder,
    });

    await runJobById(j.id);

    expect(membersBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "grace", grace_until: "2026-01-31" }));
    // A notification, not an enquiry, and it links to the member (fix-list 71).
    expect(notifyConsole).toHaveBeenCalledWith(expect.objectContaining({
      kind: "comp_expired", memberId: "m1", payload: { member_id: "m1" },
    }));
  });

  it("membership_lapse — moves a grace member past grace_until to lapsed and notes it for Jas", async () => {
    const j = job("membership_lapse");
    const membersBuilder = queryBuilder(() => {
      const updates = callsOf(membersBuilder.update);
      return updates.length ? dbOk([{ id: "m1" }]) : dbOk([{ id: "m1", name: "Acme" }]);
    });
    const jobsTail = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], {
      members: () => membersBuilder,
    });

    await runJobById(j.id);

    expect(membersBuilder.update).toHaveBeenCalledWith({ status: "lapsed" });
    expect(notifyConsole).toHaveBeenCalledWith(expect.objectContaining({
      kind: "membership_lapsed", memberId: "m1",
    }));
    const kinds = callsOf(jobsTail.insert).map(([row]) => (row as { kind: string }).kind);
    expect(kinds).toContain("notify_member");
  });

  it("stats_summary — sends a summary to a member due for their monthly cadence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
    const j = job("stats_summary");
    const membersBuilder = queryBuilder(dbOk([{ id: "m1", notification_prefs: { stats_frequency: "monthly" } }]));
    const analyticsBuilder = queryBuilder(dbOk(null, 7));
    const jobsTail = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], {
      members: () => membersBuilder, analytics_events: () => analyticsBuilder,
    });

    await runJobById(j.id);
    vi.useRealTimers();

    const inserted = callsOf(jobsTail.insert).map(([row]) => row as { kind: string; payload: Record<string, unknown> });
    expect(inserted).toContainEqual(expect.objectContaining({
      kind: "notify_member",
      payload: expect.objectContaining({ member_id: "m1", kind: "stats_summary", page_views: 7 }),
    }));
  });

  it("stats_summary — skips a member not due this cadence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z")); // month start, not a quarter start
    const j = job("stats_summary");
    const membersBuilder = queryBuilder(dbOk([{ id: "m1", notification_prefs: { stats_frequency: "quarterly" } }]));
    const jobsTail = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], { members: () => membersBuilder });

    await runJobById(j.id);
    vi.useRealTimers();

    expect(callsOf(jobsTail.insert)).toHaveLength(0);
  });

  // #12: the alert used to count engagement_audit *rows* — one per member per
  // day while the IP resolver returns no region or company — and call them
  // companies. It reports the member's page views instead.
  describe("lead_alert — counts page views", () => {
    async function runFor(rows: { views: number }[], frequency = "daily") {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-04T00:00:00.000Z")); // a Wednesday — irrelevant for a daily cadence
      const j = job("lead_alert");
      const membersBuilder = queryBuilder(dbOk([{ id: "m1", notification_prefs: { leads_frequency: frequency } }]));
      const engagementBuilder = queryBuilder(dbOk(rows));
      const jobsTail = queryBuilder(dbOk(null));
      dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], {
        members: () => membersBuilder, engagement_audit: () => engagementBuilder,
      });
      await runJobById(j.id);
      vi.useRealTimers();
      return callsOf(jobsTail.insert)
        .map(([row]) => row as { kind: string; payload: Record<string, unknown> })
        .filter((row) => row.kind === "notify_member");
    }

    it("enqueues the total views across days, not the number of rows", async () => {
      const sent = await runFor([{ views: 3 }, { views: 5 }]);
      expect(sent).toEqual([expect.objectContaining({
        payload: expect.objectContaining({ member_id: "m1", kind: "lead_alert", count: 8, days: 1 }),
      })]);
    });

    it("sends nothing when the member had no engagement rows", async () => {
      expect(await runFor([])).toEqual([]);
    });

    it("sends nothing when the rows add up to zero views", async () => {
      expect(await runFor([{ views: 0 }, { views: 0 }])).toEqual([]);
    });
  });

  // Logging plan Phase 1: 90-day retention for the error log.
  it("log_retention — drops errors and occurrences older than 90 days", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
    const j = job("log_retention");
    const eventsBuilder = queryBuilder(dbOk(null));
    const occBuilder = queryBuilder(dbOk(null));
    const rpc = vi.fn(async () => dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], {
      error_events: () => eventsBuilder, error_occurrences: () => occBuilder,
    }, rpc);

    await runJobById(j.id);
    vi.useRealTimers();

    const cutoff = new Date(Date.parse("2026-10-01T00:00:00.000Z") - 90 * 864e5).toISOString();
    expect(eventsBuilder.delete).toHaveBeenCalled();
    expect(eventsBuilder.lt).toHaveBeenCalledWith("last_seen", cutoff);
    expect(occBuilder.lt).toHaveBeenCalledWith("occurred_at", cutoff);
    // the security audit log is append-only to the app; only its own function prunes it
    expect(rpc).toHaveBeenCalledWith("purge_audit_events");
  });

  // Direct uploads (lib/staged-upload): a file staged for a form nobody saved.
  it("upload_staging_sweep — removes staged uploads older than the age limit, in batches, through the storage API", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
    const j = job("upload_staging_sweep");
    const fullBatch = Array.from({ length: 100 }, (_, i) => `members/m1/${i}.jpg`);
    const rpc = vi.fn()
      .mockResolvedValueOnce(dbOk(fullBatch))
      .mockResolvedValueOnce(dbOk(["console/last.pdf"]));
    const remove = vi.fn(async (names: string[]) => dbOk(names.map((name) => ({ name }))));
    const jobsCalls = [queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))];
    let i = 0;
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: (table: string) => (table === "jobs" ? jobsCalls[Math.min(i++, jobsCalls.length - 1)] : queryBuilder(dbOk(null))),
      rpc,
      storage: { from: vi.fn(() => ({ remove })) },
    })));

    await runJobById(j.id);
    vi.useRealTimers();

    const before = new Date(Date.parse("2026-10-16T12:00:00.000Z") - 24 * 3_600_000).toISOString();
    expect(rpc).toHaveBeenCalledWith("staged_uploads_older_than", { p_before: before, p_limit: 100 });
    expect(rpc).toHaveBeenCalledTimes(2); // a short second batch means the bucket is clear
    expect(remove.mock.calls.map(([names]) => names)).toEqual([fullBatch, ["console/last.pdf"]]);
    // ran to completion, not retried
    expect(jobsCalls[2].update).toHaveBeenCalledWith(expect.objectContaining({ status: "done" }));
  });

  it("lead_alert — skips a weekly-cadence member on a non-Monday", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T00:00:00.000Z")); // Wednesday
    const j = job("lead_alert");
    const membersBuilder = queryBuilder(dbOk([{ id: "m1", notification_prefs: { leads_frequency: "weekly" } }]));
    const jobsTail = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], { members: () => membersBuilder });

    await runJobById(j.id);
    vi.useRealTimers();

    expect(callsOf(jobsTail.insert)).toHaveLength(0);
  });

  it("advert_lifecycle — starts a scheduled run whose term has begun", async () => {
    const j = job("advert_lifecycle");
    const bookingsBuilder = queryBuilder(() => {
      const updates = callsOf(bookingsBuilder.update);
      return updates.length ? dbOk([{ id: "b1" }]) : dbOk([{ id: "b1", advert: { member_id: "m1" } }]);
    });
    const jobsTail = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], { advert_bookings: () => bookingsBuilder });

    await runJobById(j.id);

    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "live" }));
    const kinds = callsOf(jobsTail.insert).map(([row]) => (row as { kind: string }).kind);
    expect(kinds).toContain("notify_member");
  });

  it("advert_lifecycle — ends a run whose term is over", async () => {
    const j = job("advert_lifecycle");
    let call = 0;
    const bookingsBuilder = queryBuilder(() => {
      call++;
      if (call === 1) return dbOk([]); // phase 1: starting — none
      if (call === 2) return dbOk([]); // phase 1b: lapsed unpaid holds — none
      if (call === 3) return dbOk([{ id: "b1", ends_on: "2026-01-01", advert: { member_id: "m1" } }]); // phase 2: finishing select
      if (call === 4) return dbOk([{ id: "b1" }]); // phase 2: finishing update (claims the transition)
      return dbOk([]); // phase 3: expiring — none
    });
    const jobsTail = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], { advert_bookings: () => bookingsBuilder });

    await runJobById(j.id);

    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "ended", ended_reason: "term_complete" }));
    const kinds = callsOf(jobsTail.insert).map(([row]) => (row as { kind: string }).kind);
    expect(kinds).toContain("notify_member");
  });

  // 6 Oct: a run held for payment whose term passed unpaid.
  it("advert_lifecycle — ends a lapsed unpaid hold as 'unpaid' and voids its invoice, without emailing", async () => {
    const j = job("advert_lifecycle");
    let call = 0;
    const bookingsBuilder = queryBuilder(() => {
      call++;
      if (call === 1) return dbOk([]); // phase 1: starting — none
      if (call === 2) return dbOk([{ id: "b1", bundle_id: null, ends_on: "2026-01-01" }]); // phase 1b: lapsed select
      if (call === 3) return dbOk([{ id: "b1" }]); // phase 1b: the conditional end
      return dbOk([]);
    });
    // voidInvoices: read the issued invoice, then the conditional void
    const invoicesBuilder = queryBuilder((): DbResult => (callsOf(invoicesBuilder.update).length
      ? dbOk([{ id: "inv1" }])
      : dbOk([{ id: "inv1", checkout_session_id: null }])));
    const jobsTail = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], {
      advert_bookings: () => bookingsBuilder,
      invoices: () => invoicesBuilder,
      placements: () => queryBuilder(dbOk([])),
    });

    await runJobById(j.id);

    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "ended", ended_reason: "unpaid" }));
    expect(invoicesBuilder.update).toHaveBeenCalledWith({ status: "void", checkout_session_id: null, checkout_expires_at: null });
    expect(invoicesBuilder.eq).toHaveBeenCalledWith("advert_booking_id", "b1");
    const kinds = callsOf(jobsTail.insert).map(([row]) => (row as { kind: string }).kind);
    expect(kinds).not.toContain("notify_member");
  });

  // Review finding 2: voiding goes through voidInvoices(), which expires the
  // Checkout Session first — a pay page left open must stop taking money.
  it("advert_lifecycle — expires a lapsed hold's open Checkout Session before voiding its invoice", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    const j = job("advert_lifecycle");
    let call = 0;
    const bookingsBuilder = queryBuilder(() => {
      call++;
      if (call === 2) return dbOk([{ id: "b1", bundle_id: null, ends_on: "2026-01-01" }]);
      if (call === 3) return dbOk([{ id: "b1" }]);
      return dbOk([]);
    });
    const invoicesBuilder = queryBuilder((): DbResult => (callsOf(invoicesBuilder.update).length
      ? dbOk([{ id: "inv1" }])
      : dbOk([{ id: "inv1", checkout_session_id: "cs_open" }])));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], {
      advert_bookings: () => bookingsBuilder,
      invoices: () => invoicesBuilder,
      placements: () => queryBuilder(dbOk([])),
    });

    await runJobById(j.id);

    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://api.stripe.com/v1/checkout/sessions/cs_open/expire");
    expect(invoicesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "void" }));
    vi.unstubAllEnvs();
  });

  // Review finding 6: the bundle's invoice is voided by the shared helper, which
  // also refuses while any part is scheduled or live.
  it("advert_lifecycle — voids a lapsed bundle's invoice only once no part is still owed for", async () => {
    const j = job("advert_lifecycle");
    let call = 0;
    const bookingsBuilder = queryBuilder(() => {
      call++;
      if (call === 2) return dbOk([{ id: "b1", bundle_id: "bd1", ends_on: "2026-01-01" }]);
      if (call === 3) return dbOk([{ id: "b1" }]);
      if (call === 4) return dbOk(null, 1); // voidBundleInvoiceIfAbandoned: one part still scheduled
      return dbOk([]);
    });
    const invoicesBuilder = queryBuilder(dbOk([]));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], {
      advert_bookings: () => bookingsBuilder,
      invoices: () => invoicesBuilder,
      placements: () => queryBuilder(dbOk([])),
    });

    await runJobById(j.id);

    expect(bookingsBuilder.in).toHaveBeenCalledWith("status", ["awaiting_payment", "scheduled", "live"]);
    expect(invoicesBuilder.eq).not.toHaveBeenCalledWith("bundle_id", "bd1");
    expect(invoicesBuilder.update).not.toHaveBeenCalled();
  });

  // State-based, like the rest of the sweep: a bundle whose void failed last
  // night (its parts already ended) is picked up again, not lost.
  it("advert_lifecycle — re-checks a bundle still holding an issued invoice with a part ended unpaid", async () => {
    const j = job("advert_lifecycle");
    let call = 0;
    const bookingsBuilder = queryBuilder((): DbResult => {
      call++;
      if (call === 3) return dbOk([{ bundle_id: "bd1" }]); // parts ended 'unpaid' in bundles with an open invoice
      if (call === 4) return dbOk(null, 0); // voidBundleInvoiceIfAbandoned: nothing left in play
      return dbOk([]); // nothing starting, nothing lapsing tonight, …
    });
    const invoicesBuilder = queryBuilder((): DbResult => {
      if (callsOf(invoicesBuilder.update).length) return dbOk([{ id: "inv1" }]);
      return callsOf(invoicesBuilder.select).length === 1 ? dbOk([{ bundle_id: "bd1" }]) : dbOk([{ id: "inv1", checkout_session_id: null }]);
    });
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], {
      advert_bookings: () => bookingsBuilder,
      invoices: () => invoicesBuilder,
      placements: () => queryBuilder(dbOk([])),
    });

    await runJobById(j.id);

    expect(bookingsBuilder.eq).toHaveBeenCalledWith("ended_reason", "unpaid");
    expect(invoicesBuilder.eq).toHaveBeenCalledWith("bundle_id", "bd1");
    expect(invoicesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "void" }));
  });

  it("advert_lifecycle — leaves a lapsing run held when its checkout completed mid-sweep — the member is paying", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    const j = job("advert_lifecycle");
    let call = 0;
    const bookingsBuilder = queryBuilder((): DbResult => {
      call++;
      if (call === 2) return dbOk([{ id: "b1", bundle_id: null, ends_on: "2026-01-01" }]);
      return dbOk([]);
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).endsWith("/expire")
        ? new Response("not open", { status: 400 })
        : new Response(JSON.stringify({ status: "complete", payment_status: "paid" })));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], {
      advert_bookings: () => bookingsBuilder,
      invoices: () => queryBuilder(dbOk([{ id: "inv1", checkout_session_id: "cs_paying" }])),
      placements: () => queryBuilder(dbOk([])),
    });

    await runJobById(j.id);

    expect(bookingsBuilder.update).not.toHaveBeenCalledWith(expect.objectContaining({ ended_reason: "unpaid" }));
    vi.unstubAllEnvs();
  });

  it("advert_lifecycle — voids a lapsed placement's invoice, and fails the sweep when it can't", async () => {
    const j = job("advert_lifecycle");
    const placementInvoices = queryBuilder((): DbResult => {
      const n = callsOf(placementInvoices.select).length;
      if (n === 1) return dbOk([]); // open bundle invoices — none
      if (n === 2) return dbOk([{ placement_id: "pl1" }]); // which lapsed placements still have one issued
      return dbError("statement timeout"); // voidInvoices' own read
    });
    const jobsBuilder = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsBuilder], {
      advert_bookings: () => queryBuilder(dbOk([])),
      invoices: () => placementInvoices,
      placements: () => queryBuilder(dbOk([{ id: "pl1" }])),
    });

    await runJobById(j.id);

    expect(placementInvoices.eq).toHaveBeenCalledWith("placement_id", "pl1");
    // the job is handed back for retry rather than marked done with the invoice still payable
    expect(jobsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "pending", last_error: expect.stringContaining("statement timeout"),
    }));
  });

  it("advert_lifecycle — warns once, not twice, about a run ending soon", async () => {
    const j = job("advert_lifecycle");
    let call = 0;
    const bookingsBuilder = queryBuilder(() => {
      call++;
      if (call <= 3) return dbOk([]); // phases 1, 1b and 2: nothing starting, lapsed or finishing
      if (call === 4) return dbOk([{ id: "b1", starts_on: "2026-01-01", ends_on: "2026-02-01", ending_soon_notified_for: null, advert: { name: "Spring push", member_id: "m1" } }]);
      return dbOk([{ id: "b1" }]); // the conditional claim update succeeds
    });
    const jobsTail = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], {
      advert_bookings: () => bookingsBuilder,
    });

    await runJobById(j.id);

    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ ending_soon_notified_for: "2026-02-01" }));
    // This row used to be written as an `advertising` enquiry with `email: ""`,
    // so the console offered a reply form that would have addressed nobody
    // (fix-list 71). It is a notification, and it links to the booking.
    expect(notifyConsole).toHaveBeenCalledWith(expect.objectContaining({
      kind: "advert_ending", memberId: "m1", payload: { booking_id: "b1" },
    }));
  });

  it("newsletter_send — marks the issue sent on a successful broadcast", async () => {
    const j = job("newsletter_send", { payload: { issue_id: "iss1" } });
    const issuesBuilder = queryBuilder(dbOk({ id: "iss1", number: 4, subject: "August roundup", status: "queued", approved_at: "2026-08-31T09:00:00Z" }));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], { newsletter_issues: () => issuesBuilder });

    await runJobById(j.id);

    expect(sendIssue).toHaveBeenCalledWith("iss1", `newsletter-${j.id}`);
    expect(issuesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "sent" }));
  });

  it("newsletter_send — records the failure and throws so it dead-letters visibly", async () => {
    const j = job("newsletter_send", { payload: { issue_id: "iss1" }, attempts: 2, max_attempts: 3 });
    const issuesBuilder = queryBuilder(dbOk({ id: "iss1", number: 4, subject: "August roundup", status: "queued", approved_at: "2026-08-31T09:00:00Z" }));
    sendIssue.mockResolvedValueOnce({ ok: false, error: "Resend rejected the send (500)" });
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], { newsletter_issues: () => issuesBuilder });

    await runJobById(j.id);

    expect(sendIssue).toHaveBeenCalled();
    expect(issuesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "send_failed", send_error: "Resend rejected the send (500)" }));
  });

  it("newsletter_send — refuses an unapproved issue without calling the sender", async () => {
    const j = job("newsletter_send", { payload: { issue_id: "iss1" } });
    const issuesBuilder = queryBuilder(dbOk({ id: "iss1", number: 4, subject: "s", status: "draft", approved_at: null }));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], { newsletter_issues: () => issuesBuilder });

    await runJobById(j.id);

    expect(sendIssue).not.toHaveBeenCalled();
    expect(issuesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "send_failed", send_error: expect.stringContaining("Not approved") }));
  });

  it("newsletter_send — refuses while a picked item has left the site, without calling the sender or throwing (GAPS B5.5)", async () => {
    const j = job("newsletter_send", { payload: { issue_id: "iss1" } });
    const issuesBuilder = queryBuilder(dbOk({ id: "iss1", number: 4, subject: "s", status: "scheduled", approved_at: "2026-10-20T09:00:00Z" }));
    issueItemsNotLive.mockResolvedValueOnce(["Withdrawn story"]);
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], { newsletter_issues: () => issuesBuilder });

    await runJobById(j.id);

    expect(issueItemsNotLive).toHaveBeenCalledWith("iss1");
    expect(sendIssue).not.toHaveBeenCalled();
    expect(issuesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "send_failed",
      send_error: expect.stringContaining("“Withdrawn story” is no longer live"),
    }));
  });

  it("newsletter_send — does not re-send an issue that's already gone out", async () => {
    const j = job("newsletter_send", { payload: { issue_id: "iss1" } });
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], {
      newsletter_issues: () => queryBuilder(dbOk({ id: "iss1", number: 4, subject: "s", status: "sent" })),
    });

    await runJobById(j.id);

    expect(sendIssue).not.toHaveBeenCalled();
  });

  it("crm_push retries one contact's write-through with the options it was queued with", async () => {
    dbFor(happyPath(job("crm_push", { payload: { contact_id: "c1", name_changed: true, re_opt_in: false } })));
    await runJobById("job1");
    expect(crmPush).toHaveBeenCalledWith("c1", { nameChanged: true, reOptIn: false });
  });

  describe("a company's News Page URL write-through (issue #55)", () => {
    afterEach(() => {
      pushCompanyNewsPage.mockReset().mockResolvedValue("pushed");
      retryPendingCompanyPushes.mockClear();
      checkCompanyWriteAccess.mockReset().mockResolvedValue(null);
    });

    it("crm_push retries a company's push, and fails so the queue retries it while Bigin still refuses", async () => {
      crmPush.mockClear();
      dbFor(happyPath(job("crm_push", { payload: { company_id: "91" } })));
      await runJobById("job1");
      expect(pushCompanyNewsPage).toHaveBeenCalledWith("91", { queueRetry: false });
      expect(crmPush).not.toHaveBeenCalled();

      pushCompanyNewsPage.mockResolvedValue("pending");
      const j = job("crm_push", { id: "job2", payload: { company_id: "91" } });
      const [select, claim, tail] = happyPath(j);
      dbFor([select, claim, tail]);
      await runJobById(j.id);
      expect(tail.update).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", last_error: expect.stringContaining("company 91") }));
    });

    it("crm_sync also sweeps company pushes whose retry died", async () => {
      dbFor(happyPath(job("crm_sync")));
      await runJobById("job1");
      expect(retryPendingCompanyPushes).toHaveBeenCalled();
      expect(crmSync).toHaveBeenCalled();
    });

    it("the daily company sync re-checks whether the token may write companies, Story crawler on or off", async () => {
      storyCrawlerOn.mockResolvedValue(false);
      dbFor(happyPath(job("source_bigin_sync")));
      await runJobById("job1");
      expect(checkCompanyWriteAccess).toHaveBeenCalled();
      storyCrawlerOn.mockReset().mockResolvedValue(true);
    });
  });

  it("crm_sync and newsletter_sync delegate to their adapters", async () => {
    dbFor(happyPath(job("crm_sync")));
    await runJobById("job1");
    expect(crmSync).toHaveBeenCalled();

    dbFor(happyPath(job("newsletter_sync", { id: "job2" })));
    await runJobById("job2");
    expect(syncContacts).toHaveBeenCalled();
  });

  describe("social_followers (issue #4)", () => {
    afterEach(() => refreshSocialFollowers.mockReset().mockResolvedValue({ instagramProblem: null }));

    it("refreshes the follower counts and completes", async () => {
      const [select, claim, tail] = happyPath(job("social_followers"));
      dbFor([select, claim, tail]);
      await runJobById("job1");
      expect(refreshSocialFollowers).toHaveBeenCalledTimes(1);
      expect(callsOf(tail.update)).toContainEqual([expect.objectContaining({ status: "done" })]);
    });

    // A dying Instagram token must reach a person: the job fails, retries, and
    // dead-letters into "Needs You Today" with the reason as its last_error.
    it("fails with the reason when the Instagram token couldn't be refreshed", async () => {
      refreshSocialFollowers.mockResolvedValue({ instagramProblem: "Instagram token refresh failed (HTTP 400). It expires in about 40 days" });
      const j = job("social_followers", { attempts: 2, max_attempts: 3 });
      const tail = queryBuilder(dbOk(null));
      dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), tail]);
      await runJobById(j.id);
      expect(callsOf(tail.update)).toContainEqual([expect.objectContaining({ status: "dead", last_error: expect.stringContaining("Instagram token refresh failed") })]);
    });
  });

  it("rejects an unknown job kind rather than silently succeeding", async () => {
    const j = { id: "job1", kind: "bogus" as JobKind, payload: {}, attempts: 0, max_attempts: 3, due_at: new Date().toISOString() };
    const deadBuilder = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), deadBuilder]);

    await runJobById(j.id);

    expect(deadBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ last_error: expect.stringContaining("unknown job kind") }));
  });
});

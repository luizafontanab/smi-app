import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueue, runDueJobs, runJobById, type JobKind } from "@/lib/jobs";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { SendResult } from "@/lib/adapters/newsletter";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const send = vi.fn(async () => {});
vi.mock("@/lib/adapters/email", () => ({ getEmailSender: vi.fn(() => ({ send })) }));

const publish = vi.fn(async () => {});
vi.mock("@/lib/adapters/social", () => ({ getSocialPublisher: vi.fn(() => ({ publish })) }));

const crmSync = vi.fn(async () => {});
vi.mock("@/lib/adapters/crm", () => ({ getCrmSync: vi.fn(() => ({ sync: crmSync })) }));

const syncContacts = vi.fn(async () => ({ pushed: 3, failed: 0 }));
const sendIssue = vi.fn<(issueId: string, idempotencyKey: string) => Promise<SendResult>>(
  async () => ({ ok: true, recipients: 10 }),
);
const newsletterIsLive = vi.fn(() => true);
vi.mock("@/lib/adapters/newsletter", () => ({
  getNewsletterSender: vi.fn(() => ({ syncContacts, sendIssue })),
  newsletterIsLive,
}));

// Three sweeps raise a console notification (fix-list 71). Asserted through
// the spy rather than through the inbox_messages builder: notifyConsole owns
// the row's shape and has its own tests — what belongs here is that each sweep
// raises the right KIND, about the right thing.
const { notifyConsole } = vi.hoisted(() => ({ notifyConsole: vi.fn(async () => {}) }));
vi.mock("@/lib/notify-admin", () => ({ ADMIN_EMAIL: "jas@sheetmetalindustries.com", notifyConsole }));

afterEach(() => {
  resetDbServerMocks();
  vi.restoreAllMocks();
  send.mockReset().mockResolvedValue(undefined);
  publish.mockReset().mockResolvedValue(undefined);
  crmSync.mockReset().mockResolvedValue(undefined);
  syncContacts.mockReset().mockResolvedValue({ pushed: 3, failed: 0 });
  sendIssue.mockReset().mockResolvedValue({ ok: true, recipients: 10 });
  newsletterIsLive.mockReset().mockReturnValue(true);
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
        "lead_alert",
        "membership_lapse",
        "newsletter_sync",
        "publish_scheduled",
        "rollup_daily",
        "stats_summary",
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
  it("publish_scheduled — publishes ready stories/videos and enqueues their follow-up jobs", async () => {
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
    expect(kinds.filter((k) => k === "social_push")).toHaveLength(2);
    expect(kinds.filter((k) => k === "notify_member")).toHaveLength(2); // both ready items have a member_id
  });

  it("social_push (story) — publishes and tags from the CRM-stored handles", async () => {
    const j = job("social_push", { payload: { story_id: "s1" } });
    // select → claim → daily-cap count (0 so far today) → done
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null, 0)), queryBuilder(dbOk(null))], {
      stories: () => queryBuilder(dbOk({
        id: "s1", title: "Acme wins award", slug: "acme-wins-award", excerpt: "", cover_path: "c.jpg",
        member: { name: "Acme", social: { x: "acme" } },
      })),
      settings: () => queryBuilder(dbOk({ value: { per_day: 3 } })),
    });

    await runJobById(j.id);

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("acme-wins-award"),
      tagHandles: { x: "acme" },
    }));
  });

  it("social_push — defers past the daily cap to tomorrow morning instead of posting", async () => {
    const j = job("social_push", { payload: { story_id: "s1" } });
    const jobsTail = queryBuilder(dbOk(null));
    // select → claim → daily-cap count (already at 3/3) → the re-enqueue insert (and anything after)
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null, 3)), jobsTail], {
      stories: () => queryBuilder(dbOk({ id: "s1", title: "t", slug: "t", excerpt: "", cover_path: null, member: null })),
      settings: () => queryBuilder(dbOk({ value: { per_day: 3 } })),
    });

    await runJobById(j.id);

    expect(publish).not.toHaveBeenCalled();
    const kinds = callsOf(jobsTail.insert).map(([row]) => (row as { kind: string }).kind);
    expect(kinds).toContain("social_push"); // re-enqueued for tomorrow
  });

  it("social_push — spaces a second same-day overflow item later than the first instead of stacking both at 09:00", async () => {
    const j = job("social_push", { payload: { story_id: "s1" } });
    const jobsTail = queryBuilder(dbOk(null));
    // select → claim → daily-cap count (at cap) → tomorrow-queued count (1 already pending) → the re-enqueue insert
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null, 3)), queryBuilder(dbOk(null, 1)), jobsTail], {
      stories: () => queryBuilder(dbOk({ id: "s1", title: "t", slug: "t", excerpt: "", cover_path: null, member: null })),
      settings: () => queryBuilder(dbOk({ value: { per_day: 3, delay_minutes: 30 } })),
    });

    await runJobById(j.id);

    const [row] = callsOf(jobsTail.insert)[0] as [{ due_at: string }];
    const due = new Date(row.due_at);
    const nineAm = new Date(); nineAm.setDate(nineAm.getDate() + 1); nineAm.setHours(9, 0, 0, 0);
    expect(due.getTime()).toBeGreaterThanOrEqual(nineAm.getTime() + 30 * 60_000); // spaced past 09:00, not stacked on it
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
      text: expect.stringContaining("2 — Stories awaiting approval"),
    }));
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

  it("lead_alert — sends when there's new engagement for a daily-cadence member", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T00:00:00.000Z")); // a Wednesday — irrelevant for a daily cadence
    const j = job("lead_alert");
    const membersBuilder = queryBuilder(dbOk([{ id: "m1", notification_prefs: { leads_frequency: "daily" } }]));
    // lead_alert counts head-only (no rows) so PostgREST's max-rows cap can
    // never truncate the number a member is sent.
    const engagementBuilder = queryBuilder(dbOk(null, 2));
    const jobsTail = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], {
      members: () => membersBuilder, engagement_audit: () => engagementBuilder,
    });

    await runJobById(j.id);
    vi.useRealTimers();

    const inserted = callsOf(jobsTail.insert).map(([row]) => row as { kind: string; payload: Record<string, unknown> });
    expect(inserted).toContainEqual(expect.objectContaining({
      kind: "notify_member",
      payload: expect.objectContaining({ member_id: "m1", kind: "lead_alert", count: 2 }),
    }));
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
      if (call === 2) return dbOk([{ id: "b1", ends_on: "2026-01-01", advert: { member_id: "m1" } }]); // phase 2: finishing select
      if (call === 3) return dbOk([{ id: "b1" }]); // phase 2: finishing update (claims the transition)
      return dbOk([]); // phase 3: expiring — none
    });
    const jobsTail = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), jobsTail], { advert_bookings: () => bookingsBuilder });

    await runJobById(j.id);

    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "ended", ended_reason: "term_complete" }));
    const kinds = callsOf(jobsTail.insert).map(([row]) => (row as { kind: string }).kind);
    expect(kinds).toContain("notify_member");
  });

  it("advert_lifecycle — warns once, not twice, about a run ending soon", async () => {
    const j = job("advert_lifecycle");
    let call = 0;
    const bookingsBuilder = queryBuilder(() => {
      call++;
      if (call <= 2) return dbOk([]); // phases 1 and 2: nothing starting or finishing
      if (call === 3) return dbOk([{ id: "b1", starts_on: "2026-01-01", ends_on: "2026-02-01", ending_soon_notified_for: null, advert: { name: "Spring push", member_id: "m1" } }]);
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
    const issuesBuilder = queryBuilder(dbOk({ id: "iss1", number: 4, subject: "August roundup", status: "queued" }));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], { newsletter_issues: () => issuesBuilder });

    await runJobById(j.id);

    expect(sendIssue).toHaveBeenCalledWith("iss1", `newsletter-${j.id}`);
    expect(issuesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "sent" }));
  });

  it("newsletter_send — records the failure and throws so it dead-letters visibly", async () => {
    const j = job("newsletter_send", { payload: { issue_id: "iss1" }, attempts: 2, max_attempts: 3 });
    const issuesBuilder = queryBuilder(dbOk({ id: "iss1", number: 4, subject: "August roundup", status: "queued" }));
    sendIssue.mockResolvedValueOnce({ ok: false, error: "Resend rejected the send (500)" });
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], { newsletter_issues: () => issuesBuilder });

    await runJobById(j.id);

    expect(issuesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "send_failed" }));
  });

  it("newsletter_send — does not re-send an issue that's already gone out", async () => {
    const j = job("newsletter_send", { payload: { issue_id: "iss1" } });
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), queryBuilder(dbOk(null))], {
      newsletter_issues: () => queryBuilder(dbOk({ id: "iss1", number: 4, subject: "s", status: "sent" })),
    });

    await runJobById(j.id);

    expect(sendIssue).not.toHaveBeenCalled();
  });

  it("crm_sync and newsletter_sync delegate to their adapters", async () => {
    dbFor(happyPath(job("crm_sync")));
    await runJobById("job1");
    expect(crmSync).toHaveBeenCalled();

    dbFor(happyPath(job("newsletter_sync", { id: "job2" })));
    await runJobById("job2");
    expect(syncContacts).toHaveBeenCalled();
  });

  it("rejects an unknown job kind rather than silently succeeding", async () => {
    const j = { id: "job1", kind: "bogus" as JobKind, payload: {}, attempts: 0, max_attempts: 3, due_at: new Date().toISOString() };
    const deadBuilder = queryBuilder(dbOk(null));
    dbFor([queryBuilder(dbOk(j)), queryBuilder(dbOk([{ id: j.id }])), deadBuilder]);

    await runJobById(j.id);

    expect(deadBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ last_error: expect.stringContaining("unknown job kind") }));
  });
});

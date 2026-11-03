import { describe, expect, it, vi, type Mock } from "vitest";
import {
  LIFECYCLE_MESSAGES as M, approve, decline, move, publish, publishDue, schedule,
  type ContentKind, type LifecycleDeps,
} from "@/lib/content-lifecycle";
import { STORY_STATUS_LABELS } from "@/lib/story-board";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";

/**
 * The content lifecycle through its public interface, written from the frozen
 * contract (plan "here-s-the-plan-for-resilient-shell": Frozen contract, Query
 * shape, Semantics) and decisions Q1–Q13 — not from the implementation.
 *
 * The fake routes each awaited query by what was chained on it, not by call
 * order: an `.update()` resolves to the write result configured for the id in
 * its `.eq("id", …)`, queueSocialPush's read of the row gets an unposted item,
 * any other `.maybeSingle()` read gets the row under test, and a bare list
 * (publishDue's due rows) gets the configured list. So a test fails on what
 * was written or sent, never on the order the module happens to query in.
 */

type Builder = ReturnType<typeof queryBuilder>;
type Spy = Mock<(...args: unknown[]) => unknown>;
const spy = (b: Builder, method: string) => b[method] as Spy;
const called = (b: Builder, method: string) => spy(b, method).mock.calls.length > 0;

type Enqueue = LifecycleDeps["enqueue"];
type Row = { id: string; status: string; member_id: string | null; source: string; member_draft?: boolean };

const TABLE = { story: "stories", video: "videos", event: "events" } as const;
const KEY = { story: "story_id", video: "video_id", event: "event_id" } as const;
const LIVE = { story: "story_live", video: "video_live", event: "event_published" } as const;
const REJECTED = { story: "story_rejected", video: "video_rejected", event: "event_rejected" } as const;
const ADMIN = { userId: "admin1" };

/** The row the one read returns. Desk-made ("manual") with no member unless overridden. */
function row(kind: ContentKind, o: Partial<Row> = {}): Row {
  return {
    id: `${kind[0]}1`, status: "draft", member_id: null, source: "manual",
    ...(kind === "story" ? { member_draft: false } : {}),
    ...o,
  };
}

type TableOpts = {
  /** What `.select(cols).eq("id", id).maybeSingle()` resolves to. */
  row?: Row | null;
  /** publishDue's due rows. */
  list?: unknown[];
  /** The conditional status write, per id. Default: one row matched. */
  write?: (id: string) => DbResult;
};

function contentTable(opts: TableOpts) {
  const builders: Builder[] = [];
  const factory = () => {
    const b: Builder = queryBuilder(() => {
      if (called(b, "update")) {
        const id = spy(b, "eq").mock.calls.find(([col]) => col === "id")?.[1];
        return opts.write ? opts.write(String(id)) : dbOk({ id });
      }
      const cols = String(spy(b, "select").mock.calls[0]?.[0] ?? "");
      // queueSocialPush's own read: an item not yet posted
      if (cols.includes("social_posted_at")) {
        return dbOk({ social_at: null, social_posted_at: null, published_at: new Date().toISOString() });
      }
      if (called(b, "maybeSingle") || called(b, "single")) return dbOk(opts.row ?? null);
      return dbOk(opts.list ?? []);
    });
    builders.push(b);
    return b;
  };
  return { factory, builders };
}

function setup(o: { stories?: TableOpts; videos?: TableOpts; events?: TableOpts } = {}) {
  const tables = {
    stories: contentTable(o.stories ?? {}),
    videos: contentTable(o.videos ?? {}),
    events: contentTable(o.events ?? {}),
  };
  const approvals: Builder[] = [];
  const jobs: Builder[] = [];
  const keep = (list: Builder[], b: Builder) => (list.push(b), b);
  const db = mockDb({
    from: fromByTable({
      stories: tables.stories.factory,
      videos: tables.videos.factory,
      events: tables.events.factory,
      approvals: () => keep(approvals, queryBuilder(dbOk(null))),
      jobs: () => keep(jobs, queryBuilder(dbOk(null))),
      settings: () => queryBuilder(dbOk({ value: { delay_minutes: 30 } })),
      story_members: () => queryBuilder(dbOk([])),
    }),
  });
  const enqueue = vi.fn<Enqueue>(async () => {});
  const deps: LifecycleDeps = { db: asDb(db), enqueue };

  /** Every status write to a content table: its values and its filters. */
  const writes = (table: keyof typeof tables) =>
    tables[table].builders.filter((b) => called(b, "update")).map((b) => ({
      values: spy(b, "update").mock.calls[0]?.[0] as Record<string, unknown>,
      eq: spy(b, "eq").mock.calls,
    }));
  /** Reads of the row under test (excluding queueSocialPush's own read). */
  const rowReads = (table: keyof typeof tables) =>
    tables[table].builders.filter((b) =>
      !called(b, "update") && called(b, "maybeSingle")
      && !String(spy(b, "select").mock.calls[0]?.[0] ?? "").includes("social_posted_at")).length;
  const approvalRows = () => approvals.flatMap((b) => spy(b, "insert").mock.calls.map(([r]) => r));
  const jobDeletes = () => jobs.filter((b) => called(b, "delete")).map((b) => spy(b, "filter").mock.calls);
  const kinds = () => enqueue.mock.calls.map(([k]) => k);
  const notices = () => enqueue.mock.calls.filter(([k]) => k === "notify_member").map(([, p]) => p);
  const tablesRead = () => db.from.mock.calls.map(([t]) => t);

  return { deps, db, enqueue, writes, rowReads, approvalRows, jobDeletes, kinds, notices, tablesRead };
}

type Harness = ReturnType<typeof setup>;
const forKind = (kind: ContentKind, t: TableOpts) => ({ [TABLE[kind]]: t });

/** Nothing written, queued, emailed or recorded. */
function expectUntouched(h: Harness) {
  for (const t of ["stories", "videos", "events"] as const) expect(h.writes(t)).toEqual([]);
  expect(h.enqueue).not.toHaveBeenCalled();
  expect(h.tablesRead()).not.toContain("approvals");
  expect(h.jobDeletes()).toEqual([]);
}

/** The write landed, but nothing followed it. */
function expectNoSideEffects(h: Harness) {
  expect(h.enqueue).not.toHaveBeenCalled();
  expect(h.tablesRead()).not.toContain("approvals");
  expect(h.jobDeletes()).toEqual([]);
}

const approval = (kind: ContentKind, id: string, decision: "approved" | "rejected", reason: string | null) => ({
  kind, subject_id: id, decision, reason, decided_by: ADMIN.userId,
});

/* ------------------------------------------------------------------ approve */

describe("approve", () => {
  describe.each(["story", "video", "event"] as const)("%s", (kind) => {
    const table = TABLE[kind];

    it("publishes an item that is Ready to review, emails its member, and records the approval with any reason typed", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "awaiting_approval", member_id: "m1", source: "member" }) }));
      expect(await approve(h.deps, kind, `${kind[0]}1`, ADMIN, "Lovely")).toEqual({ ok: true });
      expect(h.writes(table)[0]?.values).toEqual(expect.objectContaining({ status: "published" }));
      expect(h.writes(table)[0]?.eq).toContainEqual(["status", "awaiting_approval"]);
      expect(h.notices()).toContainEqual({ member_id: "m1", kind: LIVE[kind], [KEY[kind]]: `${kind[0]}1` });
      expect(h.approvalRows()).toEqual([approval(kind, `${kind[0]}1`, "approved", "Lovely")]);
    });

    it("records a blank reason as null", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "awaiting_approval" }) }));
      expect(await approve(h.deps, kind, `${kind[0]}1`, ADMIN, "")).toEqual({ ok: true });
      expect(h.approvalRows()).toEqual([approval(kind, `${kind[0]}1`, "approved", null)]);
    });

    // A stale tab: someone else already decided it. Unlike publish, approve
    // never makes a Sent back or draft item Live.
    it.each(["draft", "rejected", "scheduled", "published", "withdrawn"])("refuses an item that is %s as already decided, touching nothing", async (status) => {
      const h = setup(forKind(kind, { row: row(kind, { status, member_id: "m1", source: "member" }) }));
      expect(await approve(h.deps, kind, `${kind[0]}1`, ADMIN)).toEqual({ ok: false, error: M.alreadyDecided(kind) });
      expectUntouched(h);
    });

    it("refuses a missing row as not found", async () => {
      const h = setup(forKind(kind, { row: null }));
      expect(await approve(h.deps, kind, "nope", ADMIN)).toEqual({ ok: false, error: M.notFound(kind) });
      expectUntouched(h);
    });

    it("zero rows on the write: changed, and nothing follows", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "awaiting_approval", member_id: "m1" }), write: () => dbOk(null) }));
      expect(await approve(h.deps, kind, `${kind[0]}1`, ADMIN)).toEqual({ ok: false, error: M.changed });
      expectNoSideEffects(h);
    });
  });
});

/* ------------------------------------------------------------------ publish */

describe("publish", () => {
  describe.each(["story", "video"] as const)("%s", (kind) => {
    const table = TABLE[kind];

    it("goes Live from draft: stamps published_at, conditional on the status read, queues the social post — no approval", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "draft" }) }));
      expect(await publish(h.deps, kind, `${kind[0]}1`, ADMIN)).toEqual({ ok: true });

      const [w] = h.writes(table);
      expect(h.writes(table)).toHaveLength(1);
      expect(w.values).toEqual(expect.objectContaining({ status: "published", published_at: expect.any(String) }));
      if (kind === "video") expect(w.values).toEqual(expect.objectContaining({ updated_at: expect.any(String) }));
      expect(w.eq).toContainEqual(["id", `${kind[0]}1`]);
      expect(w.eq).toContainEqual(["status", "draft"]);
      expect(h.enqueue).toHaveBeenCalledWith("social_push", { [KEY[kind]]: `${kind[0]}1` }, expect.any(Date));
      expect(h.tablesRead()).not.toContain("approvals");
    });

    it("emails the member that it's live when it has one", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "scheduled", member_id: "m1", source: "member" }) }));
      expect(await publish(h.deps, kind, `${kind[0]}1`, ADMIN)).toEqual({ ok: true });
      expect(h.notices()).toContainEqual({ member_id: "m1", kind: LIVE[kind], [KEY[kind]]: `${kind[0]}1` });
    });

    it("sends no live email without a member", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "draft", member_id: null }) }));
      expect(await publish(h.deps, kind, `${kind[0]}1`, ADMIN)).toEqual({ ok: true });
      expect(h.notices()).toEqual([]);
    });

    it("records an approval when it leaves Ready to review", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "awaiting_approval", member_id: "m1", source: "member" }) }));
      expect(await publish(h.deps, kind, `${kind[0]}1`, ADMIN)).toEqual({ ok: true });
      expect(h.writes(table)[0]?.eq).toContainEqual(["status", "awaiting_approval"]);
      expect(h.approvalRows()).toEqual([approval(kind, `${kind[0]}1`, "approved", null)]);
    });

    it.each(["rejected", "scheduled"])("is allowed from %s (Q8), with no approval", async (status) => {
      const h = setup(forKind(kind, { row: row(kind, { status }) }));
      expect(await publish(h.deps, kind, `${kind[0]}1`, ADMIN)).toEqual({ ok: true });
      expect(h.writes(table)[0]?.eq).toContainEqual(["status", status]);
      expect(h.tablesRead()).not.toContain("approvals");
    });

    it.each(["published", "withdrawn"] as const)("refuses a %s %s and touches nothing", async (status) => {
      const h = setup(forKind(kind, { row: row(kind, { status, member_id: "m1" }) }));
      expect(await publish(h.deps, kind, `${kind[0]}1`, ADMIN))
        .toEqual({ ok: false, error: M.cantPublish(kind, STORY_STATUS_LABELS[status]) });
      expectUntouched(h);
    });

    it("refuses a missing row as not found", async () => {
      const h = setup(forKind(kind, { row: null }));
      expect(await publish(h.deps, kind, "nope", ADMIN)).toEqual({ ok: false, error: M.notFound(kind) });
      expectUntouched(h);
    });

    it("a failed write stops everything: no social post, no email, no approval", async () => {
      const h = setup(forKind(kind, {
        row: row(kind, { status: "awaiting_approval", member_id: "m1", source: "member" }),
        write: () => dbError("boom"),
      }));
      expect(await publish(h.deps, kind, `${kind[0]}1`, ADMIN)).toEqual({ ok: false, error: M.publishFailed(kind) });
      expectNoSideEffects(h);
    });

    it("a write that matched no row (someone got there first) is 'changed', with no side effects", async () => {
      const h = setup(forKind(kind, {
        row: row(kind, { status: "awaiting_approval", member_id: "m1", source: "member" }),
        write: () => dbOk(null),
      }));
      expect(await publish(h.deps, kind, `${kind[0]}1`, ADMIN)).toEqual({ ok: false, error: M.changed });
      expectNoSideEffects(h);
    });
  });

  it("refuses a member's unsubmitted story draft as not found", async () => {
    const h = setup({ stories: { row: row("story", { status: "draft", member_draft: true, member_id: "m1", source: "member" }) } });
    expect(await publish(h.deps, "story", "s1", ADMIN)).toEqual({ ok: false, error: M.notFound("story") });
    expectUntouched(h);
  });

  describe("event", () => {
    it("goes Live from draft: sets updated_at (no published_at), no social post, no approval", async () => {
      const h = setup({ events: { row: row("event", { status: "draft" }) } });
      expect(await publish(h.deps, "event", "e1", ADMIN)).toEqual({ ok: true });

      const [w] = h.writes("events");
      expect(h.writes("events")).toHaveLength(1);
      expect(w.values).toEqual(expect.objectContaining({ status: "published", updated_at: expect.any(String) }));
      expect(w.values).not.toHaveProperty("published_at");
      expect(w.eq).toContainEqual(["id", "e1"]);
      expect(w.eq).toContainEqual(["status", "draft"]);
      expect(h.kinds()).not.toContain("social_push");
      expect(h.notices()).toEqual([]);
      expect(h.tablesRead()).not.toContain("approvals");
    });

    it("from Ready to review: emails event_published to its member and records the approval", async () => {
      const h = setup({ events: { row: row("event", { status: "awaiting_approval", member_id: "m1", source: "member" }) } });
      expect(await publish(h.deps, "event", "e1", ADMIN)).toEqual({ ok: true });
      expect(h.notices()).toEqual([{ member_id: "m1", kind: "event_published", event_id: "e1" }]);
      expect(h.kinds()).not.toContain("social_push");
      expect(h.approvalRows()).toEqual([approval("event", "e1", "approved", null)]);
    });

    it.each(["rejected", "withdrawn"] as const)("refuses a %s event and touches nothing", async (status) => {
      const h = setup({ events: { row: row("event", { status, member_id: "m1" }) } });
      expect(await publish(h.deps, "event", "e1", ADMIN))
        .toEqual({ ok: false, error: M.cantPublish("event", STORY_STATUS_LABELS[status]) });
      expectUntouched(h);
    });

    it("refuses a missing event as not found", async () => {
      const h = setup({ events: { row: null } });
      expect(await publish(h.deps, "event", "nope", ADMIN)).toEqual({ ok: false, error: M.notFound("event") });
      expectUntouched(h);
    });

    it("a failed write: publishFailed, no email, no approval", async () => {
      const h = setup({ events: { row: row("event", { status: "awaiting_approval", member_id: "m1" }), write: () => dbError("boom") } });
      expect(await publish(h.deps, "event", "e1", ADMIN)).toEqual({ ok: false, error: M.publishFailed("event") });
      expectNoSideEffects(h);
    });

    it("zero rows: changed, no email, no approval", async () => {
      const h = setup({ events: { row: row("event", { status: "awaiting_approval", member_id: "m1" }), write: () => dbOk(null) } });
      expect(await publish(h.deps, "event", "e1", ADMIN)).toEqual({ ok: false, error: M.changed });
      expectNoSideEffects(h);
    });
  });
});

/* ------------------------------------------------------------------ schedule */

describe("schedule", () => {
  const at = new Date("2026-12-01T09:30:00.000Z");

  describe.each(["story", "video"] as const)("%s", (kind) => {
    const table = TABLE[kind];

    it("sets scheduled + scheduled_at, conditional on the status read; no social post, no email, no approval from draft", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "draft", member_id: "m1" }) }));
      expect(await schedule(h.deps, kind, `${kind[0]}1`, at, ADMIN)).toEqual({ ok: true });

      const [w] = h.writes(table);
      expect(h.writes(table)).toHaveLength(1);
      expect(w.values).toEqual(expect.objectContaining({ status: "scheduled", scheduled_at: at.toISOString() }));
      if (kind === "video") expect(w.values).toEqual(expect.objectContaining({ updated_at: expect.any(String) }));
      expect(w.eq).toContainEqual(["id", `${kind[0]}1`]);
      expect(w.eq).toContainEqual(["status", "draft"]);
      expectNoSideEffects(h);
    });

    it("records an approval when it leaves Ready to review — still no social post or email", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "awaiting_approval", member_id: "m1", source: "member" }) }));
      expect(await schedule(h.deps, kind, `${kind[0]}1`, at, ADMIN)).toEqual({ ok: true });
      expect(h.approvalRows()).toEqual([approval(kind, `${kind[0]}1`, "approved", null)]);
      expect(h.enqueue).not.toHaveBeenCalled();
    });

    it.each(["published", "withdrawn"] as const)("refuses a %s item and touches nothing", async (status) => {
      const h = setup(forKind(kind, { row: row(kind, { status }) }));
      expect(await schedule(h.deps, kind, `${kind[0]}1`, at, ADMIN))
        .toEqual({ ok: false, error: M.cantPublish(kind, STORY_STATUS_LABELS[status]) });
      expectUntouched(h);
    });

    it("refuses a missing row as not found", async () => {
      const h = setup(forKind(kind, { row: null }));
      expect(await schedule(h.deps, kind, "nope", at, ADMIN)).toEqual({ ok: false, error: M.notFound(kind) });
      expectUntouched(h);
    });

    // Ambiguity: the contract names publishFailed/moveFailed for write errors but
    // not which one schedule uses — accept either, insist on a refusal with no side effects.
    it("a failed write: refused, no approval", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "awaiting_approval" }), write: () => dbError("boom") }));
      const r = await schedule(h.deps, kind, `${kind[0]}1`, at, ADMIN);
      expect(r.ok).toBe(false);
      expect([M.publishFailed(kind), M.moveFailed(kind)]).toContain(!r.ok && r.error);
      expectNoSideEffects(h);
    });

    it("zero rows: changed, no approval", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "awaiting_approval" }), write: () => dbOk(null) }));
      expect(await schedule(h.deps, kind, `${kind[0]}1`, at, ADMIN)).toEqual({ ok: false, error: M.changed });
      expectNoSideEffects(h);
    });
  });

  it("refuses a member's unsubmitted story draft as not found", async () => {
    const h = setup({ stories: { row: row("story", { status: "draft", member_draft: true, source: "member" }) } });
    expect(await schedule(h.deps, "story", "s1", at, ADMIN)).toEqual({ ok: false, error: M.notFound("story") });
    expectUntouched(h);
  });

  it("refuses an event: events aren't scheduled", async () => {
    const h = setup({ events: { row: row("event", { status: "awaiting_approval" }) } });
    // The signature only admits story | video; a direct caller can still pass "event".
    const r = await schedule(h.deps, "event" as "story", "e1", at, ADMIN);
    expect(r).toEqual({ ok: false, error: M.notScheduled });
    expectUntouched(h);
  });
});

/* ------------------------------------------------------------------ decline */

describe("decline", () => {
  describe.each(["story", "video"] as const)("%s", (kind) => {
    const table = TABLE[kind];
    const id = `${kind[0]}1`;

    it("a member's is Sent back with the reason, emailed to them, and recorded", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "awaiting_approval", member_id: "m1", source: "member" }) }));
      expect(await decline(h.deps, kind, id, ADMIN, "Needs a photo")).toEqual({ ok: true });

      const [w] = h.writes(table);
      expect(h.writes(table)).toHaveLength(1);
      expect(w.values).toEqual(expect.objectContaining({ status: "rejected", rejected_reason: "Needs a photo" }));
      if (kind === "video") expect(w.values).toEqual(expect.objectContaining({ updated_at: expect.any(String) }));
      expect(w.eq).toContainEqual(["id", id]);
      expect(w.eq).toContainEqual(["status", "awaiting_approval"]);
      expect(h.notices()).toEqual([{ member_id: "m1", kind: REJECTED[kind], [KEY[kind]]: id, reason: "Needs a photo" }]);
      expect(h.kinds()).not.toContain("social_push");
      expect(h.approvalRows()).toEqual([approval(kind, id, "rejected", "Needs a photo")]);
    });

    it("the desk's own goes back to Draft with no email, even when it's about a member; approval reason null", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "awaiting_approval", member_id: "m1", source: "manual" }) }));
      expect(await decline(h.deps, kind, id, ADMIN)).toEqual({ ok: true });

      const [w] = h.writes(table);
      expect(w.values).toEqual(expect.objectContaining({ status: "draft" }));
      expect(w.eq).toContainEqual(["status", "awaiting_approval"]);
      expect(h.enqueue).not.toHaveBeenCalled();
      expect(h.approvalRows()).toEqual([approval(kind, id, "rejected", null)]);
    });

    it.each([undefined, "", "   \n "])("a member's with no reason (%j) is refused and nothing is written", async (reason) => {
      const h = setup(forKind(kind, { row: row(kind, { status: "awaiting_approval", member_id: "m1", source: "member" }) }));
      expect(await decline(h.deps, kind, id, ADMIN, reason)).toEqual({ ok: false, error: M.reasonRequired });
      expectUntouched(h);
    });

    it.each(["draft", "published", "rejected", "scheduled"])("from %s it has already been decided", async (status) => {
      const h = setup(forKind(kind, { row: row(kind, { status, member_id: "m1", source: "member" }) }));
      expect(await decline(h.deps, kind, id, ADMIN, "Needs a photo")).toEqual({ ok: false, error: M.alreadyDecided(kind) });
      expectUntouched(h);
    });

    it("a missing row is not found", async () => {
      const h = setup(forKind(kind, { row: null }));
      expect(await decline(h.deps, kind, "nope", ADMIN, "x")).toEqual({ ok: false, error: M.notFound(kind) });
      expectUntouched(h);
    });

    // Ambiguity: which failure message decline uses isn't in the contract.
    it("a failed write: refused, no email, no approval", async () => {
      const h = setup(forKind(kind, {
        row: row(kind, { status: "awaiting_approval", member_id: "m1", source: "member" }),
        write: () => dbError("boom"),
      }));
      const r = await decline(h.deps, kind, id, ADMIN, "Needs a photo");
      expect(r.ok).toBe(false);
      expect([M.publishFailed(kind), M.moveFailed(kind)]).toContain(!r.ok && r.error);
      expectNoSideEffects(h);
    });

    it("zero rows: changed, no email, no approval", async () => {
      const h = setup(forKind(kind, {
        row: row(kind, { status: "awaiting_approval", member_id: "m1", source: "member" }),
        write: () => dbOk(null),
      }));
      expect(await decline(h.deps, kind, id, ADMIN, "Needs a photo")).toEqual({ ok: false, error: M.changed });
      expectNoSideEffects(h);
    });
  });

  it("refuses a member's unsubmitted story draft as not found", async () => {
    const h = setup({ stories: { row: row("story", { status: "draft", member_draft: true, member_id: "m1", source: "member" }) } });
    expect(await decline(h.deps, "story", "s1", ADMIN, "x")).toEqual({ ok: false, error: M.notFound("story") });
    expectUntouched(h);
  });

  describe("event", () => {
    it("a member's is rejected with the reason, emailed event_rejected, and recorded", async () => {
      const h = setup({ events: { row: row("event", { status: "awaiting_approval", member_id: "m1", source: "member" }) } });
      expect(await decline(h.deps, "event", "e1", ADMIN, "Wrong date")).toEqual({ ok: true });

      const [w] = h.writes("events");
      expect(w.values).toEqual(expect.objectContaining({ status: "rejected", rejected_reason: "Wrong date", updated_at: expect.any(String) }));
      expect(w.eq).toContainEqual(["status", "awaiting_approval"]);
      expect(h.notices()).toEqual([{ member_id: "m1", kind: "event_rejected", event_id: "e1", reason: "Wrong date" }]);
      expect(h.approvalRows()).toEqual([approval("event", "e1", "rejected", "Wrong date")]);
    });

    it("a desk event is rejected too (not sent to draft), and emails its linked member", async () => {
      const h = setup({ events: { row: row("event", { status: "awaiting_approval", member_id: "m1", source: "manual" }) } });
      expect(await decline(h.deps, "event", "e1", ADMIN, "Duplicate")).toEqual({ ok: true });
      expect(h.writes("events")[0]?.values).toEqual(expect.objectContaining({ status: "rejected", rejected_reason: "Duplicate" }));
      expect(h.notices()).toEqual([{ member_id: "m1", kind: "event_rejected", event_id: "e1", reason: "Duplicate" }]);
    });

    it("a desk event with no member sends no email", async () => {
      const h = setup({ events: { row: row("event", { status: "awaiting_approval", member_id: null }) } });
      expect(await decline(h.deps, "event", "e1", ADMIN, "Duplicate")).toEqual({ ok: true });
      expect(h.enqueue).not.toHaveBeenCalled();
      expect(h.approvalRows()).toEqual([approval("event", "e1", "rejected", "Duplicate")]);
    });

    // 3 Nov decision: the empty-reason refusal is for source === "member" only.
    it("a desk event linked to a member may be rejected with an empty reason", async () => {
      const h = setup({ events: { row: row("event", { status: "awaiting_approval", member_id: "m1", source: "manual" }) } });
      expect(await decline(h.deps, "event", "e1", ADMIN, "")).toEqual({ ok: true });
      expect(h.writes("events")[0]?.values).toEqual(expect.objectContaining({ status: "rejected" }));
      expect(h.notices()).toEqual([expect.objectContaining({ member_id: "m1", kind: "event_rejected", event_id: "e1" })]);
      expect(h.approvalRows()).toEqual([approval("event", "e1", "rejected", null)]);
    });

    it("a member's event with a blank reason is refused", async () => {
      const h = setup({ events: { row: row("event", { status: "awaiting_approval", member_id: "m1", source: "member" }) } });
      expect(await decline(h.deps, "event", "e1", ADMIN, "  ")).toEqual({ ok: false, error: M.reasonRequired });
      expectUntouched(h);
    });

    it("an event no longer Ready to review has already been decided", async () => {
      const h = setup({ events: { row: row("event", { status: "published", member_id: "m1", source: "member" }) } });
      expect(await decline(h.deps, "event", "e1", ADMIN, "Wrong date")).toEqual({ ok: false, error: M.alreadyDecided("event") });
      expectUntouched(h);
    });

    it("a failed write: refused, no email, no approval", async () => {
      const h = setup({ events: { row: row("event", { status: "awaiting_approval", member_id: "m1", source: "member" }), write: () => dbError("boom") } });
      const r = await decline(h.deps, "event", "e1", ADMIN, "Wrong date");
      expect(r.ok).toBe(false);
      expect([M.publishFailed("event"), M.moveFailed("event")]).toContain(!r.ok && r.error);
      expectNoSideEffects(h);
    });

    it("zero rows: changed, no email, no approval", async () => {
      const h = setup({ events: { row: row("event", { status: "awaiting_approval", member_id: "m1", source: "member" }), write: () => dbOk(null) } });
      expect(await decline(h.deps, "event", "e1", ADMIN, "Wrong date")).toEqual({ ok: false, error: M.changed });
      expectNoSideEffects(h);
    });
  });
});

/* ------------------------------------------------------------------ move */

describe("move", () => {
  it.each([
    ["story", "draft", "scheduled"],
    ["story", "published", "awaiting_approval"],
    ["story", "awaiting_approval", "rejected"],
    ["video", "draft", "scheduled"],
    ["video", "published", "scheduled"],
    ["event", "awaiting_approval", "draft"],
    ["event", "draft", "awaiting_approval"],
    ["event", "rejected", "published"],
  ] as const)("refuses an illegal %s move %s → %s and touches nothing", async (kind, from, to) => {
    const h = setup(forKind(kind, { row: row(kind, { status: from }) }));
    expect(await move(h.deps, kind, `${kind[0]}1`, to, ADMIN)).toEqual({ ok: false, error: M.illegalMove(kind, from, to) });
    expectUntouched(h);
  });

  it.each(["story", "video", "event"] as const)("a missing %s is not found", async (kind) => {
    const h = setup(forKind(kind, { row: null }));
    expect(await move(h.deps, kind, "nope", "published", ADMIN)).toEqual({ ok: false, error: M.notFound(kind) });
    expectUntouched(h);
  });

  it("a member's unsubmitted story draft is not found", async () => {
    const h = setup({ stories: { row: row("story", { status: "draft", member_draft: true, member_id: "m1", source: "member" }) } });
    expect(await move(h.deps, "story", "s1", "published", ADMIN)).toEqual({ ok: false, error: M.notFound("story") });
    expectUntouched(h);
  });

  describe.each(["story", "video"] as const)("%s", (kind) => {
    const table = TABLE[kind];
    const id = `${kind[0]}1`;

    it("refuses dragging a member's item from Ready to review back to Draft", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "awaiting_approval", member_id: "m1", source: "member" }) }));
      expect(await move(h.deps, kind, id, "draft", ADMIN)).toEqual({ ok: false, error: M.memberSendBack(kind) });
      expectUntouched(h);
    });

    it("the desk's own from Ready to review to Draft ('Not yet'): draft, approval rejected with no reason, no email", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "awaiting_approval", member_id: "m1", source: "manual" }) }));
      expect(await move(h.deps, kind, id, "draft", ADMIN)).toEqual({ ok: true });

      const [w] = h.writes(table);
      expect(h.writes(table)).toHaveLength(1);
      expect(w.values).toEqual(expect.objectContaining({ status: "draft" }));
      expect(w.eq).toContainEqual(["status", "awaiting_approval"]);
      expect(h.enqueue).not.toHaveBeenCalled();
      expect(h.approvalRows()).toEqual([approval(kind, id, "rejected", null)]);
    });

    it("to Live from Ready to review takes the publish path: social post, live email, approval — reading the row once", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "awaiting_approval", member_id: "m1", source: "member" }) }));
      expect(await move(h.deps, kind, id, "published", ADMIN)).toEqual({ ok: true });

      const [w] = h.writes(table);
      expect(h.writes(table)).toHaveLength(1);
      expect(w.values).toEqual(expect.objectContaining({ status: "published", published_at: expect.any(String) }));
      expect(w.eq).toContainEqual(["status", "awaiting_approval"]);
      expect(h.enqueue).toHaveBeenCalledWith("social_push", { [KEY[kind]]: id }, expect.any(Date));
      expect(h.notices()).toContainEqual({ member_id: "m1", kind: LIVE[kind], [KEY[kind]]: id });
      expect(h.approvalRows()).toEqual([approval(kind, id, "approved", null)]);
      expect(h.rowReads(table)).toBe(1);
    });

    it("to Live from Scheduled: published with its side effects, no approval", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "scheduled", member_id: null }) }));
      expect(await move(h.deps, kind, id, "published", ADMIN)).toEqual({ ok: true });
      expect(h.writes(table)[0]?.eq).toContainEqual(["status", "scheduled"]);
      expect(h.enqueue).toHaveBeenCalledWith("social_push", { [KEY[kind]]: id }, expect.any(Date));
      expect(h.tablesRead()).not.toContain("approvals");
    });

    it("taking a Live item down to Draft clears published_at and cancels its pending social post — no approval, no email", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "published", member_id: "m1", source: "member" }) }));
      expect(await move(h.deps, kind, id, "draft", ADMIN)).toEqual({ ok: true });

      const [w] = h.writes(table);
      expect(h.writes(table)).toHaveLength(1);
      expect(w.values).toEqual(expect.objectContaining({ status: "draft", published_at: null }));
      if (kind === "video") expect(w.values).toEqual(expect.objectContaining({ updated_at: expect.any(String) }));
      expect(w.eq).toContainEqual(["status", "published"]);
      expect(h.jobDeletes()).toContainEqual(expect.arrayContaining([[`payload->>${KEY[kind]}`, "eq", id]]));
      expect(h.enqueue).not.toHaveBeenCalled();
      expect(h.tablesRead()).not.toContain("approvals");
    });

    it("Draft to Ready to review is a plain conditional write with no side effects", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "draft", member_id: "m1" }) }));
      expect(await move(h.deps, kind, id, "awaiting_approval", ADMIN)).toEqual({ ok: true });

      const [w] = h.writes(table);
      expect(h.writes(table)).toHaveLength(1);
      expect(w.values).toEqual(expect.objectContaining({ status: "awaiting_approval" }));
      expect(w.values).not.toHaveProperty("published_at");
      expect(w.eq).toContainEqual(["id", id]);
      expect(w.eq).toContainEqual(["status", "draft"]);
      expectNoSideEffects(h);
    });

    it("a failed plain write: moveFailed, nothing else", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "draft" }), write: () => dbError("boom") }));
      expect(await move(h.deps, kind, id, "awaiting_approval", ADMIN)).toEqual({ ok: false, error: M.moveFailed(kind) });
      expectNoSideEffects(h);
    });

    it("a failed take-down write: moveFailed, the social post is not cancelled", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "published" }), write: () => dbError("boom") }));
      expect(await move(h.deps, kind, id, "draft", ADMIN)).toEqual({ ok: false, error: M.moveFailed(kind) });
      expectNoSideEffects(h);
    });

    it("a failed desk 'Not yet' write: moveFailed, no approval", async () => {
      const h = setup(forKind(kind, { row: row(kind, { status: "awaiting_approval" }), write: () => dbError("boom") }));
      expect(await move(h.deps, kind, id, "draft", ADMIN)).toEqual({ ok: false, error: M.moveFailed(kind) });
      expectNoSideEffects(h);
    });

    // Ambiguity: move → published "is the publish path", so its failure reads as publishFailed (as moveStory said before).
    it("a failed write to Live: publishFailed, no social post, no email, no approval", async () => {
      const h = setup(forKind(kind, {
        row: row(kind, { status: "awaiting_approval", member_id: "m1", source: "member" }),
        write: () => dbError("boom"),
      }));
      expect(await move(h.deps, kind, id, "published", ADMIN)).toEqual({ ok: false, error: M.publishFailed(kind) });
      expectNoSideEffects(h);
    });

    it.each([
      ["draft", "awaiting_approval"],
      ["published", "draft"],
      ["awaiting_approval", "draft"],
      ["awaiting_approval", "published"],
    ] as const)("zero rows on %s → %s: changed, no side effects", async (from, to) => {
      const h = setup(forKind(kind, { row: row(kind, { status: from, member_id: "m1" }), write: () => dbOk(null) }));
      expect(await move(h.deps, kind, id, to, ADMIN)).toEqual({ ok: false, error: M.changed });
      expectNoSideEffects(h);
    });
  });

  describe("event", () => {
    it("Ready to review → Live: event_published email and approval, no social post", async () => {
      const h = setup({ events: { row: row("event", { status: "awaiting_approval", member_id: "m1", source: "member" }) } });
      expect(await move(h.deps, "event", "e1", "published", ADMIN)).toEqual({ ok: true });
      expect(h.writes("events")[0]?.values).toEqual(expect.objectContaining({ status: "published", updated_at: expect.any(String) }));
      expect(h.notices()).toEqual([{ member_id: "m1", kind: "event_published", event_id: "e1" }]);
      expect(h.kinds()).not.toContain("social_push");
      expect(h.approvalRows()).toEqual([approval("event", "e1", "approved", null)]);
      expect(h.rowReads("events")).toBe(1);
    });

    it("Live → Draft: draft with updated_at, no email, no approval, no social cancel", async () => {
      const h = setup({ events: { row: row("event", { status: "published", member_id: "m1" }) } });
      expect(await move(h.deps, "event", "e1", "draft", ADMIN)).toEqual({ ok: true });

      const [w] = h.writes("events");
      expect(h.writes("events")).toHaveLength(1);
      expect(w.values).toEqual(expect.objectContaining({ status: "draft", updated_at: expect.any(String) }));
      expect(w.values).not.toHaveProperty("published_at");
      expect(w.eq).toContainEqual(["status", "published"]);
      expectNoSideEffects(h);
    });

    it("a failed Live → Draft write: moveFailed", async () => {
      const h = setup({ events: { row: row("event", { status: "published" }), write: () => dbError("boom") } });
      expect(await move(h.deps, "event", "e1", "draft", ADMIN)).toEqual({ ok: false, error: M.moveFailed("event") });
      expectNoSideEffects(h);
    });

    it("zero rows on Ready to review → Live: changed, no email, no approval", async () => {
      const h = setup({ events: { row: row("event", { status: "awaiting_approval", member_id: "m1" }), write: () => dbOk(null) } });
      expect(await move(h.deps, "event", "e1", "published", ADMIN)).toEqual({ ok: false, error: M.changed });
      expectNoSideEffects(h);
    });
  });
});

/* ------------------------------------------------------------------ publishDue */

describe("publishDue", () => {
  const now = new Date("2026-11-03T08:00:00.000Z");

  function due() {
    return setup({
      stories: {
        // s1 fails, s2 lost the race, s3 is fine — the loop must reach s3
        list: [
          { id: "s1", member_id: "m1", status: "scheduled" },
          { id: "s2", member_id: "m2", status: "scheduled" },
          { id: "s3", member_id: "m3", status: "scheduled" },
        ],
        write: (id) => (id === "s1" ? dbError("boom") : id === "s2" ? dbOk(null) : dbOk({ id })),
      },
      videos: {
        list: [
          { id: "v1", member_id: "m4", status: "scheduled" },
          { id: "v2", member_id: null, status: "scheduled" },
        ],
      },
    });
  }

  it("publishes what's due, skips what someone else got to, and carries on past a failure", async () => {
    const h = due();
    const r = await publishDue(h.deps, now);

    expect(r.published).toEqual([{ kind: "story", id: "s3" }, { kind: "video", id: "v1" }, { kind: "video", id: "v2" }]);
    expect(r.skipped).toEqual([{ kind: "story", id: "s2" }]);
    expect(r.failed).toEqual([{ kind: "story", id: "s1", error: expect.any(String) }]);
  });

  it("asks only for scheduled rows due by `now`", async () => {
    const h = due();
    await publishDue(h.deps, now);
    // the list query is the one without an update or a single-row read
    for (const table of ["stories", "videos"] as const) {
      const listCalls = h.db.from.mock.results
        .filter((_, i) => h.db.from.mock.calls[i]?.[0] === table)
        .map((res) => res.value as Builder)
        .filter((b) => !called(b, "update") && !called(b, "maybeSingle"));
      expect(listCalls).toHaveLength(1);
      expect(spy(listCalls[0]!, "eq")).toHaveBeenCalledWith("status", "scheduled");
      expect(spy(listCalls[0]!, "lte")).toHaveBeenCalledWith("scheduled_at", now.toISOString());
    }
  });

  it("each write is conditional on still being scheduled, and stamps published_at", async () => {
    const h = due();
    await publishDue(h.deps, now);
    const all = [...h.writes("stories"), ...h.writes("videos")];
    expect(all).toHaveLength(5);
    for (const w of all) {
      expect(w.values).toEqual(expect.objectContaining({ status: "published", published_at: expect.any(String) }));
      expect(w.eq).toContainEqual(["status", "scheduled"]);
    }
    for (const w of h.writes("videos")) expect(w.values).toEqual(expect.objectContaining({ updated_at: expect.any(String) }));
  });

  it("queues the social post and live email only for rows it actually published, and never records an approval", async () => {
    const h = due();
    await publishDue(h.deps, now);

    const pushes = h.enqueue.mock.calls.filter(([k]) => k === "social_push").map(([, p]) => p);
    expect(pushes).toEqual([{ story_id: "s3" }, { video_id: "v1" }, { video_id: "v2" }]);
    expect(h.notices()).toEqual([
      { member_id: "m3", kind: "story_live", story_id: "s3" },
      { member_id: "m4", kind: "video_live", video_id: "v1" },
    ]);
    expect(h.tablesRead()).not.toContain("approvals");
  });

  it("reads the social settings once for the whole run", async () => {
    const h = due();
    await publishDue(h.deps, now);
    expect(h.tablesRead().filter((t) => t === "settings")).toHaveLength(1);
  });

  it("does nothing when nothing is due", async () => {
    const h = setup({ stories: { list: [] }, videos: { list: [] } });
    expect(await publishDue(h.deps, now)).toEqual({ published: [], skipped: [], failed: [] });
    expectUntouched(h);
  });
});

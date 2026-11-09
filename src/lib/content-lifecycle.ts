/**
 * Content lifecycle: the one place a Story, Video or Event changes status, and
 * everything that change sets off — the social post, the member's email and
 * the approval record. Console actions and the publish_scheduled job are thin
 * callers (GLOSSARY.md: Content lifecycle, Transition, Approval record).
 *
 * No Next.js imports and no "server-only": callers pass `{ db, enqueue }`, so
 * this unit-tests directly and jobs.ts can import it without a cycle (JobKind
 * and serviceDb are imported as types only).
 *
 * Every status write is conditional on the status just read
 * (`.eq("status", from)`). If it matches no row, someone else changed the item
 * first, and nothing is queued, emailed or recorded.
 */
import type { serviceDb } from "@/lib/db/server";
import type { JobKind } from "@/lib/jobs";
import { cancelSocialPush, handOffNow, queueSocialPush, readSocialCaps, reconcileNow, type SocialTarget } from "@/lib/social-push";
import type { SocialCaps } from "@/lib/social-caps";
import { enqueueStoryLive } from "@/lib/story-members";
import { canMoveStory, canScheduleStory, isMemberDraft, STORY_STATUS_LABELS } from "@/lib/story-board";
import { canMoveVideo, canScheduleVideo } from "@/lib/video-board";
import { canMoveEvent, EVENT_STATUS_LABELS } from "@/lib/event-board";
import { MEMBER_CHANGED_ERROR, memberCanWithdraw } from "@/lib/member-content";

/* ---------- contract (frozen: callers and tests are written against this) ---------- */

type Db = ReturnType<typeof serviceDb>;
type Enqueue = (kind: JobKind, payload?: Record<string, unknown>, dueAt?: Date) => Promise<void>;

export type LifecycleDeps = { db: Db; enqueue: Enqueue };
export type ContentKind = "story" | "video" | "event";
export type Actor = { userId: string };
/** A member acting on their own content (withdraw). */
export type MemberActor = { userId: string; memberId: string };
/**
 * Why a call was refused, for callers that route on it (the console sends a
 * not_found back to the list, everything else to the item's editor). The
 * message is for people; branch on the code, never on the message.
 */
export type RefusalCode = "not_found" | "refused" | "changed" | "failed";
export type LifecycleResult = { ok: true } | { ok: false; code: RefusalCode; error: string };

/**
 * The editor's Industry box, sent with its publishing buttons. `industryId`
 * present (a number, or null for "— none —") is written as chosen. Absent — the
 * board, a drag — a member's item with no industry takes the member's own, so
 * member content never goes Live untagged just because Jas approved it from
 * the board.
 */
export type PublishOptions = { industryId?: number | null };

export type PublishDueRow = { kind: "story" | "video"; id: string };
export type PublishDueResult = {
  published: PublishDueRow[];
  /** The conditional write matched no row: someone else published or moved it first. */
  skipped: PublishDueRow[];
  failed: (PublishDueRow & { error: string })[];
};

const KIND_NAME: Record<ContentKind, string> = { story: "Story", video: "Video", event: "Event" };

/** Every message a caller can be shown. Tests assert against these, not literal strings. */
export const LIFECYCLE_MESSAGES = {
  notFound: (kind: ContentKind) => `${KIND_NAME[kind]} not found.`,
  changed: "This item changed while you were looking at it — reload and try again.",
  publishFailed: (kind: ContentKind) => `The ${kind} couldn't be published — try again.`,
  scheduleFailed: (kind: ContentKind) => `The ${kind} couldn't be scheduled — try again.`,
  moveFailed: (kind: ContentKind) => `The ${kind} couldn't be moved — try again.`,
  illegalMove: (kind: ContentKind, from: string, to: string) => `Can't move a ${from} ${kind} straight to ${to}.`,
  memberSendBack: (kind: ContentKind) => `A member's ${kind} is sent back from its editor, with a reason they'll see.`,
  // Events are never scheduled, so their message doesn't offer it.
  cantPublish: (kind: ContentKind, statusLabel: string) =>
    kind === "event" ? `A ${statusLabel} event can't be published.` : `A ${statusLabel} ${kind} can't be published or scheduled.`,
  notScheduled: "Events aren't scheduled — publish them instead.",
  alreadyDecided: (kind: ContentKind) => `This ${kind} has already been decided.`,
  reasonRequired: "Say why it's being sent back — the member will see it.",
  // Member-facing: withdraw is the member's own action, so its refusals speak to them.
  memberChanged: (kind: ContentKind) => MEMBER_CHANGED_ERROR[kind],
  withdrawFailed: (kind: ContentKind) => `The ${kind} couldn't be withdrawn just now — please try again.`,
} as const;

/* ---------- per-kind policy (private) ---------- */

type Policy = {
  table: "stories" | "videos" | "events";
  /** Columns the one read per operation fetches. */
  cols: string;
  /** Stories and videos carry published_at; events don't. */
  publishedAt: boolean;
  /**
   * Stamp updated_at on every status write. All three kinds do: the member's
   * edit page posts updated_at as its version, so a send-back that left it
   * alone would let a form opened before it save over the reason.
   */
  updatedAt: boolean;
  canMove: (from: string, to: string) => boolean;
  /** Where Publish now / Schedule may start from. */
  canPublish: (from: string) => boolean;
  /** A member's story or video can't be dragged from Ready to review to Draft. */
  refuseMemberSendBack: boolean;
  /** The status names this kind's console shows, for refusal messages. */
  labels: Record<string, string>;
};

const POLICY: Record<ContentKind, Policy> = {
  story: {
    table: "stories",
    cols: "id, status, member_id, member_draft, source, industry_id",
    publishedAt: true,
    updatedAt: true,
    canMove: canMoveStory,
    canPublish: canScheduleStory,
    refuseMemberSendBack: true,
    labels: STORY_STATUS_LABELS,
  },
  video: {
    table: "videos",
    cols: "id, status, member_id, source, industry_id",
    publishedAt: true,
    updatedAt: true,
    canMove: canMoveVideo,
    canPublish: canScheduleVideo,
    refuseMemberSendBack: true,
    // Videos have the same statuses and the Video Engine names them the same way.
    labels: STORY_STATUS_LABELS,
  },
  event: {
    table: "events",
    cols: "id, status, member_id, source, industry_id",
    publishedAt: false,
    updatedAt: true,
    canMove: canMoveEvent,
    canPublish: (from) => canMoveEvent(from, "published"),
    refuseMemberSendBack: false,
    labels: EVENT_STATUS_LABELS,
  },
};

type Row = {
  id: string;
  status: string;
  member_id: string | null;
  member_draft?: boolean | null;
  source: string | null;
  industry_id?: number | null;
};
type WriteResult = { data: { id: string } | null; error: { message: string } | null };

/**
 * The three tables' Update types differ (events have no published_at), and a
 * union of them collapses the payload to never — so reads and writes go
 * through this narrow shape. It is exactly the chain the module uses.
 */
type StatusTable = {
  select(cols: string): { eq(col: "id", v: string): { maybeSingle(): PromiseLike<{ data: Row | null }> } };
  update(values: Record<string, unknown>): {
    eq(col: "id", v: string): {
      eq(col: "status", v: string): { select(cols: "id"): { maybeSingle(): PromiseLike<WriteResult> } };
    };
  };
};

const table = (d: LifecycleDeps, kind: ContentKind) => d.db.from(POLICY[kind].table) as unknown as StatusTable;

/** The one read per operation. A member's unsubmitted story draft is theirs, so it reads as not found. */
async function readRow(d: LifecycleDeps, kind: ContentKind, id: string): Promise<Row | null> {
  const { data } = await table(d, kind).select(POLICY[kind].cols).eq("id", id).maybeSingle();
  if (!data) return null;
  if (kind === "story" && isMemberDraft(data)) return null;
  return data;
}

/** Status write conditional on the status just read (Q11). */
async function writeFrom(d: LifecycleDeps, kind: ContentKind, id: string, from: string, values: Record<string, unknown>): Promise<"ok" | "changed" | { error: string }> {
  const stamped = POLICY[kind].updatedAt ? { ...values, updated_at: new Date().toISOString() } : values;
  const { data, error } = await table(d, kind).update(stamped).eq("id", id).eq("status", from).select("id").maybeSingle();
  if (error) return { error: error.message };
  return data === null ? "changed" : "ok";
}

/** Map a write outcome to a refusal, or null when it landed. */
function writeRefusal(outcome: Awaited<ReturnType<typeof writeFrom>>, failed: string): LifecycleResult | null {
  if (outcome === "ok") return null;
  if (outcome === "changed") return { ok: false, code: "changed", error: LIFECYCLE_MESSAGES.changed };
  return { ok: false, code: "failed", error: failed };
}

const OK: LifecycleResult = { ok: true };
const refuse = (error: string): LifecycleResult => ({ ok: false, code: "refused", error });
const notFound = (kind: ContentKind): LifecycleResult => ({ ok: false, code: "not_found", error: LIFECYCLE_MESSAGES.notFound(kind) });

function statusLabel(kind: ContentKind, status: string): string {
  return POLICY[kind].labels[status] ?? status;
}

/**
 * The industry to write alongside a publish or schedule (PublishOptions): the
 * editor's choice when it sent one; otherwise, for a member's untagged item,
 * the member's own industry; otherwise nothing.
 */
async function industryValues(d: LifecycleDeps, row: Row, opts?: PublishOptions): Promise<Record<string, unknown>> {
  if (opts?.industryId !== undefined) return { industry_id: opts.industryId };
  if (row.source !== "member" || row.industry_id != null || !row.member_id) return {};
  const { data } = await d.db.from("members").select("industry_id").eq("id", row.member_id).maybeSingle();
  return data?.industry_id ? { industry_id: data.industry_id } : {};
}

function socialTarget(kind: "story" | "video", id: string): SocialTarget {
  return kind === "story" ? { story_id: id } : { video_id: id };
}

/** The "it's live" email(s): every member a story features; a video's or event's own member. */
async function notifyLive(d: LifecycleDeps, kind: ContentKind, row: { id: string; member_id: string | null }) {
  if (kind === "story") {
    await enqueueStoryLive(d.db, { id: row.id, member_id: row.member_id }, d.enqueue);
    return;
  }
  if (!row.member_id) return;
  if (kind === "video") await d.enqueue("notify_member", { member_id: row.member_id, kind: "video_live", video_id: row.id });
  else await d.enqueue("notify_member", { member_id: row.member_id, kind: "event_published", event_id: row.id });
}

/** Approval record (Q9): only when a person moves an item out of Ready to review. */
async function recordApproval(d: LifecycleDeps, kind: ContentKind, id: string, from: string, decision: "approved" | "rejected", reason: string | null, actor: Actor) {
  if (from !== "awaiting_approval") return;
  await d.db.from("approvals").insert({ kind, subject_id: id, decision, reason, decided_by: actor.userId });
}

/** Publish from a row already read (publish, and move's route to Live). */
async function publishRow(d: LifecycleDeps, kind: ContentKind, row: Row, actor: Actor, approvalReason: string | null = null, opts?: PublishOptions): Promise<LifecycleResult> {
  const p = POLICY[kind];
  // The industry rides the same conditional write, so a refused publish tags nothing.
  const values: Record<string, unknown> = { ...(await industryValues(d, row, opts)), status: "published" };
  if (p.publishedAt) values.published_at = new Date().toISOString();
  const refused = writeRefusal(await writeFrom(d, kind, row.id, row.status, values), LIFECYCLE_MESSAGES.publishFailed(kind));
  if (refused) return refused;
  if (kind !== "event") {
    await queueSocialPush(d.db, socialTarget(kind, row.id), d.enqueue);
    // Channels already scheduled go to Buffer now, not at the next job run (issue #101).
    await handOffNow(d.db, socialTarget(kind, row.id), d.enqueue);
  }
  await notifyLive(d, kind, row);
  await recordApproval(d, kind, row.id, row.status, "approved", approvalReason, actor);
  return OK;
}

/** The desk's "Not yet": back to Draft, no email, an approval record (no reason from a drag; the typed one, if any, from decline). */
async function notYetRow(d: LifecycleDeps, kind: ContentKind, row: Row, actor: Actor, reason: string | null): Promise<LifecycleResult> {
  const refused = writeRefusal(await writeFrom(d, kind, row.id, row.status, { status: "draft" }), LIFECYCLE_MESSAGES.moveFailed(kind));
  if (refused) return refused;
  await recordApproval(d, kind, row.id, row.status, "rejected", reason, actor);
  return OK;
}

/* ---------- operations ---------- */

/** Make it Live now (Approve, Publish now, or a drag to Live). Writes an approval record when it leaves Ready to review. */
export async function publish(d: LifecycleDeps, kind: ContentKind, id: string, actor: Actor, opts?: PublishOptions): Promise<LifecycleResult> {
  const row = await readRow(d, kind, id);
  if (!row) return notFound(kind);
  if (!POLICY[kind].canPublish(row.status)) return refuse(LIFECYCLE_MESSAGES.cantPublish(kind, statusLabel(kind, row.status)));
  return publishRow(d, kind, row, actor, null, opts);
}

/**
 * The editor's Approve: publish, but only an item that is still Ready to
 * review. A stale tab approving something another admin already Sent back or
 * published is refused, never published (the same rule as decline).
 */
export async function approve(d: LifecycleDeps, kind: ContentKind, id: string, actor: Actor, reason?: string, opts?: PublishOptions): Promise<LifecycleResult> {
  const row = await readRow(d, kind, id);
  if (!row) return notFound(kind);
  if (row.status !== "awaiting_approval") return refuse(LIFECYCLE_MESSAGES.alreadyDecided(kind));
  return publishRow(d, kind, row, actor, reason || null, opts);
}

/** Set a story or video to go Live at `at`. Events are never scheduled. */
export async function schedule(d: LifecycleDeps, kind: "story" | "video", id: string, at: Date, actor: Actor, opts?: PublishOptions): Promise<LifecycleResult> {
  if ((kind as ContentKind) === "event") return refuse(LIFECYCLE_MESSAGES.notScheduled);
  const row = await readRow(d, kind, id);
  if (!row) return notFound(kind);
  if (!POLICY[kind].canPublish(row.status)) return refuse(LIFECYCLE_MESSAGES.cantPublish(kind, statusLabel(kind, row.status)));
  const values = { ...(await industryValues(d, row, opts)), status: "scheduled", scheduled_at: at.toISOString() };
  const outcome = await writeFrom(d, kind, id, row.status, values);
  const refused = writeRefusal(outcome, LIFECYCLE_MESSAGES.scheduleFailed(kind));
  if (refused) return refused;
  await recordApproval(d, kind, id, row.status, "approved", null, actor);
  return OK;
}

/**
 * Decline an item that is Ready to review: a member's is Sent back (reason
 * required, emailed); the desk's own goes back to Draft with no email — its
 * member_id is the company it is about, who didn't write it. Same for all
 * three kinds.
 */
export async function decline(d: LifecycleDeps, kind: ContentKind, id: string, actor: Actor, reason?: string): Promise<LifecycleResult> {
  const row = await readRow(d, kind, id);
  if (!row) return notFound(kind);
  if (row.status !== "awaiting_approval") return refuse(LIFECYCLE_MESSAGES.alreadyDecided(kind));
  const fromMember = row.source === "member";
  const text = reason ?? "";
  if (fromMember && !text.trim()) return refuse(LIFECYCLE_MESSAGES.reasonRequired);

  if (!fromMember) return notYetRow(d, kind, row, actor, text || null);

  const outcome = await writeFrom(d, kind, id, row.status, { status: "rejected", rejected_reason: text });
  const refused = writeRefusal(outcome, LIFECYCLE_MESSAGES.moveFailed(kind));
  if (refused) return refused;
  if (row.member_id) {
    await d.enqueue("notify_member", { member_id: row.member_id, kind: `${kind}_rejected`, [`${kind}_id`]: id, reason: text });
  }
  await recordApproval(d, kind, id, row.status, "rejected", text || null, actor);
  return OK;
}

/** Board drag / status dropdown: checks the move table, then routes to publish, decline's "Not yet", take down, or a plain move. */
export async function move(d: LifecycleDeps, kind: ContentKind, id: string, to: string, actor: Actor): Promise<LifecycleResult> {
  const p = POLICY[kind];
  const row = await readRow(d, kind, id);
  if (!row) return notFound(kind);
  if (!p.canMove(row.status, to)) return refuse(LIFECYCLE_MESSAGES.illegalMove(kind, row.status, to));
  const sendBack = row.status === "awaiting_approval" && to === "draft";
  if (sendBack && p.refuseMemberSendBack && row.source === "member") return refuse(LIFECYCLE_MESSAGES.memberSendBack(kind));

  if (to === "published") return publishRow(d, kind, row, actor);
  if (sendBack) return notYetRow(d, kind, row, actor, null);

  // Taken down (or any move off Live): clear published_at so a re-publish stamps a fresh date.
  const leavingLive = row.status === "published";
  const values: Record<string, unknown> = { status: to };
  if (leavingLive && p.publishedAt) values.published_at = null;
  // Unscheduled: the old time goes too, so nothing keyed on scheduled_at still sees it as due.
  if (row.status === "scheduled") values.scheduled_at = null;
  const refused = writeRefusal(await writeFrom(d, kind, id, row.status, values), LIFECYCLE_MESSAGES.moveFailed(kind));
  if (refused) return refused;
  // Taken down before its post went out: drop the pending hand-off, and take
  // back out of Buffer any post it holds (kept scheduled, so re-publishing
  // hands it over again). Buffer would otherwise send a link to a page that's gone.
  if (leavingLive && kind !== "event") {
    await cancelSocialPush(d.db, socialTarget(kind, id));
    await reconcileNow(d.db, socialTarget(kind, id), d.enqueue);
  }
  return OK;
}

/**
 * A member pulls back their own submission while it waits on (or was sent back
 * from) a decision. Someone else's item, or one the desk wrote about them, is
 * not found. Their own item in any other state is "changed": the desk acted
 * since their page loaded, or (a story) it is a draft, which is deleted rather
 * than withdrawn. Nothing is queued, emailed or recorded.
 *
 * Unlike the console operations this reads member drafts too, so a member's
 * own draft gets "changed" rather than "not found". The write is conditional
 * on the status read and on the row still being theirs, and counts the rows
 * it changed (`.select("id")`), as the member's other writes do.
 */
export async function withdraw(d: LifecycleDeps, kind: ContentKind, id: string, member: MemberActor): Promise<LifecycleResult> {
  const p = POLICY[kind];
  const { data: row } = await table(d, kind).select(p.cols).eq("id", id).maybeSingle();
  if (!row || row.member_id !== member.memberId || row.source !== "member") return notFound(kind);
  const changed: LifecycleResult = { ok: false, code: "changed", error: LIFECYCLE_MESSAGES.memberChanged(kind) };
  if (!memberCanWithdraw(kind, row, member.memberId)) return changed;

  const values: Record<string, unknown> = { status: "withdrawn" };
  if (p.updatedAt) values.updated_at = new Date().toISOString();
  let q = (d.db.from(p.table) as unknown as { update(values: Record<string, unknown>): CountedUpdate }).update(values)
    .eq("id", id).eq("status", row.status).eq("member_id", member.memberId).eq("source", "member");
  if (kind === "story") q = q.eq("member_draft", false);
  const { data, error } = await q.select("id");
  if (error) return { ok: false, code: "failed", error: LIFECYCLE_MESSAGES.withdrawFailed(kind) };
  return data?.length ? OK : changed;
}

/**
 * A conditional update that counts the rows it changed: any number of `.eq`
 * filters, then `.select("id")`. Narrowed for the same reason as StatusTable.
 * Withdraw uses it here, and lib/content-intake for every write it makes.
 */
export type CountedUpdate = {
  eq(col: string, v: string | boolean): CountedUpdate;
  select(cols: "id"): PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>;
};

/** The publish_scheduled job: every story and video whose time has come goes Live. One bad row never stops the rest. */
export async function publishDue(d: LifecycleDeps, now: Date = new Date()): Promise<PublishDueResult> {
  const result: PublishDueResult = { published: [], skipped: [], failed: [] };
  const caps = await readSocialCaps(d.db);
  for (const kind of ["story", "video"] as const) {
    const { data: due } = await d.db
      .from(POLICY[kind].table as "stories" | "videos")
      .select("id, member_id")
      .eq("status", "scheduled")
      .lte("scheduled_at", now.toISOString());
    for (const row of due ?? []) {
      try {
        const outcome = await publishDueRow(d, kind, row, caps);
        if (outcome === "ok") result.published.push({ kind, id: row.id });
        else if (outcome === "changed") result.skipped.push({ kind, id: row.id });
        else result.failed.push({ kind, id: row.id, error: outcome.error });
      } catch (e) {
        result.failed.push({ kind, id: row.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return result;
}

/** One due row: the conditional write from "scheduled", then the social post and the live email. No approval record. */
async function publishDueRow(d: LifecycleDeps, kind: "story" | "video", row: { id: string; member_id: string | null }, caps: SocialCaps) {
  const outcome = await writeFrom(d, kind, row.id, "scheduled", { status: "published", published_at: new Date().toISOString() });
  if (outcome !== "ok") return outcome;
  await queueSocialPush(d.db, socialTarget(kind, row.id), d.enqueue, caps);
  await notifyLive(d, kind, row);
  return outcome;
}

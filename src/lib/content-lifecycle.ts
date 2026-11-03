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
import { cancelSocialPush, queueSocialPush, readSocialCaps, type SocialTarget } from "@/lib/social-push";
import type { SocialCaps } from "@/lib/social-caps";
import { enqueueStoryLive } from "@/lib/story-members";
import { canMoveStory, canScheduleStory, isMemberDraft, STORY_STATUS_LABELS } from "@/lib/story-board";
import { canMoveVideo, canScheduleVideo } from "@/lib/video-board";
import { canMoveEvent } from "@/lib/event-board";

/* ---------- contract (frozen: callers and tests are written against this) ---------- */

type Db = ReturnType<typeof serviceDb>;
type Enqueue = (kind: JobKind, payload?: Record<string, unknown>, dueAt?: Date) => Promise<void>;

export type LifecycleDeps = { db: Db; enqueue: Enqueue };
export type ContentKind = "story" | "video" | "event";
export type Actor = { userId: string };
export type LifecycleResult = { ok: true } | { ok: false; error: string };

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
  moveFailed: (kind: ContentKind) => `The ${kind} couldn't be moved — try again.`,
  illegalMove: (kind: ContentKind, from: string, to: string) => `Can't move a ${from} ${kind} straight to ${to}.`,
  memberSendBack: (kind: ContentKind) => `A member's ${kind} is sent back from its editor, with a reason they'll see.`,
  cantPublish: (kind: ContentKind, statusLabel: string) => `A ${statusLabel} ${kind} can't be published or scheduled.`,
  notScheduled: "Events aren't scheduled — publish them instead.",
  alreadyDecided: (kind: ContentKind) => `This ${kind} has already been decided.`,
  reasonRequired: "Say why it's being sent back — the member will see it.",
} as const;

/* ---------- per-kind policy (private) ---------- */

type Policy = {
  table: "stories" | "videos" | "events";
  /** Columns the one read per operation fetches. */
  cols: string;
  /** Stories and videos carry published_at; events don't. */
  publishedAt: boolean;
  /** Videos and events stamp updated_at on every status write; stories don't here. */
  updatedAt: boolean;
  canMove: (from: string, to: string) => boolean;
  /** Where Publish now / Schedule may start from. */
  canPublish: (from: string) => boolean;
  /** A member's story or video can't be dragged from Ready to review to Draft. */
  refuseMemberSendBack: boolean;
  /** Decline: true → always Sent back (events); false → member's Sent back, desk's back to Draft. */
  declineAlwaysRejects: boolean;
};

const POLICY: Record<ContentKind, Policy> = {
  story: {
    table: "stories",
    cols: "id, status, member_id, member_draft, source",
    publishedAt: true,
    updatedAt: false,
    canMove: canMoveStory,
    canPublish: canScheduleStory,
    refuseMemberSendBack: true,
    declineAlwaysRejects: false,
  },
  video: {
    table: "videos",
    cols: "id, status, member_id, source",
    publishedAt: true,
    updatedAt: true,
    canMove: canMoveVideo,
    canPublish: canScheduleVideo,
    refuseMemberSendBack: true,
    declineAlwaysRejects: false,
  },
  event: {
    table: "events",
    cols: "id, status, member_id, source",
    publishedAt: false,
    updatedAt: true,
    canMove: canMoveEvent,
    canPublish: (from) => canMoveEvent(from, "published"),
    refuseMemberSendBack: false,
    declineAlwaysRejects: true,
  },
};

type Row = { id: string; status: string; member_id: string | null; member_draft?: boolean | null; source: string | null };
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
  if (outcome === "changed") return { ok: false, error: LIFECYCLE_MESSAGES.changed };
  return { ok: false, error: failed };
}

const OK: LifecycleResult = { ok: true };
const fail = (error: string): LifecycleResult => ({ ok: false, error });

function statusLabel(status: string): string {
  return (STORY_STATUS_LABELS as Record<string, string>)[status] ?? status;
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
async function publishRow(d: LifecycleDeps, kind: ContentKind, row: Row, actor: Actor): Promise<LifecycleResult> {
  const p = POLICY[kind];
  const values: Record<string, unknown> = { status: "published" };
  if (p.publishedAt) values.published_at = new Date().toISOString();
  const refused = writeRefusal(await writeFrom(d, kind, row.id, row.status, values), LIFECYCLE_MESSAGES.publishFailed(kind));
  if (refused) return refused;
  if (kind !== "event") await queueSocialPush(d.db, socialTarget(kind, row.id), d.enqueue);
  await notifyLive(d, kind, row);
  await recordApproval(d, kind, row.id, row.status, "approved", null, actor);
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
export async function publish(d: LifecycleDeps, kind: ContentKind, id: string, actor: Actor): Promise<LifecycleResult> {
  const row = await readRow(d, kind, id);
  if (!row) return fail(LIFECYCLE_MESSAGES.notFound(kind));
  if (!POLICY[kind].canPublish(row.status)) return fail(LIFECYCLE_MESSAGES.cantPublish(kind, statusLabel(row.status)));
  return publishRow(d, kind, row, actor);
}

/** Set a story or video to go Live at `at`. Events are never scheduled. */
export async function schedule(d: LifecycleDeps, kind: "story" | "video", id: string, at: Date, actor: Actor): Promise<LifecycleResult> {
  if ((kind as ContentKind) === "event") return fail(LIFECYCLE_MESSAGES.notScheduled);
  const row = await readRow(d, kind, id);
  if (!row) return fail(LIFECYCLE_MESSAGES.notFound(kind));
  if (!POLICY[kind].canPublish(row.status)) return fail(LIFECYCLE_MESSAGES.cantPublish(kind, statusLabel(row.status)));
  const outcome = await writeFrom(d, kind, id, row.status, { status: "scheduled", scheduled_at: at.toISOString() });
  const refused = writeRefusal(outcome, LIFECYCLE_MESSAGES.publishFailed(kind));
  if (refused) return refused;
  await recordApproval(d, kind, id, row.status, "approved", null, actor);
  return OK;
}

/** Decline an item that is Ready to review: a member's is Sent back (reason required, emailed); the desk's own goes back to Draft. */
export async function decline(d: LifecycleDeps, kind: ContentKind, id: string, actor: Actor, reason?: string): Promise<LifecycleResult> {
  const row = await readRow(d, kind, id);
  if (!row) return fail(LIFECYCLE_MESSAGES.notFound(kind));
  if (row.status !== "awaiting_approval") return fail(LIFECYCLE_MESSAGES.alreadyDecided(kind));
  const fromMember = row.source === "member";
  const text = reason ?? "";
  if (fromMember && !text.trim()) return fail(LIFECYCLE_MESSAGES.reasonRequired);

  if (!fromMember && !POLICY[kind].declineAlwaysRejects) return notYetRow(d, kind, row, actor, text || null);

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
  if (!row) return fail(LIFECYCLE_MESSAGES.notFound(kind));
  if (!p.canMove(row.status, to)) return fail(LIFECYCLE_MESSAGES.illegalMove(kind, row.status, to));
  const sendBack = row.status === "awaiting_approval" && to === "draft";
  if (sendBack && p.refuseMemberSendBack && row.source === "member") return fail(LIFECYCLE_MESSAGES.memberSendBack(kind));

  if (to === "published") return publishRow(d, kind, row, actor);
  if (sendBack) return notYetRow(d, kind, row, actor, null);

  // Taken down (or any move off Live): clear published_at so a re-publish stamps a fresh date.
  const leavingLive = row.status === "published";
  const values: Record<string, unknown> = { status: to };
  if (leavingLive && p.publishedAt) values.published_at = null;
  const refused = writeRefusal(await writeFrom(d, kind, id, row.status, values), LIFECYCLE_MESSAGES.moveFailed(kind));
  if (refused) return refused;
  // Taken down before its post went out: drop the post (the job re-checks too).
  if (leavingLive && kind !== "event") await cancelSocialPush(d.db, socialTarget(kind, id));
  return OK;
}

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

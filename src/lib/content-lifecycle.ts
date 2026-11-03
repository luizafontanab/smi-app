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

/* ---------- operations ---------- */

/** Make it Live now (Approve, Publish now, or a drag to Live). Writes an approval record when it leaves Ready to review. */
export async function publish(d: LifecycleDeps, kind: ContentKind, id: string, actor: Actor): Promise<LifecycleResult> {
  void d; void kind; void id; void actor;
  throw new Error("not implemented");
}

/** Set a story or video to go Live at `at`. Events are never scheduled. */
export async function schedule(d: LifecycleDeps, kind: "story" | "video", id: string, at: Date, actor: Actor): Promise<LifecycleResult> {
  void d; void kind; void id; void at; void actor;
  throw new Error("not implemented");
}

/** Decline an item that is Ready to review: a member's is Sent back (reason required, emailed); the desk's own goes back to Draft. */
export async function decline(d: LifecycleDeps, kind: ContentKind, id: string, actor: Actor, reason?: string): Promise<LifecycleResult> {
  void d; void kind; void id; void actor; void reason;
  throw new Error("not implemented");
}

/** Board drag / status dropdown: checks the move table, then routes to publish, decline's "Not yet", take down, or a plain move. */
export async function move(d: LifecycleDeps, kind: ContentKind, id: string, to: string, actor: Actor): Promise<LifecycleResult> {
  void d; void kind; void id; void to; void actor;
  throw new Error("not implemented");
}

/** The publish_scheduled job: every story and video whose time has come goes Live. One bad row never stops the rest. */
export async function publishDue(d: LifecycleDeps, now: Date = new Date()): Promise<PublishDueResult> {
  void d; void now;
  throw new Error("not implemented");
}

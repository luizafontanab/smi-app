import { serviceDb } from "@/lib/db/server";

export type SubmissionKind = "story" | "video" | "event" | "machine";

/** One row of a member's pre-approval queue, across all four content types (A4.17). */
export type PendingSubmission = {
  id: string;
  kind: SubmissionKind;
  title: string;
  status: "awaiting_approval" | "rejected";
  rejected_reason: string | null;
  created_at: string;
  editHref: string;
};

const PENDING_STATUSES = ["awaiting_approval", "rejected"] as const;
const EDIT_HREF: Record<SubmissionKind, (id: string) => string> = {
  story: (id) => `/dashboard/story/${id}/edit`,
  video: (id) => `/dashboard/video/${id}/edit`,
  event: (id) => `/dashboard/event/${id}/edit`,
  machine: (id) => `/dashboard/equipment/${id}/edit`,
};

/**
 * Everything a member has submitted that hasn't been published yet — awaiting
 * approval or sent back — newest first, merged across stories, videos, events
 * and equipment. `total` is the real count across all four tables even when
 * `limit` trims the list, so a badge can show the true number while the
 * dashboard box shows only the most recent few (fix list item 34).
 */
export async function pendingSubmissions(memberId: string, opts: { limit?: number } = {}): Promise<{ items: PendingSubmission[]; total: number }> {
  const db = serviceDb();
  const cols = "id, title, status, rejected_reason, created_at";
  // Each table is capped at `limit` too: the newest N overall can only come
  // from the newest N of each type, so nothing is lost by trimming per table.
  const capped = <Q extends { limit: (n: number) => Q }>(q: Q) => (opts.limit != null ? q.limit(opts.limit) : q);

  const [stories, videos, events, machines] = await Promise.all([
    capped(db.from("stories").select(cols, { count: "exact" }).eq("member_id", memberId).in("status", PENDING_STATUSES).order("created_at", { ascending: false })),
    capped(db.from("videos").select(cols, { count: "exact" }).eq("member_id", memberId).in("status", PENDING_STATUSES).order("created_at", { ascending: false })),
    capped(db.from("events").select(cols, { count: "exact" }).eq("member_id", memberId).in("status", PENDING_STATUSES).order("created_at", { ascending: false })),
    capped(db.from("featured_machines").select("id, name, status, rejected_reason, created_at", { count: "exact" }).eq("member_id", memberId).in("status", PENDING_STATUSES).order("created_at", { ascending: false })),
  ]);

  type Raw = { id: string; title: string; status: string; rejected_reason: string | null; created_at: string };
  const rows = (kind: SubmissionKind, data: Raw[] | null): PendingSubmission[] =>
    (data ?? []).map((r) => ({
      id: r.id, kind, title: r.title, status: r.status as PendingSubmission["status"],
      rejected_reason: r.rejected_reason, created_at: r.created_at, editHref: EDIT_HREF[kind](r.id),
    }));

  const items = [
    ...rows("story", stories.data),
    ...rows("video", videos.data),
    ...rows("event", events.data),
    ...rows("machine", (machines.data ?? []).map(({ name, ...m }) => ({ ...m, title: name }))),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));

  const total = (stories.count ?? 0) + (videos.count ?? 0) + (events.count ?? 0) + (machines.count ?? 0);
  return { items: opts.limit != null ? items.slice(0, opts.limit) : items, total };
}

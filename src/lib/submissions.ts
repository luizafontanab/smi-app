import { serviceDb } from "@/lib/db/server";
import { isMemberLinkable } from "@/lib/member-visibility";
import { ownerMayPreview } from "@/lib/story-preview";

/**
 * `profile` is not a content table — it's a pending edit to the member's own
 * company page, held in `member_revisions`. It appears in this list because a
 * member who submits page changes is waiting on exactly the same approval as a
 * story, and had no way to see that it was queued (fix list).
 */
export type SubmissionKind = "story" | "video" | "event" | "machine" | "profile";

/** Every status a member's own content can be in, across all four tables. */
export type SubmissionStatus =
  | "awaiting_approval"
  | "rejected"
  | "published"
  | "draft"
  | "scheduled"
  | "withdrawn";

/** One row of a member's own content, across all four content types (A4.17). */
export type PendingSubmission = {
  id: string;
  kind: SubmissionKind;
  title: string;
  status: SubmissionStatus;
  rejected_reason: string | null;
  created_at: string;
  editHref: string;
  /** The live page, once there is one. Equipment has none — /featured-machine is a single page. */
  publicHref: string | null;
  /** The member's own unsubmitted story draft (Jas 13/10): editable, deletable, never withdrawn. */
  memberDraft?: boolean;
  /** The story as it will publish (/preview/story/[id]), while it's unpublished and the member's to see. */
  previewHref?: string;
  /**
   * A published story that features this member alongside its primary (Jas
   * 13/10 item 12). It's in their library, but it isn't theirs: read-only —
   * no edit, withdraw or change request (the primary member owns those).
   */
  featured?: boolean;
};

const PENDING_STATUSES = ["awaiting_approval", "rejected"] as const;
const EDIT_HREF: Record<SubmissionKind, (id: string) => string> = {
  story: (id) => `/dashboard/story/${id}/edit`,
  video: (id) => `/dashboard/video/${id}/edit`,
  event: (id) => `/dashboard/event/${id}/edit`,
  machine: (id) => `/dashboard/equipment/${id}/edit`,
  // A revision has no editor of its own — the page it changes *is* the editor,
  // and re-submitting there replaces the pending revision.
  profile: () => "/dashboard/profile",
};

/**
 * A member's story publishes under /news — it is news on the public site, the
 * `is_member_news` flag only badges it. Equipment has no page of its own.
 */
const PUBLIC_HREF: Record<SubmissionKind, (slug: string) => string | null> = {
  story: (slug) => `/news/${slug}`,
  video: (slug) => `/video/${slug}`,
  event: (slug) => `/event/${slug}`,
  machine: () => null,
  // Once applied, the change is simply live on the member's own page.
  profile: (slug) => `/member/${slug}`,
};

/**
 * A member's own content, merged across stories, videos, events and equipment,
 * newest first. `total` is the real count across all four tables even when
 * `limit` trims the list, so a badge can show the true number while the
 * dashboard box shows only the most recent few (fix list item 34).
 *
 * `statuses` defaults to the pre-approval pair, which is what the dashboard box
 * wants. Passing a wider set is how /dashboard/submissions shows published work
 * too — before that, a member had no way to see their own content again once it
 * went live (fix list).
 */
export async function memberContent(
  memberId: string,
  opts: { limit?: number; statuses?: readonly SubmissionStatus[] } = {},
): Promise<{ items: PendingSubmission[]; total: number }> {
  const db = serviceDb();
  const statuses = opts.statuses ?? PENDING_STATUSES;
  const cols = "id, slug, title, status, rejected_reason, created_at";
  // Each table is capped at `limit` too: the newest N overall can only come
  // from the newest N of each type, so nothing is lost by trimming per table.
  const capped = <Q extends { limit: (n: number) => Q }>(q: Q) => (opts.limit != null ? q.limit(opts.limit) : q);

  type Raw = { id: string; slug?: string | null; title: string; status: string; rejected_reason: string | null; created_at: string; member_draft?: boolean; source?: string };
  const wantsFeatured = statuses.includes("published");
  const [stories, videos, events, machines, revisions, memberRow, featured] = await Promise.all([
    // A story in `draft` is only the member's when they saved it (member_draft).
    // An admin's draft that merely names them is the desk's unfinished work —
    // it was listed here before, with an Edit link the server then refused.
    // Likewise a desk-written story waiting on, or sent back from, a decision:
    // the desk's work stays the desk's until it's published (lib/member-content,
    // and the member_read_own_stories policy in 20261016000020).
    capped(db.from("stories").select(`${cols}, member_draft, source`, { count: "exact" }).eq("member_id", memberId).in("status", statuses).or("status.neq.draft,member_draft.eq.true").or("source.eq.member,status.eq.published,member_draft.eq.true").order("created_at", { ascending: false })),
    capped(db.from("videos").select(cols, { count: "exact" }).eq("member_id", memberId).in("status", statuses).order("created_at", { ascending: false })),
    capped(db.from("events").select(cols, { count: "exact" }).eq("member_id", memberId).in("status", statuses).order("created_at", { ascending: false })),
    // featured_machines has no slug column — it has no page of its own to link to.
    capped(db.from("featured_machines").select("id, name, status, rejected_reason, created_at", { count: "exact" }).eq("member_id", memberId).in("status", statuses).order("created_at", { ascending: false })),
    // Page edits queue for the same approval as content, so they belong in the
    // same list (fix list). member_revisions shares the status vocabulary but
    // has no title or slug of its own — both come from the member.
    capped(db.from("member_revisions").select("id, status, rejected_reason, created_at", { count: "exact" }).eq("member_id", memberId).in("status", statuses).order("created_at", { ascending: false })),
    db.from("members").select("slug, status, archived_at").eq("id", memberId).maybeSingle(),
    // Published stories featuring this member where someone else is primary.
    wantsFeatured
      ? capped(
          db.from("stories").select(`${cols}, story_members!inner(member_id)`, { count: "exact" })
            .eq("story_members.member_id", memberId)
            .eq("status", "published")
            .or(`member_id.is.null,member_id.neq.${memberId}`)
            .order("created_at", { ascending: false }),
        )
      : Promise.resolve({ data: [] as Raw[], count: 0 }),
  ]);
  // Only a publicly visible member has a page for an applied revision to link
  // to — memberBySlug serves `active` and `grace` and skips archived members,
  // so anyone else's slug would point at a 404. Null here becomes "no link" at
  // `publicHref`. The rule lives in lib/member-visibility.ts; this is serviceDb,
  // so both columns have to be selected for it to have anything to judge.
  const memberSlug = isMemberLinkable(memberRow.data) ? memberRow.data.slug : null;

  const rows = (kind: SubmissionKind, data: Raw[] | null): PendingSubmission[] =>
    (data ?? []).map((r) => ({
      id: r.id, kind, title: r.title, status: r.status as SubmissionStatus,
      rejected_reason: r.rejected_reason, created_at: r.created_at, editHref: EDIT_HREF[kind](r.id),
      // Only a published row has a live page; a draft slug points at a 404.
      publicHref: r.status === "published" && r.slug ? PUBLIC_HREF[kind](r.slug) : null,
      ...(r.member_draft ? { memberDraft: true } : {}),
      ...(kind === "story" && r.source && ownerMayPreview({ status: r.status, source: r.source, member_draft: r.member_draft ?? false })
        ? { previewHref: `/preview/story/${r.id}` }
        : {}),
    }));

  const items = [
    ...rows("story", stories.data),
    ...rows("story", featured.data as Raw[] | null).map((r) => ({ ...r, featured: true })),
    ...rows("video", videos.data),
    ...rows("event", events.data),
    ...rows("machine", (machines.data ?? []).map(({ name, ...m }) => ({ ...m, title: name }))),
    ...rows("profile", (revisions.data ?? []).map((r) => ({ ...r, title: "Changes to your company page", slug: memberSlug }))),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));

  const total = (stories.count ?? 0) + (videos.count ?? 0) + (events.count ?? 0) + (machines.count ?? 0) + (revisions.count ?? 0) + (featured.count ?? 0);
  return { items: opts.limit != null ? items.slice(0, opts.limit) : items, total };
}

/** Everything still waiting on the editor — the dashboard home's box. */
export const pendingSubmissions = (memberId: string, opts: { limit?: number } = {}) =>
  memberContent(memberId, { ...opts, statuses: PENDING_STATUSES });

/** Tab definitions for /dashboard/submissions, and the statuses each one queries. */
export const CONTENT_FILTERS = {
  all: ["awaiting_approval", "rejected", "published", "draft", "scheduled", "withdrawn"],
  drafts: ["draft"],
  pending: ["awaiting_approval"],
  published: ["published", "scheduled"],
  attention: ["rejected", "withdrawn"],
} as const satisfies Record<string, readonly SubmissionStatus[]>;

export type ContentFilter = keyof typeof CONTENT_FILTERS;

export const isContentFilter = (v: string): v is ContentFilter => v in CONTENT_FILTERS;

/**
 * Submission intake: the one place a Story, Video or Event is saved from a
 * form — a member's submit and resubmit, and the console's save. Reading the
 * form, the upload, the slug, the sanitised body, the write (and the cleanup
 * when it fails), the map pin and the console notification all happen here;
 * the dashboard and console actions keep auth, redirect and revalidate only
 * (GLOSSARY.md: Submission intake, Resubmit).
 *
 * Status changes after that — approve, send back, publish, withdraw — are the
 * content lifecycle's (lib/content-lifecycle).
 *
 * No Next.js imports: callers pass `{ db, upload, geocode, notify }`
 * (lib/content-intake-deps builds the real ones), so this unit-tests directly.
 *
 * One parser per kind reads both editors' forms, like `parseCompanyPage`. The
 * admin-only fields (member, industry, social post fields, tagged members, SMI's
 * post links) are read only for the console, so a crafted member post can't
 * set them.
 */
import { LIFECYCLE_MESSAGES, type CountedUpdate } from "@/lib/content-lifecycle";
import type { serviceDb } from "@/lib/db/server";
import { isEventType } from "@/lib/event-types";
import { MEMBER_CHANGED_ERROR, memberCanEdit } from "@/lib/member-content";
import { resolveCoordinates, type Geocoder } from "@/lib/member-geocode";
import { sanitizeRichText } from "@/lib/sanitize";
import { keepUntouchedPosts, parseStoryPosts } from "@/lib/social";
import { channelSkipsFromForm, queueSocialPush, socialFieldsFromForm } from "@/lib/social-push";
import type { JobKind } from "@/lib/jobs";
import { saveChannelSkips } from "@/lib/social-post";
import { isMemberDraft } from "@/lib/story-board";
import { replaceStoryMembers, resolveStoryMembers } from "@/lib/story-members";
import { YOUTUBE_ONLY_ERROR, youtubeId } from "@/lib/youtube";

/* ---------- contract ---------- */

type Db = ReturnType<typeof serviceDb>;

export type IntakeKind = "story" | "video" | "event";

/** Where the image a form carries is stored, and removed again when nothing points at it. */
export type IntakeUploads = {
  /**
   * The image in the form's `field`, stored under `folder`. `{ path: null }`
   * when the form sent none; `{ error }` (already safe to show) when it was
   * refused or the store failed — `failure` names the log area and fallback line.
   */
  store(form: FormData, field: string, folder: string, failure: { area: string; fallback?: string }): Promise<{ path: string | null } | { error: string }>;
  /** Remove an upload nothing points at yet (a write that failed). */
  remove(path: string | null): Promise<void>;
  /** Remove replaced images, each only if nothing else shows it now. */
  removeIfUnused(paths: readonly (string | null)[]): Promise<void>;
};

export type SubmittedNotice = {
  kind: "story_submitted" | "video_submitted" | "event_submitted";
  memberId: string;
  payload: Partial<Record<"story_id" | "video_id" | "event_id", string>>;
  message: string;
};

export type IntakeDeps = {
  db: Db;
  upload: IntakeUploads;
  geocode: Geocoder;
  /** The console notification for a member's submission. Must not throw. */
  notify: (n: SubmittedNotice) => Promise<void>;
  /** Record a failure the caller isn't told about because the save itself landed. Must not throw. */
  log: (area: string, error: unknown, context?: Record<string, unknown>) => void;
  /** The job queue (lib/jobs enqueue): a save can move or queue the item's social post. */
  enqueue: (kind: JobKind, payload?: Record<string, unknown>, dueAt?: Date) => Promise<void>;
};

export type IntakeMember = { userId: string; memberId: string };
export type IntakeAdmin = { userId: string };

/**
 * Why a save was refused. `invalid` and `upload` go back to the form, `failed`
 * too (the database said no), `changed` and `not_found` mean the item is no
 * longer the member's to change, and `partial` (console story only) means it
 * saved but its tagged members didn't. Branch on the code, never the message.
 */
export type IntakeCode = "invalid" | "upload" | "not_found" | "changed" | "failed" | "partial";
export type IntakeRefusal = { ok: false; code: IntakeCode; error: string; id?: string };
/** `draft`: the story was kept as the member's private draft, so nobody was told. */
export type SubmitResult = { ok: true; id: string; draft: boolean } | IntakeRefusal;
export type SaveResult = { ok: true; id: string } | IntakeRefusal;

/** Every message a caller can be shown. Tests assert against these, not literal strings. */
export const INTAKE_MESSAGES = {
  story: {
    titleRequired: "Give the story a title before saving.",
    // The draft button skips native validation, so the title rule is said here.
    draftTitleRequired: "Give the story a title to save it as a draft.",
    coverRequired: "A cover image is required.",
    coverFailed: "The cover didn't upload — please try again.",
    notAvailable: "That story isn't available to edit.",
    membersFailed: "The story saved, but its tagged members couldn't be updated — they're as they were. Save again to retry.",
  },
  video: {
    // D6: one wording for both editors.
    required: "A title and a YouTube link are both required.",
    thumbnailFailed: "The thumbnail didn't upload — please try again.",
  },
  event: {
    required: "A title and a start date are both required.",
    coverFailed: "The cover didn't upload — please try again.",
  },
  // The lifecycle's wording, so a missing item reads the same whichever button found it.
  notFound: LIFECYCLE_MESSAGES.notFound,
  submitFailed: "That didn't save — please try again in a moment. If it keeps happening, contact us.",
  resubmitFailed: "Your changes couldn't be saved just now — please try again.",
  saveFailed: (kind: IntakeKind) => `The ${kind} couldn't be saved — try again.`,
} as const;

/** The content slug: the title, URL-safe, 80 characters at most. (Member slugs are a different rule — lib/membership.) */
export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

const contentSlug = (title: string) => `${slugify(title)}-${Date.now().toString(36)}`;

/* ---------- per-kind parsers (private) ---------- */

type Mode = "member" | "admin";
type Values = Record<string, unknown>;
/**
 * `categories` (console) is undefined when the form carried no category box,
 * so a form without one leaves them alone; an empty list means "none" and
 * clears them.
 */
type Parsed = { values: Values; title: string; asDraft?: boolean; category?: number; categories?: number[]; tagged?: string[]; posts?: Values };
type ParseResult = Parsed | { error: string };

const text = (form: FormData, key: string) => String(form.get(key) ?? "");
const orNull = (form: FormData, key: string) => text(form, key) || null;
const invalid = (error: string): IntakeRefusal => ({ ok: false, code: "invalid", error });

/** The console's member and industry boxes. */
function adminOwnership(form: FormData): Values {
  return { member_id: orNull(form, "member_id"), industry_id: Number(form.get("industry_id")) || null };
}

/** The console's social post time, lead-in and opt-out (Area 3) — absent from a form that doesn't carry them. */
function adminSocial(form: FormData): Values | { error: string } {
  const social = socialFieldsFromForm(form);
  if ("error" in social) return { error: social.error };
  return social.value ?? {};
}

function parseStory(form: FormData, mode: Mode, opts: { draftAllowed: boolean }): ParseResult {
  const title = text(form, "title").trim();
  const asDraft = mode === "member" && opts.draftAllowed && form.get("intent") === "draft";
  if (!title) {
    if (mode === "admin") return { error: INTAKE_MESSAGES.story.titleRequired };
    return { error: asDraft ? INTAKE_MESSAGES.story.draftTitleRequired : INTAKE_MESSAGES.story.titleRequired };
  }
  const values: Values = {
    title,
    excerpt: text(form, "excerpt"),
    body: sanitizeRichText(text(form, "body")),
  };
  if (form.get("focus_x")) {
    values.cover_focus = { x: Number(form.get("focus_x")), y: Number(form.get("focus_y")), scale: Number(form.get("focus_scale") || 1) };
  }
  if (mode === "member") {
    return { values, title, asDraft, category: Number(form.get("category") || 0) || undefined };
  }

  // Every member the story features (Jas 13/10 item 12): subject first.
  const ownership = adminOwnership(form);
  const tagged = resolveStoryMembers(ownership.member_id as string | null, form.getAll("tagged_member_ids").map(String));
  if ("error" in tagged) return { error: tagged.error };
  // SMI's own posts of the story (Jas 13/10 item 8).
  const posts = parseStoryPosts((network) => text(form, `post_${network}`));
  if ("error" in posts) return { error: posts.error };
  const social = adminSocial(form);
  if ("error" in social) return { error: social.error as string };
  return {
    values: { ...values, ...ownership, is_member_news: form.get("is_member_news") === "on", ...social },
    title,
    tagged: tagged.ids,
    posts: posts.value,
    // Unticked boxes send nothing, so the editor marks that its box was there.
    categories: form.has("categories_sent") || form.has("categories")
      ? form.getAll("categories").map(Number).filter(Boolean)
      : undefined,
  };
}

function parseVideo(form: FormData, mode: Mode): ParseResult {
  const title = text(form, "title").trim();
  const url = text(form, "url").trim();
  if (!title || !url) return { error: INTAKE_MESSAGES.video.required };
  // YouTube only (USE-CASES gap 23): anything else would publish as a card with no player.
  if (!youtubeId(url)) return { error: YOUTUBE_ONLY_ERROR };
  const values: Values = { title, url, description: sanitizeRichText(text(form, "description")) };
  if (mode === "member") return { values, title };
  const social = adminSocial(form);
  if ("error" in social) return { error: social.error as string };
  return { values: { ...values, ...adminOwnership(form), ...social }, title };
}

function parseEvent(form: FormData, mode: Mode): ParseResult {
  const title = text(form, "title").trim();
  const startsOn = text(form, "starts_on");
  // D6: the member form required a start date only in the browser.
  if (!title || !startsOn) return { error: INTAKE_MESSAGES.event.required };
  const type = text(form, "type");
  const values: Values = {
    title,
    description: sanitizeRichText(text(form, "description")),
    location: orNull(form, "location"),
    starts_on: startsOn,
    starts_time: orNull(form, "starts_time"),
    ends_on: orNull(form, "ends_on"),
    link: orNull(form, "link"),
    type: isEventType(type) ? type : null,
  };
  if (mode === "member") return { values, title };
  return { values: { ...values, ...adminOwnership(form) }, title };
}

/* ---------- per-kind policy (private) ---------- */

type Policy = {
  table: "stories" | "videos" | "events";
  /** The form field and storage folder of the kind's one image, and the column it lands in. */
  image: { field: string; folder: string; column: string; memberArea: string; memberFallback: string };
  /** The console's source for what it creates. */
  adminSource: string;
  /** Columns the member resubmit reads. */
  memberCols: string;
  /** Columns the console save reads from an existing row: the image it may replace, and what else the save keeps. */
  adminCols: string;
};

const POLICY: Record<IntakeKind, Policy> = {
  story: {
    table: "stories",
    image: { field: "cover", folder: "stories", column: "cover_path", memberArea: "upload:story-cover", memberFallback: INTAKE_MESSAGES.story.coverFailed },
    adminSource: "admin",
    memberCols: "id, status, member_id, member_draft, source, cover_path, updated_at",
    adminCols: "id, cover_path, member_draft, social_posts",
  },
  video: {
    table: "videos",
    image: { field: "thumbnail", folder: "videos", column: "thumbnail_path", memberArea: "upload:video-thumbnail", memberFallback: INTAKE_MESSAGES.video.thumbnailFailed },
    adminSource: "manual",
    memberCols: "id, status, member_id, source, thumbnail_path, updated_at",
    adminCols: "id, thumbnail_path",
  },
  event: {
    table: "events",
    image: { field: "cover", folder: "events", column: "cover_path", memberArea: "upload:event-cover", memberFallback: INTAKE_MESSAGES.event.coverFailed },
    adminSource: "admin",
    memberCols: "id, status, member_id, source, cover_path, updated_at, location, lat, lng",
    adminCols: "id, cover_path, location, lat, lng",
  },
};

function parse(kind: IntakeKind, form: FormData, mode: Mode, opts: { draftAllowed: boolean } = { draftAllowed: true }): ParseResult {
  if (kind === "story") return parseStory(form, mode, opts);
  if (kind === "video") return parseVideo(form, mode);
  return parseEvent(form, mode);
}

/**
 * The tables' Insert/Update types differ, and a union of them collapses the
 * payload to never — so writes go through this narrow shape, which is exactly
 * the chain the module uses. Every update counts its rows (CountedUpdate, from
 * lib/content-lifecycle), so a write that matched nothing is never a success.
 */
type ContentTable = {
  select(cols: string): { eq(col: "id", v: string): { maybeSingle(): PromiseLike<{ data: Values | null }> } };
  insert(values: Values): { select(cols: "id"): { single(): PromiseLike<{ data: { id: string } | null; error: { message: string } | null }> } };
  update(values: Values): CountedUpdate;
};
const tableOf = (d: IntakeDeps, kind: IntakeKind) => d.db.from(POLICY[kind].table) as unknown as ContentTable;

async function storeImage(d: IntakeDeps, kind: IntakeKind, form: FormData, mode: Mode, adminArea: string) {
  const img = POLICY[kind].image;
  const failure = mode === "member" ? { area: img.memberArea, fallback: img.memberFallback } : { area: adminArea };
  return d.upload.store(form, img.field, img.folder, failure);
}

/**
 * The event's map pin: geocode only a changed location, keep the old pin on
 * failure (resolveCoordinates). No location means no pin — resolveCoordinates
 * would keep the old one, which left a cleared event pinned where it was.
 */
async function withCoordinates(d: IntakeDeps, kind: IntakeKind, values: Values, existing: Values | null): Promise<Values> {
  if (kind !== "event") return values;
  if (!String(values.location ?? "").trim()) return { ...values, lat: null, lng: null };
  const coords = await resolveCoordinates(
    { lat: null, lng: null },
    {
      address: (existing?.location as string | null) ?? null,
      lat: (existing?.lat as number | null) ?? null,
      lng: (existing?.lng as number | null) ?? null,
    },
    String(values.location ?? ""),
    d.geocode,
  );
  return { ...values, ...coords };
}

const submittedMessage = (kind: IntakeKind, title: string) => `Submitted ${kind === "event" ? "an" : "a"} ${kind} for approval: “${title}”.`;
const resubmittedMessage = (kind: IntakeKind, title: string) => `Resubmitted their ${kind} “${title}” after changes.`;

async function notifySubmitted(d: IntakeDeps, kind: IntakeKind, memberId: string, id: string, message: string) {
  await d.notify({ kind: `${kind}_submitted`, memberId, payload: { [`${kind}_id`]: id }, message });
}

/* ---------- operations ---------- */

/**
 * A member's new Story, Video or Event: awaiting approval (or, a story, their
 * private draft), never live. Members never pick an industry; Jas tags it.
 */
export async function submit(d: IntakeDeps, kind: IntakeKind, form: FormData, member: IntakeMember): Promise<SubmitResult> {
  const parsed = parse(kind, form, "member");
  if ("error" in parsed) return invalid(parsed.error);
  const asDraft = Boolean(parsed.asDraft);

  const stored = await storeImage(d, kind, form, "member", "");
  if ("error" in stored) return { ok: false, code: "upload", error: stored.error };
  const image = stored.path;
  // A cover is mandatory for a story going to the editor; a draft needn't have one yet.
  if (kind === "story" && !image && !asDraft) return invalid(INTAKE_MESSAGES.story.coverRequired);

  const values = await withCoordinates(d, kind, parsed.values, null);
  const { data, error } = await tableOf(d, kind).insert({
    ...values,
    slug: contentSlug(parsed.title),
    status: asDraft ? "draft" : "awaiting_approval",
    ...(kind === "story" ? { member_draft: asDraft, is_member_news: true } : {}),
    source: "member",
    member_id: member.memberId,
    submitted_by: member.userId,
    industry_id: null,
    [POLICY[kind].image.column]: image,
  }).select("id").single();
  if (error || !data) {
    await d.upload.remove(image);
    return { ok: false, code: "failed", error: INTAKE_MESSAGES.submitFailed };
  }

  if (kind === "story") {
    if (parsed.category) await d.db.from("story_categories").insert({ story_id: data.id, category_id: parsed.category });
    // story_members holds every member a story features, the primary included
    // (migration 20261015000003) — a member's own story features them.
    try {
      await replaceStoryMembers(d.db, data.id, [member.memberId]);
    } catch (e) {
      // The story is saved, so the member is told it went in and the console
      // still hears about it. The row's member_id still names them; the next
      // console save rewrites story_members.
      d.log("intake:story-members", e, { story_id: data.id });
    }
  }
  if (!asDraft) await notifySubmitted(d, kind, member.memberId, data.id, submittedMessage(kind, parsed.title));
  return { ok: true, id: data.id, draft: asDraft };
}

/**
 * A member's edit of their own item that is waiting on a decision or was sent
 * back (or, a story, their draft): it goes back to Ready to review, or stays a
 * draft when saved as one.
 *
 * Optimistic concurrency, because the form can be open for hours: the edit
 * page posts the `updated_at` it was rendered from as `version`, and the write
 * lands only if the row is still at that version, in the status (and draft
 * state) read here, and still the member's. Otherwise the desk acted in
 * between — approved it, edited it, sent it back — and the member is told
 * instead and nothing is saved. A form from before `version` existed still
 * gets the status check.
 */
export async function resubmit(d: IntakeDeps, kind: IntakeKind, id: string, form: FormData, member: IntakeMember): Promise<SubmitResult> {
  const p = POLICY[kind];
  const { data: row } = await tableOf(d, kind).select(p.memberCols).eq("id", id).maybeSingle();
  const access = row as { member_id: string | null; status: string; member_draft?: boolean | null; source?: string | null } | null;
  const changed: IntakeRefusal = { ok: false, code: "changed", error: MEMBER_CHANGED_ERROR[kind] };
  if (!access || !memberCanEdit(kind, access, member.memberId)) {
    // Theirs, but no longer in an editable state: say so. Anyone else's: nothing to say.
    const theirs = access?.member_id === member.memberId && access.source === "member";
    return theirs ? changed : { ok: false, code: "not_found", error: INTAKE_MESSAGES.notFound(kind) };
  }
  const current = row!;
  const openedAt = text(form, "version");
  if (openedAt && openedAt !== current.updated_at) return changed;

  const wasDraft = kind === "story" && isMemberDraft(access);
  // "Save draft" only means something for a draft: a submitted story can't be
  // pulled back into the member's private workspace this way.
  const parsed = parse(kind, form, "member", { draftAllowed: wasDraft });
  if ("error" in parsed) return invalid(parsed.error);
  const asDraft = Boolean(parsed.asDraft);

  const stored = await storeImage(d, kind, form, "member", "");
  if ("error" in stored) return { ok: false, code: "upload", error: stored.error };
  const image = stored.path;
  const previousImage = (current[p.image.column] as string | null | undefined) ?? null;
  // Fine to keep the existing cover; a story with neither can't be submitted.
  if (kind === "story" && !image && !asDraft && !previousImage) return invalid(INTAKE_MESSAGES.story.coverRequired);

  const values = await withCoordinates(d, kind, parsed.values, current);
  let write = tableOf(d, kind).update({
    ...values,
    status: asDraft ? "draft" : "awaiting_approval",
    ...(kind === "story" ? { member_draft: asDraft } : {}),
    // industry_id deliberately absent: it is Jas's to set, so a member edit keeps it.
    // Cleared so the member is not still shown last time's reason once they act on it.
    rejected_reason: null,
    updated_at: new Date().toISOString(),
    ...(image ? { [p.image.column]: image } : {}),
  })
    .eq("id", id).eq("member_id", member.memberId).eq("source", "member")
    .eq("status", current.status as string).eq("updated_at", current.updated_at as string);
  if (kind === "story") write = write.eq("member_draft", Boolean(current.member_draft));
  const { data: saved, error } = await write.select("id");
  if (error || !saved?.length) {
    // Nothing points at the image this request uploaded.
    await d.upload.remove(image);
    return error ? { ok: false, code: "failed", error: INTAKE_MESSAGES.resubmitFailed } : changed;
  }

  // The image it replaced, unless something else still shows it (the media
  // library lets the desk reuse any upload).
  if (image && previousImage && previousImage !== image) await d.upload.removeIfUnused([previousImage]);
  if (kind === "story") {
    if (parsed.category) {
      await d.db.from("story_categories").delete().eq("story_id", id);
      await d.db.from("story_categories").insert({ story_id: id, category_id: parsed.category });
    }
  }
  if (!asDraft) {
    const message = wasDraft ? submittedMessage(kind, parsed.title) : resubmittedMessage(kind, parsed.title);
    await notifySubmitted(d, kind, member.memberId, id, message);
  }
  return { ok: true, id, draft: asDraft };
}

/**
 * The console's save of a Story, Video or Event: `id` null creates a desk
 * draft. Owns the console-only extras too: a waiting social post moves to the
 * edited time, a story's tagged members, categories, and SMI's post links (a
 * link the editor didn't touch keeps what Buffer filled in since).
 *
 * A failed write removes the image this save uploaded and says so (D11). The
 * item's existence is checked before the upload, so a stale id — or a
 * member's private story draft, which is theirs — leaves no orphaned image;
 * the update counts its rows too, for an item deleted in between. A replaced
 * image is removed only if nothing else shows it (the media library lets the
 * desk reuse any upload).
 */
export async function save(d: IntakeDeps, kind: IntakeKind, id: string | null, form: FormData, admin: IntakeAdmin): Promise<SaveResult> {
  const p = POLICY[kind];
  const parsed = parse(kind, form, "admin");
  if ("error" in parsed) return invalid(parsed.error);
  let values: Values = { ...parsed.values };

  const notFound: IntakeRefusal = {
    ok: false, code: "not_found", error: kind === "story" ? INTAKE_MESSAGES.story.notAvailable : INTAKE_MESSAGES.notFound(kind),
  };
  let previous: Values | null = null;
  if (id) {
    previous = (await tableOf(d, kind).select(p.adminCols).eq("id", id).maybeSingle()).data;
    if (!previous || (kind === "story" && isMemberDraft(previous))) return notFound;
  }
  if (kind === "story") {
    values.social_posts = previous
      ? keepUntouchedPosts(parsed.posts ?? {}, previous.social_posts, (n) => form.get(`post_${n}_was`))
      : parsed.posts;
  }

  const stored = await storeImage(d, kind, form, "admin", `action:save${kind[0].toUpperCase()}${kind.slice(1)}`);
  if ("error" in stored) return { ok: false, code: "upload", error: stored.error };
  const image = stored.path;

  values = await withCoordinates(d, kind, values, previous);
  values = { ...values, updated_at: new Date().toISOString(), ...(image ? { [p.image.column]: image } : {}) };

  let savedId: string;
  if (id) {
    const { data: saved, error } = await tableOf(d, kind).update(values).eq("id", id).select("id");
    if (error || !saved?.length) {
      await d.upload.remove(image);
      return error ? { ok: false, code: "failed", error: INTAKE_MESSAGES.saveFailed(kind) } : notFound;
    }
    savedId = id;
    const previousImage = (previous?.[p.image.column] as string | null | undefined) ?? null;
    if (image && previousImage && previousImage !== image) await d.upload.removeIfUnused([previousImage]);
    // Issue #43: the per-channel "Don't post" boxes, then the pending push
    // brought in line — moved, dropped, or queued for a channel an admin has
    // already confirmed. An item nobody confirmed is never queued here.
    if (kind !== "event") {
      const target = kind === "story" ? { story_id: id } : { video_id: id };
      const skips = channelSkipsFromForm(form);
      if (skips) await saveChannelSkips(d.db, target, skips);
      await queueSocialPush(d.db, target, d.enqueue);
    }
  } else {
    const { data, error } = await tableOf(d, kind).insert({
      ...values,
      slug: contentSlug(parsed.title),
      status: "draft",
      source: p.adminSource,
      submitted_by: admin.userId,
    }).select("id").single();
    if (error || !data) {
      await d.upload.remove(image);
      return { ok: false, code: "failed", error: INTAKE_MESSAGES.saveFailed(kind) };
    }
    savedId = data.id;
  }

  if (kind === "story") {
    // Categories first, so a failed retag below leaves only the members
    // unsaved — which is all its message says. An empty list clears them.
    if (parsed.categories) {
      await d.db.from("story_categories").delete().eq("story_id", savedId);
      if (parsed.categories.length) {
        await d.db.from("story_categories").insert(parsed.categories.map((category_id) => ({ story_id: savedId, category_id })));
      }
    }
    // One transaction (replace_story_members): if it fails the story keeps the
    // members it had, so say so rather than throwing to the error page.
    try {
      await replaceStoryMembers(d.db, savedId, parsed.tagged ?? []);
    } catch {
      return { ok: false, code: "partial", error: INTAKE_MESSAGES.story.membersFailed, id: savedId };
    }
  }
  return { ok: true, id: savedId };
}

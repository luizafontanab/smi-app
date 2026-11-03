"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requireMember, requireMemberView } from "@/lib/auth";
import { geocodeAddress } from "@/lib/adapters/geocode";
import { getLeadGenSource } from "@/lib/adapters/leadgen";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { serviceDb, sessionDb } from "@/lib/db/server";
import { isEventType } from "@/lib/event-types";
import { editorImageUpload, uploadFailureMessage } from "@/lib/editor-upload";
import type { UploadResult } from "@/lib/upload-limits";
import { removeMedia, removeMediaIfUnused, uploadImage } from "@/lib/media";
import { memberUploads, submittedFile } from "@/lib/staged-upload";
import { canRenewBooking, renewalDatesProblem } from "@/lib/advert-renewal";
import { ownCompanyPageValuesFromForm } from "@/lib/member-form";
import { resolveCoordinates } from "@/lib/member-geocode";
import {
  membershipTypeIdsFromForm,
  membershipTypesError,
  replaceMemberMembershipTypes,
  replaceMemberServices,
} from "@/lib/member-services";
import { renderableHtml, sanitizeRichText } from "@/lib/sanitize";
import { companyLinksFor, withCompanyLines } from "@/lib/company-link";
import { isMemberLinkable } from "@/lib/member-visibility";
import {
  memberCanDeleteStory,
  memberCanEditStory,
  memberCanWithdrawStory,
  memberStoryImagePaths,
  STORY_CHANGED_ERROR,
} from "@/lib/member-story";
import { isMemberDraft } from "@/lib/story-board";
import { replaceStoryMembers } from "@/lib/story-members";
import { HOUR, withinLimit } from "@/lib/rate-limit";
import { advertLinkFromForm } from "@/lib/advert-link";
import { logError } from "@/lib/log";
import { siteUrl } from "@/lib/site-url";
import { EMAIL_RE } from "@/lib/validate";
import { loadFeaturedMonths } from "@/lib/featured-availability";
import { optionalYoutubeUrl, YOUTUBE_ONLY_ERROR, youtubeId } from "@/lib/youtube";

/** Shown when a save fails for a reason that isn't the member's to fix; the detail goes to the error log. */
const SAVE_FAILED = "That didn't save — please try again in a moment. If it keeps happening, contact us.";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/**
 * Tell the console a member has put something in front of Jas (fix-list 71).
 *
 * Until now nothing here did. A member could submit a story, a video, an event,
 * equipment, an advert run or an artwork swap and the only trace in the console
 * was the aggregate "Needs you today" counter on the overview — which links to a
 * list page and never to the item. These notifications carry the row's id, so
 * the notifications feed links straight to the thing that needs deciding.
 *
 * Every submission route calls this, resubmits included: a sent-back item that
 * comes back edited is back in the queue and needs the same nudge as a new one.
 *
 * Cannot throw: `notifyConsole` swallows its own failures. That is the point —
 * the submission is already saved by the time this runs, so losing the receipt
 * must never cost the member their work.
 */
async function notifySubmitted(
  kind: import("@/lib/console-notification-links").InboxNotificationKind,
  memberId: string,
  payload: import("@/lib/console-notification-links").InboxPayload,
  message: string,
): Promise<void> {
  const { notifyConsole } = await import("@/lib/notify-admin");
  await notifyConsole({ kind, memberId, payload, message });
}

// Stories are not here: who may change one depends on who wrote it as well as
// its status, so they go through lib/member-story instead.
type EditableTable = "videos" | "events" | "featured_machines";
const EDITABLE_STATUSES = ["awaiting_approval", "rejected"];

/**
 * These member-area actions use the service role, which bypasses RLS, so
 * ownership has to be checked by hand before every read or write. The four
 * helpers below are the single place that happens, so a new action can't
 * forget the check the way a one-off inline comparison could.
 */

/** True when `id` in `table` belongs to this member and is still in a state they're allowed to touch — never something already live. */
async function assertOwnsRow(db: ReturnType<typeof serviceDb>, table: EditableTable, id: string, memberId: string): Promise<boolean> {
  const { data } = await db.from(table).select("id, status, member_id").eq("id", id).single();
  return Boolean(data && data.member_id === memberId && EDITABLE_STATUSES.includes(data.status));
}

/** True when the `adverts` row `id` belongs to this member. */
async function assertOwnsAdvert(db: ReturnType<typeof serviceDb>, id: string, memberId: string): Promise<boolean> {
  const { data } = await db.from("adverts").select("id, member_id").eq("id", id).single();
  return data?.member_id === memberId;
}

type OwnedBooking = { id: string; status: string; advert_id: string; price_pennies: number | null; starts_on: string; ends_on: string };

/** The `advert_bookings` row `id` if it belongs to this member (via its advert), else null. */
async function assertOwnsBooking(db: ReturnType<typeof serviceDb>, id: string, memberId: string): Promise<OwnedBooking | null> {
  const { data } = await db
    .from("advert_bookings")
    .select("id, status, advert_id, price_pennies, starts_on, ends_on, advert:adverts(member_id)")
    .eq("id", id)
    .single();
  if (!data || data.advert?.member_id !== memberId) return null;
  return {
    id: data.id, status: data.status, advert_id: data.advert_id, price_pennies: data.price_pennies,
    starts_on: data.starts_on, ends_on: data.ends_on,
  };
}

/** Where a member is sent when their story changed under them: their list, which shows its state now. */
function storyChanged(): never {
  redirect(`/dashboard/submissions?error=${encodeURIComponent(STORY_CHANGED_ERROR)}`);
}

/** True when the `prospect_marks` row `id` is this member's own — never an admin mark. */
async function assertOwnsMark(db: ReturnType<typeof serviceDb>, id: string, memberId: string): Promise<boolean> {
  const { data } = await db.from("prospect_marks").select("id, member_id").eq("id", id).single();
  return data?.member_id === memberId;
}

/** Editor image upload — returns { url } for insertion as <img src>, or { error } to show. */
export async function memberUploadImage(formData: FormData): Promise<UploadResult> {
  const user = await requireMember();
  return editorImageUpload(formData, memberUploads(user.memberId), `stories/${user.memberId}`);
}

/**
 * M3 — member self-post. "Submit for approval" lands it awaiting approval, never
 * live directly. "Save draft" (intent=draft, Jas 13/10) keeps it as the
 * member's private draft — no cover needed yet, nobody notified — and opens it
 * in the editor, where it can be previewed as published and submitted later.
 */
export async function submitStory(formData: FormData) {
  const user = await requireMember();
  const asDraft = formData.get("intent") === "draft";
  const title = String(formData.get("title") ?? "").trim();
  if (!title) {
    // The draft button skips native validation (a draft needn't have a cover
    // yet), so the title rule has to be said here rather than by the browser.
    if (asDraft) redirect(`/dashboard/story/new?error=${encodeURIComponent("Give the story a title to save it as a draft.")}`);
    return;
  }
  let cover: string | null = null;
  try {
    cover = await uploadImage(await submittedFile(formData, "cover", memberUploads(user.memberId)), "stories");
  } catch (e) {
    // Was an unhandled throw into the error boundary — an 8MB file lost the
    // whole draft. redirect() stays outside the try: its NEXT_REDIRECT must
    // not be caught as an upload failure.
    redirect(`/dashboard/story/new?error=${encodeURIComponent(uploadFailureMessage(e, "upload:story-cover", "The cover didn't upload — please try again."))}`);
  }
  if (!cover && !asDraft) redirect(`/dashboard/story/new?error=${encodeURIComponent("A cover image is required.")}`);
  const db = serviceDb();
  const { data } = await db.from("stories").insert({
    slug: `${slugify(title)}-${Date.now().toString(36)}`,
    title,
    excerpt: String(formData.get("excerpt") ?? ""),
    body: sanitizeRichText(String(formData.get("body") ?? "")),
    status: asDraft ? "draft" : "awaiting_approval",
    member_draft: asDraft,
    source: "member",
    is_member_news: true,
    member_id: user.memberId,
    submitted_by: user.userId,
    // Members never pick an industry; Jas tags it in the console.
    industry_id: null,
    cover_path: cover,
    ...(formData.get("focus_x")
      ? { cover_focus: { x: Number(formData.get("focus_x")), y: Number(formData.get("focus_y")), scale: Number(formData.get("focus_scale") || 1) } }
      : {}),
  }).select("id").single();
  const cat = Number(formData.get("category") || 0);
  if (cat && data) await db.from("story_categories").insert({ story_id: data.id, category_id: cat });
  // story_members holds every member a story features, the primary included
  // (migration 20261015000003) — a member's own story features them.
  if (data) await replaceStoryMembers(db, data.id, [user.memberId]);
  revalidatePath("/dashboard");
  if (asDraft) {
    revalidatePath("/dashboard/submissions");
    redirect(data ? `/dashboard/story/${data.id}/edit?saved=draft` : "/dashboard/submissions");
  }
  await notifySubmitted("story_submitted", user.memberId, { story_id: data?.id }, `Submitted a story for approval: “${title}”.`);
  redirect("/dashboard?submitted=story");
}

/**
 * The member's Preview tab (Jas 13/10 items 10/15): the body they are typing,
 * cleaned by the same sanitiser the published page uses, so what the preview
 * shows is what will publish — the tab used to inject the editor's raw HTML.
 * Server-side so sanitize-html stays out of the browser bundle.
 */
export async function previewStoryBody(html: string): Promise<string> {
  // Read-only, so an admin viewing as the member (fix-list 94) gets a faithful
  // preview too — the one member action allowed requireMemberView (view-as-wiring test).
  const user = await requireMemberView();
  // closes with the member's own name + website line, as the published page will
  const { data: member } = await serviceDb()
    .from("members").select("id, name, website, status, archived_at").eq("id", user.memberId).maybeSingle();
  const links = member && isMemberLinkable(member) ? companyLinksFor([member], member.id) : [];
  return withCompanyLines(renderableHtml(String(html ?? "").slice(0, 200_000)), links);
}

/**
 * Delete the member's own unsubmitted draft. Only a draft: anything already
 * submitted has been seen by the editor, so it is withdrawn instead and the
 * record stays.
 *
 * The delete is conditional on it still being their draft — submitted from
 * another tab since this page loaded, it is no longer theirs to delete — and
 * the images go with it: the cover, and every photo the body uploaded under
 * their own prefix, each only if nothing else now points at it.
 */
export async function deleteStoryDraft(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id") ?? "");
  const db = serviceDb();
  const { data: story } = await db.from("stories").select("id, status, member_id, member_draft, source").eq("id", id).single();
  if (!memberCanDeleteStory(story, user.memberId)) {
    // Theirs, but no longer a draft: say so. Anyone else's: nothing to say.
    if (story?.member_id === user.memberId && story.source === "member") storyChanged();
    return;
  }
  // member_draft implies status 'draft' and source 'member' (stories_member_draft_check).
  const { data: deleted, error } = await db.from("stories").delete()
    .eq("id", id).eq("member_id", user.memberId).eq("member_draft", true)
    .select("cover_path, body");
  if (error) {
    redirect(`/dashboard/story/${id}/edit?error=${encodeURIComponent("The draft couldn't be deleted just now — please try again.")}`);
  }
  if (!deleted?.length) storyChanged();
  await removeMediaIfUnused(deleted.flatMap((row) => [row.cover_path, ...memberStoryImagePaths(row.body, user.memberId)]));
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/submissions");
  redirect("/dashboard/submissions?deleted=draft");
}

/**
 * Pull back a story the member wrote that's still waiting on (or was sent back
 * from) a decision. Conditional on the status just read, so a story the desk
 * published or scheduled in between is left alone and the member told.
 */
export async function withdrawStory(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id"));
  const db = serviceDb();
  const { data: story } = await db.from("stories").select("id, status, member_id, member_draft, source").eq("id", id).single();
  if (!memberCanWithdrawStory(story, user.memberId)) {
    if (story?.member_id === user.memberId && story.source === "member") storyChanged();
    return;
  }
  const { data: withdrawn, error } = await db.from("stories").update({ status: "withdrawn" })
    .eq("id", id).eq("member_id", user.memberId).eq("source", "member").eq("member_draft", false).eq("status", story!.status)
    .select("id");
  if (error) {
    redirect(`/dashboard/submissions?error=${encodeURIComponent("The story couldn't be withdrawn just now — please try again.")}`);
  }
  if (!withdrawn?.length) storyChanged();
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/**
 * Edit and resubmit a story that's awaiting approval or was rejected — mirrors
 * resubmitAdvert. Also where a member's draft is saved again (intent=draft,
 * stays a draft) or finally submitted (moves to awaiting approval).
 *
 * Optimistic concurrency, because the form can be open for hours: the edit
 * page posts the `updated_at` it was rendered from as `version`, and the write
 * lands only if the row is still at that version, in the status and draft
 * state read here, still the member's. Otherwise the desk acted in between —
 * approved it, edited the copy, sent it back — and a resubmit would have
 * pulled a live story back into the queue or written over Jas's changes. The
 * member is told instead and nothing is saved. (A form from before `version`
 * existed still gets the status check.)
 */
export async function editStory(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id"));
  const db = serviceDb();
  const { data: row } = await db.from("stories")
    .select("id, status, member_id, member_draft, source, cover_path, updated_at").eq("id", id).single();
  if (!memberCanEditStory(row, user.memberId)) {
    if (row?.member_id === user.memberId && row.source === "member") storyChanged();
    return;
  }
  const story = row!;
  const openedAt = String(formData.get("version") ?? "");
  if (openedAt && openedAt !== story.updated_at) storyChanged();
  const wasDraft = isMemberDraft(story);
  // "Save draft" only means something for a draft: a submitted story can't be
  // pulled back into the member's private workspace this way.
  const asDraft = wasDraft && formData.get("intent") === "draft";
  const title = String(formData.get("title") ?? "").trim();
  if (!title) {
    if (asDraft) redirect(`/dashboard/story/${id}/edit?error=${encodeURIComponent("Give the story a title to save it as a draft.")}`);
    return;
  }
  let cover: string | null = null;
  try {
    cover = await uploadImage(await submittedFile(formData, "cover", memberUploads(user.memberId)), "stories");
  } catch (e) {
    redirect(`/dashboard/story/${id}/edit?error=${encodeURIComponent(uploadFailureMessage(e, "upload:story-cover", "The cover didn't upload — please try again."))}`);
  }
  // A cover is mandatory — fine to keep the existing one on a resubmit, but a
  // story that somehow has neither (pre-dates this rule, or a draft saved
  // before one was chosen) can't be submitted without one.
  if (!cover && !asDraft && !story.cover_path) {
    redirect(`/dashboard/story/${id}/edit?error=${encodeURIComponent("A cover image is required.")}`);
  }
  const { data: saved, error } = await db.from("stories").update({
    title,
    excerpt: String(formData.get("excerpt") ?? ""),
    body: sanitizeRichText(String(formData.get("body") ?? "")),
    status: asDraft ? "draft" : "awaiting_approval",
    member_draft: asDraft,
    // industry_id deliberately absent: it is Jas's to set, so a member edit keeps it
    // cleared so the member is not still shown last time's reason once they act on it
    rejected_reason: null,
    updated_at: new Date().toISOString(),
    ...(cover ? { cover_path: cover } : {}),
    ...(formData.get("focus_x")
      ? { cover_focus: { x: Number(formData.get("focus_x")), y: Number(formData.get("focus_y")), scale: Number(formData.get("focus_scale") || 1) } }
      : {}),
  })
    .eq("id", id).eq("member_id", user.memberId).eq("source", "member")
    .eq("status", story.status).eq("member_draft", story.member_draft).eq("updated_at", story.updated_at)
    .select("id");
  if (error || !saved?.length) {
    // Nothing points at the cover this request uploaded.
    await removeMedia(cover);
    if (error) redirect(`/dashboard/story/${id}/edit?error=${encodeURIComponent("Your changes couldn't be saved just now — please try again.")}`);
    storyChanged();
  }
  // The cover it replaced, unless something else still shows it (the media
  // library lets the desk reuse any upload).
  if (cover && story.cover_path && story.cover_path !== cover) await removeMediaIfUnused([story.cover_path]);
  const cat = Number(formData.get("category") || 0);
  if (cat) {
    await db.from("story_categories").delete().eq("story_id", id);
    await db.from("story_categories").insert({ story_id: id, category_id: cat });
  }
  revalidatePath("/dashboard");
  if (asDraft) {
    revalidatePath("/dashboard/submissions");
    redirect(`/dashboard/story/${id}/edit?saved=draft`);
  }
  await notifySubmitted(
    "story_submitted",
    user.memberId,
    { story_id: id },
    wasDraft ? `Submitted a story for approval: “${title}”.` : `Resubmitted their story “${title}” after changes.`,
  );
  redirect("/dashboard?submitted=story");
}

/** Editor image upload for the description field — returns { url } for insertion as <img src>, or { error } to show. */
export async function memberUploadVideoImage(formData: FormData): Promise<UploadResult> {
  const user = await requireMember();
  return editorImageUpload(formData, memberUploads(user.memberId), `videos/${user.memberId}`);
}

/** Member self-post: lands awaiting approval, never live directly. */
export async function submitVideo(formData: FormData) {
  const user = await requireMember();
  const title = String(formData.get("title") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  // Say why rather than silently re-rendering the form (same as submitStory).
  const problem = !title || !url ? "A title and a YouTube link are both required." : !youtubeId(url) ? YOUTUBE_ONLY_ERROR : null;
  if (problem) redirect(`/dashboard/video/new?error=${encodeURIComponent(problem)}`);
  let thumbnail: string | null = null;
  try {
    thumbnail = await uploadImage(await submittedFile(formData, "thumbnail", memberUploads(user.memberId)), "videos");
  } catch (e) {
    // Was an unhandled throw into the error boundary; now said on the form,
    // like the story cover. redirect() stays outside the try.
    redirect(`/dashboard/video/new?error=${encodeURIComponent(uploadFailureMessage(e, "upload:video-thumbnail", "The thumbnail didn't upload — please try again."))}`);
  }
  // The id is selected back purely so the console notification can link to it.
  const { data } = await serviceDb().from("videos").insert({
    slug: `${slugify(title)}-${Date.now().toString(36)}`,
    title,
    url,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    industry_id: null, // members never pick one; Jas tags it in the console
    status: "awaiting_approval",
    source: "member",
    member_id: user.memberId,
    submitted_by: user.userId,
    thumbnail_path: thumbnail,
  }).select("id").single();
  await notifySubmitted("video_submitted", user.memberId, { video_id: data?.id }, `Submitted a video for approval: “${title}”.`);
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=video");
}

/** Pull back a video that's still waiting on (or was sent back from) a decision. */
export async function withdrawVideo(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id"));
  const db = serviceDb();
  if (!(await assertOwnsRow(db, "videos", id, user.memberId))) return;
  await db.from("videos").update({ status: "withdrawn" }).eq("id", id);
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/** Edit and resubmit a video that's awaiting approval or was rejected. */
export async function editVideo(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id"));
  const db = serviceDb();
  if (!(await assertOwnsRow(db, "videos", id, user.memberId))) return;
  const title = String(formData.get("title") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const problem = !title || !url ? "A title and a YouTube link are both required." : !youtubeId(url) ? YOUTUBE_ONLY_ERROR : null;
  if (problem) redirect(`/dashboard/video/${id}/edit?error=${encodeURIComponent(problem)}`);
  let thumbnail: string | null = null;
  try {
    thumbnail = await uploadImage(await submittedFile(formData, "thumbnail", memberUploads(user.memberId)), "videos");
  } catch (e) {
    redirect(`/dashboard/video/${id}/edit?error=${encodeURIComponent(uploadFailureMessage(e, "upload:video-thumbnail", "The thumbnail didn't upload — please try again."))}`);
  }
  await db.from("videos").update({
    title,
    url,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    // industry_id deliberately absent: it is Jas's to set, so a member edit keeps it
    status: "awaiting_approval",
    rejected_reason: null,
    updated_at: new Date().toISOString(),
    ...(thumbnail ? { thumbnail_path: thumbnail } : {}),
  }).eq("id", id);
  await notifySubmitted("video_submitted", user.memberId, { video_id: id }, `Resubmitted their video “${title}” after changes.`);
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=video");
}

/** Editor image upload for the description field — returns { url } for insertion as <img src>, or { error } to show. */
export async function memberUploadEventImage(formData: FormData): Promise<UploadResult> {
  const user = await requireMember();
  return editorImageUpload(formData, memberUploads(user.memberId), `events/${user.memberId}`);
}

/** M4 — member adds an event; Jas approves. */
export async function submitEvent(formData: FormData) {
  const user = await requireMember();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  let cover: string | null = null;
  try {
    cover = await uploadImage(await submittedFile(formData, "cover", memberUploads(user.memberId)), "events");
  } catch (e) {
    // Was an unhandled throw into the error boundary; now said on the form.
    redirect(`/dashboard/event/new?error=${encodeURIComponent(uploadFailureMessage(e, "upload:event-cover", "The cover didn't upload — please try again."))}`);
  }
  const typeInput = String(formData.get("type") ?? "");
  const eventType = isEventType(typeInput) ? typeInput : null;
  const location = String(formData.get("location") ?? "");
  // New row, so any non-empty location is "changed" — one lookup per save,
  // failure just means no map pin (same guardrails as submitProfileEdit).
  const coords = location.trim() ? await geocodeAddress(location) : null;
  const { data } = await serviceDb().from("events").insert({
    slug: `${slugify(title)}-${Date.now().toString(36)}`,
    title,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    location,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    starts_on: String(formData.get("starts_on")),
    starts_time: String(formData.get("starts_time") ?? "") || null,
    ends_on: String(formData.get("ends_on") ?? "") || null,
    link: String(formData.get("link") ?? "") || null,
    member_id: user.memberId,
    type: eventType,
    industry_id: null, // members never pick one; Jas tags it in the console
    status: "awaiting_approval",
    source: "member",
    submitted_by: user.userId,
    cover_path: cover,
  }).select("id").single();
  await notifySubmitted("event_submitted", user.memberId, { event_id: data?.id }, `Submitted an event for approval: “${title}”.`);
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=event");
}

/** Pull back an event that's still waiting on (or was sent back from) a decision. */
export async function withdrawEvent(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id"));
  const db = serviceDb();
  if (!(await assertOwnsRow(db, "events", id, user.memberId))) return;
  await db.from("events").update({ status: "withdrawn" }).eq("id", id);
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/** Edit and resubmit an event that's awaiting approval or was rejected. */
export async function editEvent(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id"));
  const db = serviceDb();
  if (!(await assertOwnsRow(db, "events", id, user.memberId))) return;
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  let cover: string | null = null;
  try {
    cover = await uploadImage(await submittedFile(formData, "cover", memberUploads(user.memberId)), "events");
  } catch (e) {
    redirect(`/dashboard/event/${id}/edit?error=${encodeURIComponent(uploadFailureMessage(e, "upload:event-cover", "The cover didn't upload — please try again."))}`);
  }
  const typeInput = String(formData.get("type") ?? "");
  const eventType = isEventType(typeInput) ? typeInput : null;
  const location = String(formData.get("location") ?? "");
  // Re-geocode only when the location text changed; a failed lookup keeps the
  // coords already on file (same guardrails as submitProfileEdit above).
  const { data: existingEvent } = await db.from("events").select("location, lat, lng").eq("id", id).single();
  let lat = existingEvent?.lat ?? null;
  let lng = existingEvent?.lng ?? null;
  if (location.trim() && location.trim() !== (existingEvent?.location ?? "").trim()) {
    const geocoded = await geocodeAddress(location);
    if (geocoded) {
      lat = geocoded.lat;
      lng = geocoded.lng;
    }
  }
  await db.from("events").update({
    title,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    location,
    lat,
    lng,
    starts_on: String(formData.get("starts_on")),
    starts_time: String(formData.get("starts_time") ?? "") || null,
    ends_on: String(formData.get("ends_on") ?? "") || null,
    link: String(formData.get("link") ?? "") || null,
    type: eventType,
    // industry_id deliberately absent: it is Jas's to set, so a member edit keeps it
    status: "awaiting_approval",
    rejected_reason: null,
    updated_at: new Date().toISOString(),
    ...(cover ? { cover_path: cover } : {}),
  }).eq("id", id);
  await notifySubmitted("event_submitted", user.memberId, { event_id: id }, `Resubmitted their event “${title}” after changes.`);
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=event");
}

/**
 * M5 — profile edits are approval-gated (working assumption #2): stored as a revision.
 * Draft members (V13 step 3 of 4) write their page directly instead — it's not public
 * yet, and Jas's Activate is the one approval; a revision would mean approving twice.
 *
 * Parses the same FormData with the same parser the console's saveMember uses
 * (`companyPageValuesFromForm`), because both pages now render the same
 * `CompanyPageForm`. Everything the console's member editor can change about a
 * company page, a member can change about their own — what the console keeps to
 * itself is the membership half (status, billing, payment dates), which is a
 * different form entirely and never reaches here.
 */
export async function submitProfileEdit(formData: FormData) {
  const user = await requireMember();
  const back = (msg: string) => redirect(`/dashboard/profile?error=${encodeURIComponent(msg)}`);

  const db = serviceDb();
  const { data: member } = await db.from("members")
    .select("slug, status, draft_submitted_at, social, address, lat, lng").eq("id", user.memberId).single();
  if (!member) return;

  let uploaded: { logo_path: string | null; hero_path: string | null };
  try {
    const [logo_path, hero_path] = await Promise.all([
      submittedFile(formData, "logo", memberUploads(user.memberId)).then((file) => uploadImage(file, `members/${user.memberId}`)),
      submittedFile(formData, "hero", memberUploads(user.memberId)).then((file) => uploadImage(file, `members/${user.memberId}`)),
    ]);
    uploaded = { logo_path, hero_path };
  } catch (e) {
    // redirect() must stay outside the try or its NEXT_REDIRECT is swallowed
    // as an upload failure — same reasoning as saveMember.
    uploaded = { logo_path: null, hero_path: null };
    back(uploadFailureMessage(e, "upload:member-page", "The image didn't upload — please try again."));
    return;
  }

  // Industries are Jas's alone: the member's form has none, and this parser
  // ignores any a crafted post sends, so neither the primary (industry_id) nor
  // the member_industries set is touched here or carried on a revision.
  const parsed = ownCompanyPageValuesFromForm(formData, member, uploaded);
  if ("error" in parsed) return back(parsed.error);
  const values = { ...parsed.values };

  // The member owns their own URL now that the form is shared, so the same
  // guards the console applies have to apply here: a clash would violate the
  // unique index, and a silent rename would break every inbound link.
  const slug = values.slug!;
  const slugChanged = slug !== member.slug;
  if (slugChanged) {
    const { data: clash } = await db.from("members").select("id").eq("slug", slug).neq("id", user.memberId).maybeSingle();
    if (clash) return back(`The web address “${slug}” is already taken — choose another.`);
  }

  // Same rule the console applies — see resolveCoordinates.
  const coords = await resolveCoordinates(
    { lat: values.lat ?? null, lng: values.lng ?? null },
    member,
    String(values.address ?? ""),
  );
  values.lat = coords.lat;
  values.lng = coords.lng;

  // Services live in the `member_services` join table, not on `members`, so they
  // cannot ride the payload as a column. They travel as `service_ids`, which
  // decideRevision pulls out before it applies the rest — see the note there.
  const serviceIds = formData.getAll("services").map(Number).filter(Boolean);
  // Membership types travel the same way, as `membership_type_ids` (GAPS A8.1).
  const membershipTypeIds = membershipTypeIdsFromForm(formData);
  const tooManyTypes = membershipTypesError(membershipTypeIds);
  if (tooManyTypes) return back(tooManyTypes);

  if (member.status === "draft") {
    const firstSubmit = !member.draft_submitted_at;
    await db.from("members").update({
      ...values, // description already sanitised by the parser; page stays hidden until Activate
      draft_submitted_at: member.draft_submitted_at ?? new Date().toISOString(),
    }).eq("id", user.memberId);
    // A draft page is not public yet and Activate is the one approval it gets,
    // so its services apply straight away rather than through a revision.
    await replaceMemberServices(db, user.memberId, serviceIds);
    await replaceMemberMembershipTypes(db, user.memberId, membershipTypeIds);
    if (firstSubmit) {
      const { notifyAdminFunnel } = await import("@/lib/notify-admin");
      await notifyAdminFunnel({
        category: "notification",
        kind: "page_submitted",
        name: String(values.name ?? ""),
        email: user.email,
        memberId: user.memberId,
        payload: { member_id: user.memberId },
        message: "Submitted their draft company page for review — ready for your verification and approval.",
      });
    }
    revalidatePath("/dashboard");
    redirect("/dashboard?submitted=page");
  }

  await db.from("member_revisions").insert({
    member_id: user.memberId,
    payload: { ...values, service_ids: serviceIds, membership_type_ids: membershipTypeIds } as import("@/lib/db/types").Json,
  });
  // Like every other member submission, it lands in the console as a
  // notification linking to where it's approved (GAPS A1.12).
  await notifySubmitted("page_edit_submitted", user.memberId, { member_id: user.memberId }, "Submitted changes to their live company page for approval.");
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=profile");
}

/** Member equipment submission — approval-gated like stories, never live directly. */
export async function submitMachine(formData: FormData) {
  const user = await requireMember();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  // Optional, YouTube only (GAPS A9.4) — refused before the photo uploads.
  const video = optionalYoutubeUrl(formData.get("video_url"));
  if ("error" in video) redirect(`/dashboard/equipment/new?error=${encodeURIComponent(video.error)}`);
  let image: string | null = null;
  try {
    image = await uploadImage(await submittedFile(formData, "image", memberUploads(user.memberId)), `machines/${user.memberId}`);
  } catch (e) {
    // Was an unhandled throw into the error boundary; now said on the form.
    redirect(`/dashboard/equipment/new?error=${encodeURIComponent(uploadFailureMessage(e, "upload:machine-photo", "The photo didn't upload — please try again."))}`);
  }
  const { data } = await serviceDb().from("featured_machines").insert({
    name,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    external_url: String(formData.get("external_url") ?? "") || null,
    video_url: video.url,
    image_path: image,
    member_id: user.memberId,
    status: "awaiting_approval",
    source: "member",
    submitted_by: user.userId,
  }).select("id").single();
  await notifySubmitted("machine_submitted", user.memberId, { machine_id: data?.id }, `Submitted equipment for approval: “${name}”.`);
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=machine");
}

/** Pull back an equipment listing that's still waiting on (or was sent back from) a decision. */
export async function withdrawMachine(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id"));
  const db = serviceDb();
  if (!(await assertOwnsRow(db, "featured_machines", id, user.memberId))) return;
  await db.from("featured_machines").update({ status: "withdrawn" }).eq("id", id);
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/** Edit and resubmit an equipment listing that's awaiting approval or was rejected. */
export async function editMachine(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id"));
  const db = serviceDb();
  if (!(await assertOwnsRow(db, "featured_machines", id, user.memberId))) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const video = optionalYoutubeUrl(formData.get("video_url"));
  if ("error" in video) redirect(`/dashboard/equipment/${id}/edit?error=${encodeURIComponent(video.error)}`);
  let image: string | null = null;
  try {
    image = await uploadImage(await submittedFile(formData, "image", memberUploads(user.memberId)), `machines/${user.memberId}`);
  } catch (e) {
    redirect(`/dashboard/equipment/${id}/edit?error=${encodeURIComponent(uploadFailureMessage(e, "upload:machine-photo", "The photo didn't upload — please try again."))}`);
  }
  await db.from("featured_machines").update({
    name,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    external_url: String(formData.get("external_url") ?? "") || null,
    video_url: video.url,
    status: "awaiting_approval",
    rejected_reason: null,
    ...(image ? { image_path: image } : {}),
  }).eq("id", id);
  await notifySubmitted("machine_submitted", user.memberId, { machine_id: id }, `Resubmitted their equipment “${name}” after changes.`);
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=machine");
}

/** M11 — "Buy" request: no online payment; Jas confirms and invoices. */
export async function requestVisibility(formData: FormData) {
  const user = await requireMember();
  const db = serviceDb();
  const product = String(formData.get("product"));
  // Featured Member only: the month picked from the Buy page's availability
  // list. Re-counted here — the page may be stale, and a direct POST can send
  // anything — so only a month in the window with a slot left is stored.
  let preferredMonth: string | null = null;
  const picked = String(formData.get("preferred_month") ?? "");
  if (product === "featured_member" && picked) {
    const month = (await loadFeaturedMonths(db)).find((m) => m.key === picked);
    if (!month) redirect(`/dashboard/advertising/buy?error=${encodeURIComponent("Pick one of the months listed.")}`);
    if (month.left === 0) {
      redirect(`/dashboard/advertising/buy?error=${encodeURIComponent(`${month.label} has just filled up — pick another month.`)}`);
    }
    preferredMonth = month.first;
  }
  await db.from("visibility_requests").insert({
    member_id: user.memberId,
    product,
    message: String(formData.get("message") ?? "") || null,
    preferred_month: preferredMonth,
  });
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=buy");
}

/**
 * Help page (fix list item 15) — a member's direct line to Jas. Lands in the
 * console inbox as kind 'membership' and emails him, via the same
 * notifyAdminFunnel path the join funnel uses.
 */
export async function sendMemberMessage(formData: FormData) {
  const user = await requireMember();
  const message = String(formData.get("message") ?? "").trim();
  if (!message) redirect(`/dashboard/help?error=${encodeURIComponent("Write a message first.")}`);
  const { allowRequest, HOUR } = await import("@/lib/rate-limit");
  if (!(await allowRequest("member-help", 5, HOUR))) {
    redirect(`/dashboard/help?error=${encodeURIComponent("Too many messages just now — please try again shortly.")}`);
  }
  const { data: member } = await serviceDb().from("members").select("name").eq("id", user.memberId).single();
  const { notifyAdminFunnel } = await import("@/lib/notify-admin");
  await notifyAdminFunnel({
    // A real message: a member wrote it and is waiting to hear back. This and
    // requestContentChange below are the only two member-side rows that are.
    category: "message",
    kind: "membership",
    name: member?.name ?? user.displayName ?? user.email,
    email: user.email,
    memberId: user.memberId,
    message,
    emailKind: "admin_member_message",
  });
  redirect("/dashboard/help?sent=1");
}

/**
 * "Request a change" on published content (fix list).
 *
 * A member can see their published work but not edit it — editing is gated to
 * `awaiting_approval`/`rejected`, and reopening a live page for edit would take
 * it off the site while it waited for re-approval. So this asks Jas instead: the
 * note lands in the console inbox (where he can already reply in-app, fix list
 * item 24) and emails him, exactly as the Help page's message does. **The
 * published item is not touched** — no status change, no new table.
 */
export async function requestContentChange(formData: FormData) {
  const user = await requireMember();
  const title = String(formData.get("title") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const back = `/dashboard/submissions${String(formData.get("filter") ?? "") ? `?status=${formData.get("filter")}` : ""}`;
  if (!title) return;
  if (!note) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent("Tell us what needs changing first.")}`);

  // Same bucket and limit as the Help page: this is the same inbox and the same
  // person on the other end, so one member cannot flood it from two routes.
  const { allowRequest, HOUR } = await import("@/lib/rate-limit");
  if (!(await allowRequest("member-help", 5, HOUR))) {
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent("Too many requests just now — please try again shortly.")}`);
  }

  const { data: member } = await serviceDb().from("members").select("name").eq("id", user.memberId).single();
  const { notifyAdminFunnel } = await import("@/lib/notify-admin");
  await notifyAdminFunnel({
    category: "message",
    kind: "membership",
    name: member?.name ?? user.displayName ?? user.email,
    email: user.email,
    memberId: user.memberId,
    message: `Change requested on published ${kind || "content"} “${title}”:\n\n${note}`,
    emailKind: "admin_change_request",
  });
  redirect(`${back}${back.includes("?") ? "&" : "?"}requested=1`);
}

export async function markNotificationRead(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id"));
  await serviceDb().from("notifications").update({ read_at: new Date().toISOString() })
    .eq("id", id).eq("member_id", user.memberId).is("read_at", null);
  revalidatePath("/dashboard/notifications");
  revalidatePath("/dashboard");
}

export async function markAllNotificationsRead() {
  const user = await requireMember();
  await serviceDb().from("notifications").update({ read_at: new Date().toISOString() })
    .eq("member_id", user.memberId).is("read_at", null);
  revalidatePath("/dashboard/notifications");
  revalidatePath("/dashboard");
}

/** Permanently dismisses the newly-activated-member welcome panel (A4.18). */
export async function dismissOnboarding() {
  const user = await requireMember();
  await serviceDb().from("members").update({ onboarding_seen: true }).eq("id", user.memberId);
  revalidatePath("/dashboard");
}

/** Matches Supabase's own minimum; config.toml sets no stricter policy — same bound as /reset/new. */
const PASSWORD_MIN_LENGTH = 8;

/** In-session change-password: no recovery token needed since the member is already authenticated. */
export async function changePassword(formData: FormData) {
  const user = await requireMember();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < PASSWORD_MIN_LENGTH) redirect("/dashboard/settings/security?perror=short");
  if (password !== confirm) redirect("/dashboard/settings/security?perror=mismatch");

  const db = await sessionDb();
  const { error } = await db.auth.updateUser({ password });
  if (error) redirect("/dashboard/settings/security?perror=failed");

  await audit({ action: "password_changed", actorUserId: user.userId, actorRole: user.role, memberId: user.memberId });
  redirect("/dashboard/settings/security?psaved=1");
}

/**
 * Change the email the member logs in with (GAPS A4.12). Distinct from the
 * public contact email on their company page, which this never touches.
 *
 * Supabase does the security work: nothing changes until a confirmation link
 * is clicked, and with "secure email change" on (the local config's
 * `double_confirm_changes`, and the hosted default) links go to both the
 * current and the new address. ⚠ Whether Supabase then needs BOTH clicked
 * under the PKCE flow is unverified: locally one link (the old address's)
 * completed the change, but the local auth server was running stale config,
 * so that is not conclusive — see GAPS A4.12. The page copy claims neither.
 * The links land on /account/email/confirm, outside /dashboard, because the
 * old address's email is often opened on another device with no session.
 */
export async function changeLoginEmail(formData: FormData) {
  const user = await requireMember();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const back = (code: string) => redirect(`/dashboard/settings/security?eerror=${code}`);
  if (!EMAIL_RE.test(email)) return back("invalid");
  if (email === user.email.toLowerCase()) return back("same");
  // Each request sends email to two inboxes; cap it per account.
  if (!withinLimit(`email-change:${user.userId}`, 3, HOUR)) return back("limit");

  const db = await sessionDb();
  const { error } = await db.auth.updateUser({ email }, { emailRedirectTo: `${siteUrl()}/account/email/confirm` });
  // Supabase refuses an address another account already uses; say so without
  // echoing anything about that other account.
  if (error) return back(/already|registered|exists/i.test(error.message) ? "taken" : "failed");
  // The new address is not logged: the change itself is the security event.
  await audit({ action: "login_email_change_requested", actorUserId: user.userId, actorRole: user.role, memberId: user.memberId });
  redirect("/dashboard/settings/security?esent=1");
}

/** GAPS B1.5 — member-side subscription cancellation, requested from /dashboard/settings/billing. */
export async function cancelMembership() {
  const user = await requireMember();
  const { requestCancellation } = await import("@/lib/membership");
  const result = await requestCancellation(user.memberId);
  revalidatePath("/dashboard/settings/billing");
  redirect(result.ok ? "/dashboard/settings/billing?cancelled=1" : `/dashboard/settings/billing?cerror=${encodeURIComponent(result.error)}`);
}

export async function savePrefs(formData: FormData) {
  const user = await requireMember();
  await serviceDb().from("notification_prefs").upsert({
    member_id: user.memberId,
    stats_frequency: String(formData.get("stats_frequency") ?? "quarterly"),
    leads_frequency: String(formData.get("leads_frequency") ?? "weekly"),
  });
  revalidatePath("/dashboard/settings");
  redirect("/dashboard/settings?saved=1");
}

/* ---------- adverts ---------- */

/**
 * A member's own advert. Two rows: the artwork (adverts) and the run they are
 * asking for (advert_bookings), which is what carries the approval state.
 *
 * The run lands 'awaiting_approval' — nothing a member submits reaches the site
 * without Jas, and the render predicate enforces that independently.
 */
export async function submitAdvert(formData: FormData) {
  const user = await requireMember();
  const name = String(formData.get("name") ?? "").trim();
  const format = String(formData.get("format") ?? "");
  const starts_on = String(formData.get("starts_on") ?? "");
  const ends_on = String(formData.get("ends_on") ?? "");
  if (!name || !format || !starts_on || !ends_on) return;
  // Checked before anything uploads, so a bad link leaves no orphaned artwork.
  const link = advertLinkFromForm(formData);
  if ("error" in link) redirect(`/dashboard/advertising/buy?error=${encodeURIComponent(link.error)}`);

  let desktop_path: string | null = null;
  let mobile_path: string | null = null;
  try {
    desktop_path = await uploadImage(await submittedFile(formData, "desktop", memberUploads(user.memberId)), `panels/${user.memberId}`);
    mobile_path = await uploadImage(await submittedFile(formData, "mobile", memberUploads(user.memberId)), `panels/${user.memberId}`);
  } catch (e) {
    redirect(`/dashboard/advertising/buy?error=${encodeURIComponent(uploadFailureMessage(e, "upload:advert-artwork", "The artwork didn't upload — please try again."))}`);
  }
  if (!desktop_path || !mobile_path) {
    redirect(`/dashboard/advertising/buy?error=${encodeURIComponent("Both a desktop and a mobile image are required.")}`);
  }

  const db = serviceDb();
  const { data: advert, error: advertError } = await db.from("adverts").insert({
    member_id: user.memberId,
    name,
    format,
    desktop_path,
    mobile_path,
    link_url: link.url,
  }).select("id").single();
  if (!advert) {
    // Nothing was written, so the just-uploaded artwork would otherwise be
    // orphaned storage with no row pointing at it.
    await Promise.all([removeMedia(desktop_path), removeMedia(mobile_path)]);
    // The database's own wording (constraint names, columns) is for the error
    // log, not the member.
    logError({ source: "server", area: "action:submitAdvert", error: advertError ?? new Error("advert insert returned no row") });
    redirect(`/dashboard/advertising/buy?error=${encodeURIComponent(SAVE_FAILED)}`);
  }

  const { data: booking, error: bookingError } = await db.from("advert_bookings").insert({
    advert_id: advert.id,
    starts_on,
    ends_on,
    status: "awaiting_approval",
    source: "member",
    submitted_by: user.userId,
    submitted_at: new Date().toISOString(),
    notes: String(formData.get("notes") ?? "").trim() || null,
  }).select("id").single();
  if (bookingError) {
    // The advert row is worthless without a booking on it (and would show up
    // nowhere the member or console can reach to retry) — clean it and its
    // artwork up rather than leaving an orphan and redirecting to "success".
    await Promise.all([removeMedia(desktop_path), removeMedia(mobile_path)]);
    await db.from("adverts").delete().eq("id", advert.id);
    const datesWrong = bookingError.message.includes("ends_on");
    if (!datesWrong) logError({ source: "server", area: "action:submitAdvert", error: bookingError });
    redirect(`/dashboard/advertising/buy?error=${encodeURIComponent(
      datesWrong ? "The run must end on or after its start date." : SAVE_FAILED,
    )}`);
  }
  await notifySubmitted("advert_submitted", user.memberId, { booking_id: booking?.id }, `Booked an advert run for approval: “${name}”, ${starts_on} to ${ends_on}.`);
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=advert");
}

/**
 * Edit and resubmit after it was sent back. The first member-side edit route in
 * the app — until now a sent-back submission was a dead end, and the member's
 * only recourse was to start again from the /new form.
 *
 * Only their own, and only while it is still theirs to change: once approved
 * the dates are committed, so draft and review_required are the editable states.
 */
export async function resubmitAdvert(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id"));
  const db = serviceDb();
  const booking = await assertOwnsBooking(db, id, user.memberId);
  if (!booking) return;
  if (!["draft", "review_required"].includes(booking.status)) return;
  const link = advertLinkFromForm(formData);
  if ("error" in link) redirect(`/dashboard/advert/${id}?error=${encodeURIComponent(link.error)}`);

  let desktop_path: string | null = null;
  let mobile_path: string | null = null;
  try {
    desktop_path = await uploadImage(await submittedFile(formData, "desktop", memberUploads(user.memberId)), `panels/${user.memberId}`);
    mobile_path = await uploadImage(await submittedFile(formData, "mobile", memberUploads(user.memberId)), `panels/${user.memberId}`);
  } catch (e) {
    redirect(`/dashboard/advert/${id}?error=${encodeURIComponent(uploadFailureMessage(e, "upload:advert-artwork", "The artwork didn't upload — please try again."))}`);
  }

  const name = String(formData.get("name") ?? "").trim();
  if (name || desktop_path || mobile_path || formData.get("link_url") !== null) {
    await db.from("adverts").update({
      ...(name ? { name } : {}),
      link_url: link.url,
      ...(desktop_path ? { desktop_path } : {}),
      ...(mobile_path ? { mobile_path } : {}),
      updated_at: new Date().toISOString(),
    }).eq("id", booking.advert_id);
  }

  const now = new Date().toISOString();
  await db.from("advert_bookings").update({
    starts_on: String(formData.get("starts_on")),
    ends_on: String(formData.get("ends_on")),
    status: "awaiting_approval",
    // cleared so the member is not still shown last time's note once they act on it
    review_reason: null,
    submitted_at: now,
    updated_at: now,
  }).eq("id", id);

  await notifySubmitted("advert_submitted", user.memberId, { booking_id: id }, `Resubmitted an advert run after changes${name ? `: “${name}”` : ""}.`);
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=advert");
}

/**
 * Rebook a finished run: same artwork, new dates, back through approval. Only
 * a run that has ended (lib/advert-renewal — the booking page offers the form
 * on exactly the same rule), only for dates that are real, in order and not in
 * the past, and the console is told only once the new booking exists.
 */
export async function renewAdvertBooking(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id"));
  const db = serviceDb();
  const prev = await assertOwnsBooking(db, id, user.memberId);
  if (!prev) return;
  const back = (msg: string) => redirect(`/dashboard/advert/${id}?error=${encodeURIComponent(msg)}`);
  const today = new Date().toISOString().slice(0, 10);
  if (!canRenewBooking(prev, today)) return back("Only a run that has finished can be booked again.");
  const starts_on = String(formData.get("starts_on") ?? "");
  const ends_on = String(formData.get("ends_on") ?? "");
  const datesProblem = renewalDatesProblem(starts_on, ends_on, today);
  if (datesProblem) return back(datesProblem);

  const { data: renewal, error } = await db.from("advert_bookings").insert({
    advert_id: prev.advert_id,
    // last run's price, which the admin sees prefilled when approving
    price_pennies: prev.price_pennies,
    starts_on,
    ends_on,
    status: "awaiting_approval",
    source: "member",
    renewed_from: id,
    submitted_by: user.userId,
    submitted_at: new Date().toISOString(),
  }).select("id").single();
  // A second submit of the same form (advert_bookings_one_pending_member_renewal).
  if (error?.code === "23505" && error.message.includes("one_pending_member_renewal")) {
    return back("You've already asked to book this run again — that request is waiting for a decision.");
  }
  if (error || !renewal) {
    console.error(`[dashboard] renewal of booking ${id} failed: ${error?.message ?? "no row returned"}`);
    return back("The new run couldn't be booked just now — please try again.");
  }
  // Links to the NEW booking, not the run it was renewed from — the new one is
  // the row awaiting a decision.
  await notifySubmitted("advert_submitted", user.memberId, { booking_id: renewal.id }, `Asked to renew an advert run: ${starts_on} to ${ends_on}.`);
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=advert");
}

/**
 * Propose new artwork on a run that is already scheduled or live, without
 * touching its dates. Unlike resubmitAdvert (which edits a booking still in
 * draft/review_required), this never applies immediately — a member cannot
 * self-approve, so it always lands 'pending' for Jas to decide.
 */
export async function proposeOwnArtworkSwap(formData: FormData) {
  const user = await requireMember();
  const advertId = String(formData.get("advert_id"));
  const db = serviceDb();
  if (!(await assertOwnsAdvert(db, advertId, user.memberId))) return;

  let desktop_path: string | null = null;
  let mobile_path: string | null = null;
  try {
    desktop_path = await uploadImage(await submittedFile(formData, "desktop", memberUploads(user.memberId)), `panels/${user.memberId}`);
    mobile_path = await uploadImage(await submittedFile(formData, "mobile", memberUploads(user.memberId)), `panels/${user.memberId}`);
  } catch (e) {
    redirect(`/dashboard/advert/${String(formData.get("booking_id"))}?error=${encodeURIComponent(uploadFailureMessage(e, "upload:advert-artwork", "The artwork didn't upload — please try again."))}`);
  }
  if (!desktop_path || !mobile_path) {
    redirect(`/dashboard/advert/${String(formData.get("booking_id"))}?error=${encodeURIComponent("Both a desktop and a mobile image are required.")}`);
  }

  const { error } = await db.from("advert_artwork_proposals").insert({
    advert_id: advertId,
    desktop_path,
    mobile_path,
    status: "pending",
    source: "member",
    submitted_by: user.userId,
  });
  // the partial unique index is the likely rejection: one proposal already awaiting a decision
  if (error) {
    const alreadyPending = error.message.includes("advert_artwork_proposals_one_pending");
    if (!alreadyPending) logError({ source: "server", area: "action:proposeOwnArtworkSwap", error });
    redirect(`/dashboard/advert/${String(formData.get("booking_id"))}?error=${encodeURIComponent(
      alreadyPending ? "You already have a swap awaiting a decision on this advert." : SAVE_FAILED,
    )}`);
  }
  // No per-proposal console route exists, so this lands on the artwork queue —
  // see the artwork_submitted branch in console-notification-links.
  await notifySubmitted("artwork_submitted", user.memberId, { advert_id: advertId }, "Proposed new artwork for an advert already booked.");
  revalidatePath("/dashboard/advert");
  redirect(`/dashboard/advert/${String(formData.get("booking_id"))}?submitted=swap`);
}

/* ---------- lead gen ---------- */

/**
 * GAPS A8.4 / USE-CASES M14: a member marks a prospect to follow up on.
 *
 * There is no row of ours to assert ownership of — the prospect comes from the
 * `LeadGenSource` adapter — so the usual `assertOwns*` pattern doesn't apply
 * directly. Three checks stand in for it, and all three matter because this
 * action is reachable by direct POST:
 *
 *   1. `member_id` comes from the session, never the form. A crafted POST
 *      carrying someone else's id is ignored, not honoured.
 *   2. `action` is hard-coded. Call / email / add-to-sequence are admin-only
 *      capabilities (A29) and must not be reachable from here at all.
 *   3. `ref` is validated against this member's own results. Without it a
 *      member could attach marks to arbitrary strings, and once the source is
 *      live, to prospects scoped to a competitor.
 */
export async function markProspectFollowUp(formData: FormData) {
  const user = await requireMember();
  if (!user.memberId) return;
  // Leads switched off in /console/features: a crafted POST mustn't reach it.
  if (!(await isFeatureEnabled("member_leads"))) return;

  const ref = String(formData.get("ref") ?? "").trim();
  if (!ref) return;

  const source = getLeadGenSource();
  const visible = await source.search({ memberId: user.memberId });
  if (!visible.some((p) => p.ref === ref)) return;

  await source.mark(ref, "follow_up", { memberId: user.memberId });
  revalidatePath("/dashboard/leads");
}

/** Undo a follow-up mark. Deletes by id, scoped to this member's own rows. */
export async function unmarkProspect(formData: FormData) {
  const user = await requireMember();
  if (!user.memberId) return;
  if (!(await isFeatureEnabled("member_leads"))) return;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const db = serviceDb();
  if (!(await assertOwnsMark(db, id, user.memberId))) return;

  await db.from("prospect_marks").delete().eq("id", id);
  revalidatePath("/dashboard/leads");
}

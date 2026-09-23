"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { geocodeAddress } from "@/lib/adapters/geocode";
import { getLeadGenSource, isProspectAction } from "@/lib/adapters/leadgen";
import { AD_FORMAT_KEYS, type AdFormat } from "@/lib/advert-formats";
import { DEFAULT_SOCIAL_CAPS, type SocialCaps } from "@/lib/social-caps";
import type { SocialChannels } from "@/lib/social-channels";
import { applyOptIn, NEWSLETTER_CHOICES, type NewsletterChoice } from "@/lib/contacts";
import { meetsWcagAA } from "@/lib/contrast";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { DEV_ASSIGNEES, DEV_STATUSES, devTaskValuesFromForm, type DevStatus } from "@/lib/dev-tasks";
import { isEventType } from "@/lib/event-types";
import { enqueue } from "@/lib/jobs";
import { safeInternalPath } from "@/lib/validate";
import { canMoveStory } from "@/lib/story-board";
import { canMoveEvent } from "@/lib/event-board";
import { canMoveVideo } from "@/lib/video-board";
import { FEATURED_SLOTS } from "@/lib/pricing";
import { raiseInvoice } from "@/lib/invoicing";
import { removeMedia, uploadDocument, uploadImage } from "@/lib/media";
import { memberValuesFromForm } from "@/lib/member-form";
import { resolveCoordinates } from "@/lib/member-geocode";
import { replaceMemberServices } from "@/lib/member-services";
import { recordRename } from "@/lib/redirects";
import { activationBlocked, MEMBER_STATUSES, type MemberStatus } from "@/lib/membership";
import { renderableHtml, sanitizeRichText } from "@/lib/sanitize";
import { siteUrl } from "@/lib/site-url";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** Editor image upload — returns the public URL for insertion as <img src>. */
export async function consoleUploadImage(formData: FormData): Promise<string | null> {
  await requireConsole();
  const path = await uploadImage(formData.get("file") as File | null, "stories/console");
  return mediaUrl(path);
}

/* ---------- stories ---------- */

export async function saveStory(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id") ?? "");
  const db = serviceDb();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  let cover_path: string | null = null;
  try {
    cover_path = await uploadImage(formData.get("cover") as File | null, "stories");
  } catch (e) {
    redirect(`/console/stories/${id || "new"}?error=${encodeURIComponent(e instanceof Error ? e.message : "Cover upload failed.")}`);
  }

  const values = {
    title,
    excerpt: String(formData.get("excerpt") ?? ""),
    body: sanitizeRichText(String(formData.get("body") ?? "")),
    member_id: String(formData.get("member_id") ?? "") || null,
    is_member_news: formData.get("is_member_news") === "on",
    industry_id: Number(formData.get("industry_id")) || null,
    updated_at: new Date().toISOString(),
    cover_focus: formData.get("focus_x")
      ? { x: Number(formData.get("focus_x")), y: Number(formData.get("focus_y")), scale: Number(formData.get("focus_scale") || 1) }
      : undefined,
    // An empty file input leaves the existing cover alone.
    ...(cover_path ? { cover_path } : {}),
  };

  let storyId = id;
  if (id) {
    const { data: prev } = cover_path
      ? await db.from("stories").select("cover_path").eq("id", id).single()
      : { data: null };
    await db.from("stories").update(values).eq("id", id);
    if (prev?.cover_path && prev.cover_path !== cover_path) await removeMedia(prev.cover_path);
  } else {
    const { data } = await db.from("stories").insert({
      ...values,
      slug: `${slugify(title)}-${Date.now().toString(36)}`,
      status: "draft",
      source: "admin",
      submitted_by: user.userId,
    }).select("id").single();
    storyId = data!.id;
  }
  const catIds = formData.getAll("categories").map(Number).filter(Boolean);
  if (catIds.length) {
    await db.from("story_categories").delete().eq("story_id", storyId);
    await db.from("story_categories").insert(catIds.map((category_id) => ({ story_id: storyId, category_id })));
  }
  revalidatePath("/console/stories");
  redirect(`/console/stories/${storyId}`);
}

export async function scheduleStory(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const when = String(formData.get("scheduled_at") ?? "");
  const db = serviceDb();
  const { data: story } = await db.from("stories").select("member_id, status").eq("id", id).single();
  const wasAwaitingApproval = story?.status === "awaiting_approval";
  if (formData.get("mode") === "now") {
    // urgent override — publish immediately, social push follows on its delay
    await db.from("stories").update({ status: "published", published_at: new Date().toISOString() }).eq("id", id);
    await enqueue("social_push", { story_id: id }, new Date(Date.now() + 30 * 60_000));
    if (story?.member_id) await enqueue("notify_member", { member_id: story.member_id, kind: "story_live", story_id: id });
  } else if (when) {
    await db.from("stories").update({ status: "scheduled", scheduled_at: new Date(when).toISOString() }).eq("id", id);
  }
  // scheduling from awaiting_approval is also an approval — record it same as decideStory's approve branch
  if (wasAwaitingApproval) {
    await db.from("approvals").insert({ kind: "story", subject_id: id, decision: "approved", reason: null, decided_by: user.userId });
  }
  revalidatePath("/console/stories");
  // come back to whichever Story Engine view the operator came from (board or
  // calendar). Validated, not trusted — this is POST-reachable like every action.
  const back = String(formData.get("return_to") ?? "");
  redirect(/^\/console\/stories(\?[\w=&-]*)?$/.test(back) ? back : "/console/stories");
}

export async function decideStory(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const reason = String(formData.get("reason") ?? "");
  const db = serviceDb();
  const { data: story } = await db.from("stories").select("id, member_id, status").eq("id", id).single();
  if (!story || story.status !== "awaiting_approval") return;

  if (decision === "approve") {
    await db.from("stories").update({ status: "published", published_at: new Date().toISOString() }).eq("id", id);
    await enqueue("social_push", { story_id: id }, new Date(Date.now() + 30 * 60_000));
    if (story.member_id) await enqueue("notify_member", { member_id: story.member_id, kind: "story_live", story_id: id });
  } else {
    // working assumption #1: member is notified with a reason
    await db.from("stories").update({ status: "rejected", rejected_reason: reason }).eq("id", id);
    if (story.member_id) await enqueue("notify_member", { member_id: story.member_id, kind: "story_rejected", story_id: id, reason });
  }
  await db.from("approvals").insert({ kind: "story", subject_id: id, decision: decision === "approve" ? "approved" : "rejected", reason: reason || null, decided_by: user.userId });
  revalidatePath("/console");
  revalidatePath("/console/stories");
}

export async function pinStory(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id"));
  const days = Number(formData.get("days") || 0);
  await serviceDb().from("stories").update({
    pinned_until: days > 0 ? new Date(Date.now() + days * 864e5).toISOString() : null,
  }).eq("id", id);
  revalidatePath("/console/stories");
}

/**
 * Kanban drop handler — a typed server action called directly from the client
 * board, same "not FormData" precedent as moveDevTask. Unlike moveDevTask, any
 * move here can be illegal (see LEGAL_STORY_MOVES), so this returns {ok,error}
 * rather than void, and re-reads the row's current status from the DB rather
 * than trusting the client's idea of "from" — a stale drag can't apply an
 * illegal transition.
 */
export async function moveStory(input: { id: string; to: string }): Promise<{ ok: boolean; error?: string }> {
  const user = await requireConsole();
  const db = serviceDb();
  const { data: story } = await db.from("stories").select("id, status, member_id").eq("id", input.id).single();
  if (!story) return { ok: false, error: "Story not found." };
  if (!canMoveStory(story.status, input.to)) {
    return { ok: false, error: `Can't move a ${story.status} story straight to ${input.to}.` };
  }
  if (input.to === "published") {
    await db.from("stories").update({ status: "published", published_at: new Date().toISOString() }).eq("id", input.id);
    await enqueue("social_push", { story_id: input.id }, new Date(Date.now() + 30 * 60_000));
    if (story.member_id) await enqueue("notify_member", { member_id: story.member_id, kind: "story_live", story_id: input.id });
    if (story.status === "awaiting_approval") {
      // mirror decideStory's approve branch so the audit trail is identical
      // whether an operator clicked Approve or dragged the card.
      await db.from("approvals").insert({ kind: "story", subject_id: input.id, decision: "approved", reason: null, decided_by: user.userId });
    }
  } else {
    // Leaving published clears published_at, same reasoning as moveVideo: a
    // re-publish stamps a fresh date, and a draft carrying a publication date is
    // a claim the row cannot support.
    await db.from("stories").update({
      status: input.to,
      ...(story.status === "published" ? { published_at: null } : {}),
    }).eq("id", input.id);
  }
  revalidatePath("/console");
  revalidatePath("/console/stories");
  return { ok: true };
}

/** Keyboard/no-JS fallback for the story board — same shape as setDevTaskStatus. */
export async function setStoryStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("status") ?? "");
  if (!id || !to) return;
  await moveStory({ id, to });
  redirect("/console/stories");
}

/* ---------- videos ---------- */

/** Editor image upload for the description field — returns the public URL for insertion as <img src>. */
export async function consoleUploadVideoImage(formData: FormData): Promise<string | null> {
  await requireConsole();
  const path = await uploadImage(formData.get("file") as File | null, "videos/console");
  return mediaUrl(path);
}

export async function saveVideo(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id") ?? "");
  const db = serviceDb();
  const title = String(formData.get("title") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  if (!title || !url) return;

  let thumbnail_path: string | null = null;
  try {
    thumbnail_path = await uploadImage(formData.get("thumbnail") as File | null, "videos");
  } catch (e) {
    redirect(`/console/videos/${id || "new"}?error=${encodeURIComponent(e instanceof Error ? e.message : "Thumbnail upload failed.")}`);
  }

  const values = {
    title,
    url,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    member_id: String(formData.get("member_id") ?? "") || null,
    industry_id: Number(formData.get("industry_id")) || null,
    updated_at: new Date().toISOString(),
    ...(thumbnail_path ? { thumbnail_path } : {}),
  };

  let videoId = id;
  if (id) {
    await db.from("videos").update(values).eq("id", id);
  } else {
    const { data } = await db.from("videos").insert({
      ...values,
      slug: `${slugify(title)}-${Date.now().toString(36)}`,
      status: "draft",
      source: "manual",
      submitted_by: user.userId,
    }).select("id").single();
    videoId = data!.id;
  }
  revalidatePath("/console/videos");
  redirect(`/console/videos/${videoId}`);
}

export async function scheduleVideo(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const when = String(formData.get("scheduled_at") ?? "");
  const db = serviceDb();
  const { data: video } = await db.from("videos").select("member_id, status").eq("id", id).single();
  const wasAwaitingApproval = video?.status === "awaiting_approval";
  if (formData.get("mode") === "now") {
    // urgent override — publish immediately, social push follows on its delay
    await db.from("videos").update({ status: "published", published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
    await enqueue("social_push", { video_id: id }, new Date(Date.now() + 30 * 60_000));
    if (video?.member_id) await enqueue("notify_member", { member_id: video.member_id, kind: "video_live", video_id: id });
  } else if (when) {
    await db.from("videos").update({ status: "scheduled", scheduled_at: new Date(when).toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
  }
  // scheduling from awaiting_approval is also an approval — record it same as decideVideo's approve branch
  if (wasAwaitingApproval) {
    await db.from("approvals").insert({ kind: "video", subject_id: id, decision: "approved", reason: null, decided_by: user.userId });
  }
  revalidatePath("/console/videos");
  const back = String(formData.get("return_to") ?? "");
  redirect(/^\/console\/videos(\?[\w=&-]*)?$/.test(back) ? back : "/console/videos");
}

export async function decideVideo(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const reason = String(formData.get("reason") ?? "");
  const db = serviceDb();
  const { data: video } = await db.from("videos").select("id, member_id, status").eq("id", id).single();
  if (!video || video.status !== "awaiting_approval") return;

  if (decision === "approve") {
    await db.from("videos").update({ status: "published", published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
    await enqueue("social_push", { video_id: id }, new Date(Date.now() + 30 * 60_000));
    if (video.member_id) await enqueue("notify_member", { member_id: video.member_id, kind: "video_live", video_id: id });
  } else {
    await db.from("videos").update({ status: "rejected", rejected_reason: reason, updated_at: new Date().toISOString() }).eq("id", id);
    if (video.member_id) await enqueue("notify_member", { member_id: video.member_id, kind: "video_rejected", video_id: id, reason });
  }
  await db.from("approvals").insert({ kind: "video", subject_id: id, decision: decision === "approve" ? "approved" : "rejected", reason: reason || null, decided_by: user.userId });
  revalidatePath("/console");
  revalidatePath("/console/videos");
}

export async function pinVideo(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id"));
  const days = Number(formData.get("days") || 0);
  await serviceDb().from("videos").update({
    pinned_until: days > 0 ? new Date(Date.now() + days * 864e5).toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  revalidatePath("/console/videos");
}

/**
 * Video Engine kanban drop handler — the sibling of `moveStory`, same contract:
 * re-read the current status from the DB rather than trusting the client's idea
 * of it, refuse anything outside LEGAL_VIDEO_MOVES, and return the reason so the
 * board can revert its optimistic update and say why.
 */
export async function moveVideo(input: { id: string; to: string }): Promise<{ ok: boolean; error?: string }> {
  const user = await requireConsole();
  const db = serviceDb();
  const { data: video } = await db.from("videos").select("id, status, member_id").eq("id", input.id).single();
  if (!video) return { ok: false, error: "Video not found." };
  if (!canMoveVideo(video.status, input.to)) {
    return { ok: false, error: `Can't move a ${video.status} video straight to ${input.to}.` };
  }
  if (input.to === "published") {
    await db.from("videos").update({ status: "published", published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", input.id);
    await enqueue("social_push", { video_id: input.id }, new Date(Date.now() + 30 * 60_000));
    if (video.member_id) await enqueue("notify_member", { member_id: video.member_id, kind: "video_live", video_id: input.id });
    if (video.status === "awaiting_approval") {
      // mirror decideVideo's approve branch so the audit trail is identical
      // whether an operator clicked Approve or dragged the card.
      await db.from("approvals").insert({ kind: "video", subject_id: input.id, decision: "approved", reason: null, decided_by: user.userId });
    }
  } else {
    // Leaving published clears published_at: a later re-publish must stamp a
    // fresh date, and "published_at set while status is draft" is a lie the
    // public queries would eventually trip over.
    await db.from("videos").update({
      status: input.to,
      updated_at: new Date().toISOString(),
      ...(video.status === "published" ? { published_at: null } : {}),
    }).eq("id", input.id);
  }
  revalidatePath("/console");
  revalidatePath("/console/videos");
  return { ok: true };
}

/** Keyboard/no-JS fallback for the video board — same shape as setStoryStatus. */
export async function setVideoStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("status") ?? "");
  if (!id || !to) return;
  await moveVideo({ id, to });
}

/* ---------- unpublish ---------- */

// Not exported: this is a "use server" module, and Next only permits async
// function exports from one. A const export here is a runtime error on every
// page that imports the module, which typecheck and lint both let through.
const UNPUBLISHABLE_KINDS = ["story", "video", "event", "machine"] as const;

/**
 * Take published content back to draft (fix list).
 *
 * Stories could already do this, but *only* by dragging a card on the board —
 * the editors offered no button, and videos, events and equipment had no route
 * back from published at all. This is that button, for all four.
 *
 * Stories and videos delegate to their board matrix so it stays the single
 * authority on legal transitions; events and equipment have no matrix, so the
 * `published` precondition is checked inline. Either way an already-draft row is
 * a no-op rather than an error.
 *
 * The member is deliberately NOT notified — there is no notification kind for
 * "your content was taken down" and inventing the wording is Jas's call
 * (docs/ask-jas.md).
 */
export async function returnToDraft(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!id || !(UNPUBLISHABLE_KINDS as readonly string[]).includes(kind)) return;
  const db = serviceDb();

  // One branch per table rather than a generic `db.from(table)`: the four
  // tables' Update types differ (featured_machines has no updated_at at all,
  // only created_at), and a union collapses the payload type to never. The
  // compiler caught exactly that — worth keeping the branches honest.
  if (kind === "story") {
    await moveStory({ id, to: "draft" });
    redirect(`/console/stories/${id}`);
  }
  if (kind === "video") {
    await moveVideo({ id, to: "draft" });
    redirect(`/console/videos/${id}`);
  }
  if (kind === "event") {
    const result = await moveEvent({ id, to: "draft" });
    if (!result.ok) return;
    redirect(`/console/events/${id}`);
  }

  const { data: row } = await db.from("featured_machines").select("id, status").eq("id", id).single();
  if (!row || row.status !== "published") return;
  await db.from("featured_machines").update({ status: "draft" }).eq("id", id);
  revalidatePath("/console");
  revalidatePath("/console/machines");
  redirect(`/console/machines/${id}`);
}

/* ---------- events & member revisions ---------- */

/** Editor image upload for the description field — returns the public URL for insertion as <img src>. */
export async function consoleUploadEventImage(formData: FormData): Promise<string | null> {
  await requireConsole();
  const path = await uploadImage(formData.get("file") as File | null, "events/console");
  return mediaUrl(path);
}

export async function saveEvent(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id") ?? "");
  const db = serviceDb();
  const title = String(formData.get("title") ?? "").trim();
  const starts_on = String(formData.get("starts_on") ?? "");
  if (!title || !starts_on) return;

  let cover_path: string | null = null;
  try {
    cover_path = await uploadImage(formData.get("cover") as File | null, "events");
  } catch (e) {
    redirect(`/console/events/${id || "new"}?error=${encodeURIComponent(e instanceof Error ? e.message : "Cover upload failed.")}`);
  }

  const type = String(formData.get("type") ?? "");
  const location = String(formData.get("location") ?? "") || null;

  // Geocode only when the location text actually changed (same guardrails as
  // submitProfileEdit in dashboard/actions.ts): one Nominatim lookup per save
  // at most, and a failed/empty lookup keeps whatever coords were on file
  // rather than blanking the map pin.
  let lat: number | null = null;
  let lng: number | null = null;
  const existing = id
    ? (await db.from("events").select("location, lat, lng").eq("id", id).maybeSingle()).data
    : null;
  if (existing) {
    lat = existing.lat;
    lng = existing.lng;
  }
  if (location && location.trim() !== (existing?.location ?? "").trim()) {
    const geocoded = await geocodeAddress(location);
    if (geocoded) {
      lat = geocoded.lat;
      lng = geocoded.lng;
    }
  }

  const values = {
    title,
    starts_on,
    ends_on: String(formData.get("ends_on") ?? "") || null,
    starts_time: String(formData.get("starts_time") ?? "") || null,
    location,
    lat,
    lng,
    link: String(formData.get("link") ?? "") || null,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    member_id: String(formData.get("member_id") ?? "") || null,
    industry_id: Number(formData.get("industry_id")) || null,
    type: isEventType(type) ? type : null,
    updated_at: new Date().toISOString(),
    ...(cover_path ? { cover_path } : {}),
  };

  let eventId = id;
  if (id) {
    await db.from("events").update(values).eq("id", id);
  } else {
    const { data } = await db.from("events").insert({
      ...values,
      slug: `${slugify(title)}-${Date.now().toString(36)}`,
      status: "draft",
      source: "admin",
      submitted_by: user.userId,
    }).select("id").single();
    eventId = data!.id;
  }
  revalidatePath("/console/events");
  redirect(`/console/events/${eventId}`);
}

export async function decideEvent(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const reason = String(formData.get("reason") ?? "");
  const db = serviceDb();
  const { data: event } = await db.from("events").select("id, member_id, status").eq("id", id).single();
  if (!event || event.status !== "awaiting_approval") return;

  if (decision === "approve") {
    await db.from("events").update({ status: "published", updated_at: new Date().toISOString() }).eq("id", id);
    if (event.member_id) await enqueue("notify_member", { member_id: event.member_id, kind: "event_published", event_id: id });
  } else {
    await db.from("events").update({ status: "rejected", rejected_reason: reason, updated_at: new Date().toISOString() }).eq("id", id);
    if (event.member_id) await enqueue("notify_member", { member_id: event.member_id, kind: "event_rejected", event_id: id, reason });
  }
  await db.from("approvals").insert({ kind: "event", subject_id: id, decision: decision === "approve" ? "approved" : "rejected", reason: reason || null, decided_by: user.userId });
  revalidatePath("/console");
  revalidatePath("/console/events");
}

/**
 * Board/dropdown status moves for events (A1.10-style, mirroring moveStory).
 * Console-created events start at "draft" with no other code path to
 * "published" — this is that path, reusing the exact writes decideEvent's
 * approve branch and returnToDraft's event branch already perform.
 */
export async function moveEvent(input: { id: string; to: string }): Promise<{ ok: boolean; error?: string }> {
  const user = await requireConsole();
  const db = serviceDb();
  const { data: event } = await db.from("events").select("id, status, member_id").eq("id", input.id).single();
  if (!event) return { ok: false, error: "Event not found." };
  if (!canMoveEvent(event.status, input.to)) {
    return { ok: false, error: `Can't move a ${event.status} event straight to ${input.to}.` };
  }
  if (input.to === "published") {
    await db.from("events").update({ status: "published", updated_at: new Date().toISOString() }).eq("id", input.id);
    if (event.member_id) await enqueue("notify_member", { member_id: event.member_id, kind: "event_published", event_id: input.id });
    if (event.status === "awaiting_approval") {
      // mirror decideEvent's approve branch so the audit trail is identical
      // whether an operator clicked Approve or moved the card/dropdown.
      await db.from("approvals").insert({ kind: "event", subject_id: input.id, decision: "approved", reason: null, decided_by: user.userId });
    }
  } else {
    await db.from("events").update({ status: input.to, updated_at: new Date().toISOString() }).eq("id", input.id);
  }
  revalidatePath("/console");
  revalidatePath("/console/events");
  return { ok: true };
}

/** Keyboard/no-JS fallback for the events board — same shape as setStoryStatus. */
export async function setEventStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("status") ?? "");
  if (!id || !to) return;
  await moveEvent({ id, to });
  redirect("/console/events");
}

export async function decideRevision(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const approve = formData.get("decision") === "approve";
  const reason = String(formData.get("reason") ?? "");
  const db = serviceDb();
  const { data: rev } = await db.from("member_revisions").select("id, member_id, payload, status").eq("id", id).single();
  if (!rev || rev.status !== "awaiting_approval") return;
  if (approve) {
    // The member's form carries their web address now that it is shared with
    // the console editor, so approving one can rename them — and a rename has
    // to be handled exactly as saveMember handles it, or their inbound links
    // die quietly. Read the slug they have *now*, before the update below.
    const { data: current } = await db.from("members").select("slug").eq("id", rev.member_id).single();
    type MemberUpdate = import("@/lib/db/types").Database["public"]["Tables"]["members"]["Update"];
    const payload = { ...(rev.payload as MemberUpdate) };
    // revisions are member-authored and POST-reachable — never apply unsanitised markup
    if (typeof payload.description === "string") payload.description = renderableHtml(payload.description);
    // `service_ids` is not a members column — services are the join table
    // `member_services`. It rides in the payload because that is the only
    // channel a member's profile edit has, and is applied separately below.
    // Read it out *before* the deletes so the value survives.
    const raw = payload as Record<string, unknown>;
    const serviceIds = Array.isArray(raw.service_ids) ? raw.service_ids.map(Number).filter(Boolean) : null;
    delete raw.service_ids;
    // revisions written before a column was dropped may still carry its key;
    // applying one would fail on the missing column. 20260902000003 removed
    // testimonials, 20260909000002 renamed category_id to industry_id — both
    // migrations scrub the stored rows, this covers anything written between a
    // deploy and its migration.
    delete raw.testimonials;
    delete raw.category_id;

    // A slug clash would violate the unique index and fail the whole approval,
    // so drop the rename rather than lose the rest of the member's edit — Jas
    // sees the error and can settle the name with them separately.
    const newSlug = typeof payload.slug === "string" ? payload.slug : null;
    const renamed = Boolean(newSlug && current && newSlug !== current.slug);
    if (renamed && newSlug) {
      const { data: clash } = await db.from("members").select("id").eq("slug", newSlug).neq("id", rev.member_id).maybeSingle();
      if (clash) return memberFail(rev.member_id, `That member asked for the web address “${newSlug}”, which another member already uses. Approve it after settling the name.`);
    }

    await db.from("members").update(payload).eq("id", rev.member_id);
    // null, not [], for a revision written before services existed on the form:
    // that member's existing services must not be wiped by approving it.
    if (serviceIds) await replaceMemberServices(db, rev.member_id, serviceIds);
    // Same redirect bookkeeping saveMember does — a live member's old URL has
    // to keep resolving.
    if (renamed && newSlug && current) await recordRename(`/member/${current.slug}`, `/member/${newSlug}`);
    await db.from("member_revisions").update({ status: "published", decided_at: new Date().toISOString() }).eq("id", id);
    await enqueue("notify_member", { member_id: rev.member_id, kind: "page_changes_live", revision_id: id });
  } else {
    await db.from("member_revisions").update({ status: "rejected", rejected_reason: reason, decided_at: new Date().toISOString() }).eq("id", id);
    await enqueue("notify_member", { member_id: rev.member_id, kind: "page_changes_rejected", revision_id: id, reason });
  }
  await db.from("approvals").insert({ kind: "member_revision", subject_id: id, decision: approve ? "approved" : "rejected", reason: reason || null, decided_by: user.userId });
  revalidatePath("/console");
}

/* ---------- page layouts ---------- */

const PAGE_TYPES = ["story", "member_profile", "featured_machine", "static_page"] as const;

export async function saveLayout(formData: FormData) {
  await requireConsole();
  const pageType = String(formData.get("page_type")) as (typeof PAGE_TYPES)[number];
  const entityId = String(formData.get("entity_id") ?? "") || null;
  const qs = `type=${pageType}${entityId ? `&entity=${entityId}` : ""}`;
  if (!PAGE_TYPES.includes(pageType)) redirect(`/console/pages?${qs}&error=${encodeURIComponent("Unknown page type.")}`);
  let layout: unknown;
  try {
    layout = JSON.parse(String(formData.get("layout") ?? ""));
  } catch {
    redirect(`/console/pages?${qs}&error=${encodeURIComponent("Layout could not be read — try again.")}`);
  }
  const { validateLayout } = await import("@/lib/blocks/schema");
  const error = validateLayout(pageType, layout);
  if (error) redirect(`/console/pages?${qs}&error=${encodeURIComponent(error)}`);
  await serviceDb().from("page_layouts").upsert({
    page_type: pageType,
    entity_id: entityId,
    layout: layout as import("@/lib/db/types").Json,
    updated_at: new Date().toISOString(),
  }, { onConflict: "page_type,entity_id" });
  revalidatePath("/console/pages");
  redirect(`/console/pages?${qs}&saved=1`);
}

export async function resetLayout(formData: FormData) {
  await requireConsole();
  const pageType = String(formData.get("page_type")) as (typeof PAGE_TYPES)[number];
  if (!PAGE_TYPES.includes(pageType)) return;
  const entityId = String(formData.get("entity_id") ?? "") || null;
  let q = serviceDb().from("page_layouts").delete().eq("page_type", pageType);
  q = entityId ? q.eq("entity_id", entityId) : q.is("entity_id", null);
  await q;
  revalidatePath("/console/pages");
  redirect(`/console/pages?type=${pageType}${entityId ? `&entity=${entityId}` : ""}`);
}

/* ---------- featured machines ---------- */

export async function saveMachine(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const memberId = String(formData.get("member_id") ?? "");
  if (!name || !memberId) return; // seller attribution is required on the public page
  const db = serviceDb();
  const image = await uploadImage(formData.get("image") as File | null, "machines");
  const values = {
    name,
    member_id: memberId,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    external_url: String(formData.get("external_url") ?? "") || null,
    ...(image ? { image_path: image } : {}),
  };
  let machineId = id;
  if (id) {
    await db.from("featured_machines").update(values).eq("id", id);
  } else {
    const { data } = await db.from("featured_machines").insert({
      ...values,
      status: "published",
      source: "admin",
      submitted_by: user.userId,
    }).select("id").single();
    machineId = data!.id;
  }
  revalidatePath("/console/machines");
  redirect(`/console/machines/${machineId}`);
}

export async function decideMachine(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const approve = formData.get("decision") === "approve";
  const reason = String(formData.get("reason") ?? "");
  const db = serviceDb();
  const { data: machine } = await db.from("featured_machines").select("id, member_id, status").eq("id", id).single();
  if (!machine || machine.status !== "awaiting_approval") return;
  await db.from("featured_machines").update(
    approve ? { status: "published" } : { status: "rejected", rejected_reason: reason },
  ).eq("id", id);
  await db.from("approvals").insert({ kind: "machine", subject_id: id, decision: approve ? "approved" : "rejected", reason: reason || null, decided_by: user.userId });
  if (machine.member_id) {
    await enqueue("notify_member", { member_id: machine.member_id, kind: approve ? "machine_live" : "machine_rejected", machine_id: id, ...(approve ? {} : { reason }) });
  }
  revalidatePath("/console/machines");
  revalidatePath("/console");
}

export async function saveMachinePlacement(formData: FormData) {
  await requireConsole();
  const machineId = String(formData.get("machine_id"));
  const db = serviceDb();
  const { data: machine } = await db.from("featured_machines").select("member_id, status").eq("id", machineId).single();
  if (!machine || machine.status !== "published") return;
  await db.from("placements").insert({
    kind: "featured_machine",
    featured_machine_id: machineId,
    member_id: machine.member_id,
    starts_on: String(formData.get("starts_on")),
    ends_on: String(formData.get("ends_on")),
  });
  revalidatePath("/console/machines");
  revalidatePath("/featured-machine");
}

/**
 * Featured Member: a placements row directly (no featured_machines lookup —
 * unlike saveMachinePlacement, there is no separate "is this published" gate
 * here, since the member picker only lists active members).
 *
 * Cap enforcement is an app-level count check, not a DB exclusion constraint.
 * Unlike takeover (exactly one concurrent row, expressible as a GiST
 * exclusion — placements_takeover_no_overlap), Featured Member allows up to
 * FEATURED_SLOTS.cap concurrently, which a two-row exclusion cannot express.
 * This has a benign TOCTOU race between the count and the insert; acceptable
 * because Jas is the sole console user booking this today.
 */
export async function saveFeaturedMemberPlacement(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const memberId = String(formData.get("member_id"));
  const startsOn = String(formData.get("starts_on"));
  const endsOn = String(formData.get("ends_on"));

  const { count } = await db
    .from("placements")
    .select("id", { count: "exact", head: true })
    .eq("kind", "featured_member")
    .lte("starts_on", endsOn)
    .gte("ends_on", startsOn); // overlap test: any existing row whose term intersects the requested one

  if ((count ?? 0) >= FEATURED_SLOTS.cap) {
    redirect(`/console/adverts/featured-member?error=${encodeURIComponent(
      `Featured Member is full for those dates — max ${FEATURED_SLOTS.cap} at once.`,
    )}`);
  }

  const { error } = await db.from("placements").insert({ kind: "featured_member", member_id: memberId, starts_on: startsOn, ends_on: endsOn });
  if (error) redirect(`/console/adverts/featured-member?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/console/adverts");
  revalidatePath("/console/adverts/featured-member");
  revalidatePath("/console");
  revalidatePath("/");
}

/* ---------- adverts ---------- */

/**
 * An admin booking an advert is selling it, which is also approving it — there
 * is nobody else to ask. So it lands 'scheduled' with the approval stamped,
 * rather than sitting in a queue waiting for the person who just created it.
 */
export async function saveBooking(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const now = new Date().toISOString();
  const productId = String(formData.get("product_id") ?? "") || null;
  const { data: created, error } = await db.from("advert_bookings").insert({
    advert_id: String(formData.get("advert_id")),
    starts_on: String(formData.get("starts_on")),
    ends_on: String(formData.get("ends_on")),
    notes: String(formData.get("notes") ?? "") || null,
    product_id: productId,
    bundle_id: String(formData.get("bundle_id") ?? "") || null,
    status: "scheduled",
    source: "admin",
    submitted_by: user.userId,
    submitted_at: now,
    approved_by: user.userId,
    approved_at: now,
  }).select("id, advert:adverts(member_id)").single();
  // The overlap exclusion constraint is the likely rejection here: the same
  // artwork already has a run covering these dates.
  if (error) {
    redirect(`/console/adverts?error=${encodeURIComponent(
      error.message.includes("advert_bookings_no_overlap")
        ? "That advert already has a run covering those dates."
        : error.message,
    )}`);
  }
  // Invoice off the rate card if one was sold as a priced product; unpriced
  // products (rate_pennies null) skip invoicing here — Jas invoices manually,
  // same as any run booked without a product_id.
  if (productId && created?.advert?.member_id) {
    const { data: product } = await db.from("advert_products").select("rate_pennies").eq("id", productId).single();
    if (product?.rate_pennies) await raiseInvoice(created.advert.member_id, product.rate_pennies, "ADV");
  }
  revalidatePath("/console/adverts");
}

/**
 * Ending a run early. Never touches the dates.
 *
 * This used to write ends_on = yesterday, which destroyed the term needed for
 * invoicing and — for a run starting today — produced ends_on < starts_on,
 * violating the table's own check constraint. The error was discarded, so the
 * button appeared to work while the advert kept running.
 *
 * The status is what stops it now: terminal beats dates in the render
 * predicate, so it comes down immediately. `.in(...)` makes it idempotent —
 * a double submit cannot re-end an ended run.
 */
export async function endBooking(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const { data: booking } = await db
    .from("advert_bookings")
    .select("id, ends_on, advert:adverts(member_id)")
    .eq("id", id)
    .single();
  if (!booking) return;

  const now = new Date().toISOString();
  const { data: ended } = await db
    .from("advert_bookings")
    .update({
      status: "ended",
      ended_at: now,
      ended_by: user.userId,
      ended_reason: "ended_early",
      ended_note: String(formData.get("note") ?? "") || null,
      // stamped so the nightly sweep does not also send a renew prompt
      ended_notified_for: booking.ends_on,
      updated_at: now,
    })
    .eq("id", id)
    .in("status", ["scheduled", "live"])
    .select("id");

  if (ended?.length && booking.advert?.member_id) {
    await enqueue("notify_member", { member_id: booking.advert.member_id, kind: "advert_ended", booking_id: id });
  }
  revalidatePath("/console/adverts");
}

/* ---------- bundles ---------- */

export async function saveBundle(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id") ?? "");
  const member_id = String(formData.get("member_id"));
  const name = String(formData.get("name") ?? "").trim();
  const pricePounds = String(formData.get("price_pounds") ?? "").trim();
  if (!member_id || !name) return;
  const values = {
    member_id,
    name,
    price_pennies: pricePounds ? Math.round(Number(pricePounds) * 100) : null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
  if (id) {
    await db.from("bundles").update(values).eq("id", id);
    revalidatePath(`/console/adverts/bundles/${id}`);
    return;
  }
  const { data } = await db.from("bundles").insert(values).select("id").single();
  revalidatePath("/console/adverts/bundles");
  redirect(`/console/adverts/bundles/${data!.id}`);
}

/**
 * Book several existing pieces of artwork under one bundle_id in one atomic
 * insert, so an overlap on one part fails the whole batch rather than leaving
 * a half-booked bundle. Also invoices off the bundle's price if it has one —
 * never touches src/lib/adverts.ts, bundle_id/price are display/pricing-only
 * (the neutrality rule: no weight/priority/bid input may ever reach rotation).
 */
export async function saveBundleBooking(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const bundleId = String(formData.get("bundle_id"));
  const advertIds = formData.getAll("advert_ids").map(String);
  const startsOn = String(formData.get("starts_on"));
  const endsOn = String(formData.get("ends_on"));
  if (!advertIds.length) {
    redirect(`/console/adverts/bundles/${bundleId}?error=${encodeURIComponent("Pick at least one piece of artwork.")}`);
  }

  const { data: bundle } = await db.from("bundles").select("member_id, price_pennies").eq("id", bundleId).single();
  // Invoice once per bundle, at whichever booking is the first — not once per
  // "add more parts later" call, or a bundle with 3 add-part sessions would
  // raise 3 full-price invoices.
  const { count: existingParts } = await db.from("advert_bookings").select("id", { count: "exact", head: true }).eq("bundle_id", bundleId);
  const now = new Date().toISOString();
  const { error } = await db.from("advert_bookings").insert(advertIds.map((advert_id) => ({
    advert_id,
    bundle_id: bundleId,
    starts_on: startsOn,
    ends_on: endsOn,
    status: "scheduled",
    source: "admin",
    submitted_by: user.userId,
    submitted_at: now,
    approved_by: user.userId,
    approved_at: now,
  })));
  if (error) {
    redirect(`/console/adverts/bundles/${bundleId}?error=${encodeURIComponent(
      error.message.includes("advert_bookings_no_overlap")
        ? "One of these pieces already has a run covering those dates — the whole batch was not booked."
        : error.message,
    )}`);
  }
  if (!existingParts && bundle?.member_id && bundle.price_pennies) {
    await raiseInvoice(bundle.member_id, bundle.price_pennies, "ADV");
  }
  revalidatePath("/console/adverts");
  revalidatePath(`/console/adverts/bundles/${bundleId}`);
}

/** Approve a member-submitted run, or send it back with a reason they can read. */
export async function decideAdvertBooking(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const reason = String(formData.get("reason") ?? "").trim();
  const db = serviceDb();
  const { data: booking } = await db
    .from("advert_bookings")
    .select("id, status, advert:adverts(member_id), product:advert_products(rate_pennies)")
    .eq("id", id)
    .single();
  // same idempotency guard as decideStory/decideVideo/decideEvent
  if (!booking || booking.status !== "awaiting_approval") return;
  // the DB enforces this too; catching it here keeps the redirect friendly
  if (decision !== "approve" && !reason) {
    redirect(`/console/adverts/${id}?error=${encodeURIComponent("Give the member a reason for the change.")}`);
  }

  const now = new Date().toISOString();
  const memberId = booking.advert?.member_id;
  if (decision === "approve") {
    const { error } = await db.from("advert_bookings")
      .update({ status: "scheduled", approved_by: user.userId, approved_at: now, review_reason: null, updated_at: now })
      .eq("id", id);
    // The overlap exclusion constraint is the likely rejection here: another
    // booking on the same advert already covers these dates. Without this
    // check the code below would write an "approved" audit row and tell the
    // member their advert is scheduled while the booking is still stuck
    // awaiting_approval — a false record on top of a silent no-op.
    if (error) {
      redirect(`/console/adverts/${id}?error=${encodeURIComponent(
        error.message.includes("advert_bookings_no_overlap")
          ? "That advert already has a run covering those dates."
          : error.message,
      )}`);
    }
    if (memberId && booking.product?.rate_pennies) {
      await raiseInvoice(memberId, booking.product.rate_pennies, "ADV");
    }
    if (memberId) await enqueue("notify_member", { member_id: memberId, kind: "advert_scheduled", booking_id: id });
  } else {
    const { error } = await db.from("advert_bookings")
      .update({ status: "review_required", review_reason: reason, updated_at: now })
      .eq("id", id);
    if (error) redirect(`/console/adverts/${id}?error=${encodeURIComponent(error.message)}`);
    if (memberId) await enqueue("notify_member", { member_id: memberId, kind: "advert_changes_needed", booking_id: id, reason });
  }
  await db.from("approvals").insert({
    kind: "advert_booking",
    subject_id: id,
    decision: decision === "approve" ? "approved" : "rejected",
    reason: reason || null,
    decided_by: user.userId,
  });
  revalidatePath("/console");
  revalidatePath("/console/adverts");
}

/**
 * Rebook an ended run: same artwork, new dates. A fresh draft rather than a
 * reopened booking, so the finished run keeps its own record for invoicing.
 */
export async function renewBooking(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const { data: prev } = await db
    .from("advert_bookings")
    .select("advert_id, product_id, bundle_id, notes")
    .eq("id", id)
    .single();
  if (!prev) return;
  const { data: created, error } = await db.from("advert_bookings").insert({
    advert_id: prev.advert_id,
    product_id: prev.product_id,
    bundle_id: prev.bundle_id,
    notes: prev.notes,
    // dates are the point of a renewal, so they are filled in on the draft
    starts_on: String(formData.get("starts_on")),
    ends_on: String(formData.get("ends_on")),
    status: "draft",
    source: "admin",
    renewed_from: id,
    submitted_by: user.userId,
  }).select("id").single();
  // Previously silent: an admin picking an invalid date range (e.g. ends_on
  // before starts_on) got no feedback and the page just re-rendered as if
  // nothing had been clicked.
  if (error) redirect(`/console/adverts/${id}?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/console/adverts");
  if (created) redirect(`/console/adverts/${created.id}`);
}

/** The artwork itself — name, format, link and the two images. */
export async function saveAdvertArtwork(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  const db = serviceDb();
  const name = String(formData.get("name") ?? "").trim();
  const member_id = String(formData.get("member_id") ?? "");
  const format = String(formData.get("format") ?? "");
  if (!name || !member_id || !format) return;

  let desktop_path: string | null = null;
  let mobile_path: string | null = null;
  try {
    // "panels" not "adverts": the public bucket path is in the URL, and
    // /adverts/ is an ad-blocker filename heuristic — see visit/[id]/route.ts.
    desktop_path = await uploadImage(formData.get("desktop") as File | null, "panels");
    mobile_path = await uploadImage(formData.get("mobile") as File | null, "panels");
  } catch (e) {
    redirect(`/console/adverts/artwork/${id || "new"}?error=${encodeURIComponent(e instanceof Error ? e.message : "Artwork upload failed.")}`);
  }

  const values = {
    name,
    member_id,
    format,
    link_url: String(formData.get("link_url") ?? "").trim() || null,
    updated_at: new Date().toISOString(),
    ...(desktop_path ? { desktop_path } : {}),
    ...(mobile_path ? { mobile_path } : {}),
  };

  if (id) {
    await db.from("adverts").update(values).eq("id", id);
  } else {
    // both images are NOT NULL, so a new advert cannot be created without them
    if (!desktop_path || !mobile_path) {
      redirect(`/console/adverts/artwork/new?error=${encodeURIComponent("Both a desktop and a mobile image are required.")}`);
    }
    await db.from("adverts").insert({ ...values, desktop_path, mobile_path });
  }
  revalidatePath("/console/adverts/artwork");
  redirect("/console/adverts/artwork");
}

/**
 * Admin proposing a swap on a member's behalf: fulfilling it, same reasoning
 * saveBooking already applies to bookings — there is nobody else to ask, so it
 * applies immediately. Recorded already-'approved' so the audit trail (and the
 * member-facing history) shows the same shape whoever raised it.
 */
export async function proposeArtworkSwap(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const advertId = String(formData.get("advert_id"));
  const bookingId = String(formData.get("booking_id") ?? "") || null;
  const back = bookingId ? `/console/adverts/${bookingId}` : `/console/adverts/artwork/${advertId}`;

  let desktop_path: string | null = null;
  let mobile_path: string | null = null;
  try {
    desktop_path = await uploadImage(formData.get("desktop") as File | null, "panels");
    mobile_path = await uploadImage(formData.get("mobile") as File | null, "panels");
  } catch (e) {
    redirect(`${back}?error=${encodeURIComponent(e instanceof Error ? e.message : "Artwork upload failed.")}`);
  }
  if (!desktop_path || !mobile_path) {
    redirect(`${back}?error=${encodeURIComponent("Both a desktop and a mobile image are required.")}`);
  }

  const now = new Date().toISOString();
  await db.from("adverts").update({ desktop_path, mobile_path, updated_at: now }).eq("id", advertId);
  const { data: proposal } = await db.from("advert_artwork_proposals").insert({
    advert_id: advertId,
    desktop_path,
    mobile_path,
    status: "approved",
    source: "admin",
    submitted_by: user.userId,
    submitted_at: now,
    decided_by: user.userId,
    decided_at: now,
  }).select("id").single();
  if (proposal) {
    await db.from("approvals").insert({ kind: "advert_artwork", subject_id: proposal.id, decision: "approved", decided_by: user.userId });
  }
  revalidatePath("/console/adverts");
  revalidatePath("/console/adverts/artwork");
  redirect(bookingId ? back : "/console/adverts/artwork");
}

/** Approve a member-proposed swap, or send it back with a reason they can read. */
export async function decideArtworkSwap(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const reason = String(formData.get("reason") ?? "").trim();
  const db = serviceDb();
  const { data: proposal } = await db
    .from("advert_artwork_proposals")
    .select("id, advert_id, desktop_path, mobile_path, status, advert:adverts(member_id)")
    .eq("id", id)
    .single();
  if (!proposal || proposal.status !== "pending") return;
  if (decision !== "approve" && !reason) {
    redirect(`/console/adverts/artwork/${proposal.advert_id}?error=${encodeURIComponent("Give the member a reason for the change.")}`);
  }

  const now = new Date().toISOString();
  const memberId = proposal.advert?.member_id;
  if (decision === "approve") {
    // the live image only changes here, at approval — never at submission
    const { error: artworkError } = await db.from("adverts")
      .update({ desktop_path: proposal.desktop_path, mobile_path: proposal.mobile_path, updated_at: now })
      .eq("id", proposal.advert_id);
    if (artworkError) redirect(`/console/adverts/artwork/${proposal.advert_id}?error=${encodeURIComponent(artworkError.message)}`);
    const { error } = await db.from("advert_artwork_proposals")
      .update({ status: "approved", decided_by: user.userId, decided_at: now, updated_at: now })
      .eq("id", id);
    if (error) redirect(`/console/adverts/artwork/${proposal.advert_id}?error=${encodeURIComponent(error.message)}`);
    if (memberId) await enqueue("notify_member", { member_id: memberId, kind: "advert_artwork_approved", advert_id: proposal.advert_id });
  } else {
    const { error } = await db.from("advert_artwork_proposals")
      .update({ status: "rejected", review_reason: reason, decided_by: user.userId, decided_at: now, updated_at: now })
      .eq("id", id);
    if (error) redirect(`/console/adverts/artwork/${proposal.advert_id}?error=${encodeURIComponent(error.message)}`);
    if (memberId) await enqueue("notify_member", { member_id: memberId, kind: "advert_artwork_rejected", advert_id: proposal.advert_id, reason });
  }
  await db.from("approvals").insert({
    kind: "advert_artwork",
    subject_id: id,
    decision: decision === "approve" ? "approved" : "rejected",
    reason: reason || null,
    decided_by: user.userId,
  });
  revalidatePath("/console");
  revalidatePath("/console/adverts");
  revalidatePath("/console/adverts/artwork");
}

export async function saveAdvertProduct(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  const db = serviceDb();
  const short_name = String(formData.get("short_name") ?? "").trim();
  const format = String(formData.get("format") ?? "");
  const cap = Math.max(1, Number(formData.get("cap") ?? 1));
  if (!short_name || !format) return;

  let sample_path: string | null = null;
  try {
    sample_path = await uploadImage(formData.get("sample") as File | null, "advert-products");
  } catch (e) {
    redirect(`/console/adverts/spots/${id || "new"}?error=${encodeURIComponent(e instanceof Error ? e.message : "Sample upload failed.")}`);
  }

  const ratePounds = String(formData.get("rate_pounds") ?? "").trim();
  const rate_pennies = ratePounds ? Math.round(Number(ratePounds) * 100) : null;

  const values = {
    short_name,
    format,
    cap,
    rate_pennies,
    description: String(formData.get("description") ?? "").trim() || null,
    updated_at: new Date().toISOString(),
    ...(sample_path ? { sample_path } : {}),
  };

  if (id) {
    await db.from("advert_products").update(values).eq("id", id);
  } else {
    await db.from("advert_products").insert(values);
  }
  revalidatePath("/console/adverts/spots");
  redirect("/console/adverts/spots");
}

/**
 * Archive rather than delete once a booking references the product: the record
 * of what a run was sold as has to survive, and the FK is ON DELETE RESTRICT so
 * a hard delete would fail anyway. Unreferenced products delete outright.
 */
export async function deleteAdvertProduct(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const { count } = await db
    .from("advert_bookings")
    .select("*", { count: "exact", head: true })
    .eq("product_id", id);
  if (count) {
    await db.from("advert_products").update({ archived_at: new Date().toISOString() }).eq("id", id);
  } else {
    await db.from("advert_products").delete().eq("id", id);
  }
  revalidatePath("/console/adverts/spots");
}

/** Slot caps are Jas's to set — inventory guidance, never a rotation input. */
export async function saveSlotCap(formData: FormData) {
  await requireConsole();
  const key = String(formData.get("key"));
  const cap = Math.max(0, Number(formData.get("cap") ?? 0));
  await serviceDb().from("advert_slots").update({ cap }).eq("key", key);
  revalidatePath("/console/adverts");
}

/** Turn a member's expression of interest into a draft run for Jas to fill in. */
export async function startAdvertFromInterest(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const amountPounds = Number(formData.get("amount_pounds") ?? 0);
  const { data: request } = await db
    .from("visibility_requests")
    .select("id, member_id, product")
    .eq("id", id)
    .single();
  if (!request) return;
  await db.from("visibility_requests").update({ status: "confirmed" }).eq("id", id);
  // The member asked for this and was previously told nothing either way (A2.6).
  if (request.member_id) {
    await enqueue("notify_member", { member_id: request.member_id, kind: "visibility_confirmed", request_id: id });
    // visibility_requests has no product_id/rate to invoice off automatically
    // (just a free-text product column) — Jas quotes the amount at confirm time.
    if (amountPounds > 0) await raiseInvoice(request.member_id, Math.round(amountPounds * 100), "VIS");
  }
  revalidatePath("/console/adverts/interest");
  // No artwork yet — that is the whole point of the interest route, so this
  // lands on the artwork form with the member prefilled.
  redirect(`/console/adverts/artwork/new?member_id=${request.member_id}&from=interest`);
}

/** The advertising media pack — a PDF readers download from /advertising. */
export async function saveMediaPack(formData: FormData) {
  await requireConsole();
  let path: string | null = null;
  try {
    path = await uploadDocument(formData.get("pack") as File | null, "media-pack");
  } catch (e) {
    redirect(`/console/adverts/spots?error=${encodeURIComponent(e instanceof Error ? e.message : "Upload failed.")}`);
  }
  if (!path) return;
  await serviceDb().from("settings").upsert({ key: "media_pack", value: { path, updated_at: new Date().toISOString() } });
  revalidatePath("/console/adverts/spots");
  revalidatePath("/advertising");
}

export async function saveAdvertFormats(formData: FormData) {
  await requireConsole();
  // Validate before the settings read and the uploads — invalid input must
  // touch neither the database nor the bucket (same rule as saveStory's
  // canWrite-before-upload).
  const fields = AD_FORMAT_KEYS.map((key) => ({
    key,
    name: String(formData.get(`name_${key}`) ?? "").trim(),
    detail: String(formData.get(`detail_${key}`) ?? "").trim(),
  }));
  if (fields.some((f) => !f.name || !f.detail)) return;
  const db = serviceDb();
  // Empty file inputs keep the stored example images, so read the current value to merge.
  const { data: existing } = await db.from("settings").select("value").eq("key", "advert_formats").maybeSingle();
  const currentByKey = new Map(((existing?.value as AdFormat[] | null) ?? []).map((f) => [f.key, f]));
  let value: AdFormat[];
  try {
    value = await Promise.all(
      fields.map(async (f): Promise<AdFormat> => {
        const uploaded = await uploadImage(formData.get(`example_${f.key}`) as File | null, "advert-formats");
        const example_path = uploaded ?? currentByKey.get(f.key)?.example_path;
        return { ...f, ...(example_path ? { example_path } : {}) };
      }),
    );
  } catch (e) {
    redirect(`/console/adverts/spots?error=${encodeURIComponent(e instanceof Error ? e.message : "Upload failed.")}`);
  }
  await db.from("settings").upsert({ key: "advert_formats", value });
  revalidatePath("/console/adverts/spots");
  revalidatePath("/advertising");
}

export async function saveSocialCaps(formData: FormData) {
  await requireConsole();
  const value: SocialCaps = {
    per_day: Math.max(1, Number(formData.get("per_day") ?? DEFAULT_SOCIAL_CAPS.per_day)),
    delay_minutes: Math.max(0, Number(formData.get("delay_minutes") ?? DEFAULT_SOCIAL_CAPS.delay_minutes)),
  };
  await serviceDb().from("settings").upsert({ key: "social_caps", value });
  revalidatePath("/console/stories");
}

/**
 * GAPS B4.4: which Buffer-connected channels auto-posts go to. Buffer's GraphQL
 * API takes one `channelId` per mutation, so this list is what the publisher
 * fans out over. Writing channel ids here also clears any stale v1 `profileIds`
 * left in the row, since the upsert replaces the whole value.
 */
export async function saveSocialChannels(formData: FormData) {
  await requireConsole();
  const channelIds = String(formData.get("channel_ids") ?? "")
    .split(/[\n,]/)
    .map((id) => id.trim())
    .filter(Boolean);
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const value: SocialChannels = { channelIds, ...(organizationId ? { organizationId } : {}) };
  await serviceDb().from("settings").upsert({ key: "social_channels", value });
  revalidatePath("/console/stories");
}

/**
 * Homepage takeover (V17/A12): one advertiser's colour + banner across the
 * public site for a paid period. Same date-driven pattern as every other
 * placement — no job flips it live or ends it, activeTakeover() just reads
 * the dates. The overlap exclusion constraint (placements_takeover_no_overlap)
 * stops two clients' colours ever being booked over the same days.
 */
export async function saveTakeoverPlacement(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const member_id = String(formData.get("member_id"));
  const hex = String(formData.get("hex") ?? "").trim();
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    redirect(`/console/adverts/takeover?error=${encodeURIComponent("Enter a 6-digit hex colour, e.g. #ac5800.")}`);
  }
  // Checked against the site's own paper background — the takeover banner and
  // top-of-page chrome sit on white, same pairing globals.css documents for brand.
  if (!meetsWcagAA(hex, "#ffffff", { largeText: true })) {
    redirect(`/console/adverts/takeover?error=${encodeURIComponent("That colour is too close to white to read — it needs at least 3:1 contrast (WCAG AA, large text/UI).")}`);
  }

  let banner_path: string | null = null;
  try {
    banner_path = await uploadImage(formData.get("banner") as File | null, "takeovers");
  } catch (e) {
    redirect(`/console/adverts/takeover?error=${encodeURIComponent(e instanceof Error ? e.message : "Banner upload failed.")}`);
  }
  if (!banner_path) {
    redirect(`/console/adverts/takeover?error=${encodeURIComponent("A banner image is required.")}`);
  }

  const { error } = await db.from("placements").insert({
    kind: "takeover",
    member_id,
    config: { hex, banner_path },
    starts_on: String(formData.get("starts_on")),
    ends_on: String(formData.get("ends_on")),
  });
  if (error) {
    redirect(`/console/adverts/takeover?error=${encodeURIComponent(
      error.message.includes("placements_takeover_no_overlap")
        ? "Another takeover already covers those dates — only one can run at a time."
        : error.message,
    )}`);
  }
  revalidatePath("/console/adverts");
  revalidatePath("/console/adverts/takeover");
  revalidatePath("/");
}

export async function declineInterest(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") ?? "");
  const { data: request } = await db
    .from("visibility_requests")
    .select("id, member_id")
    .eq("id", id)
    .single();
  await db.from("visibility_requests").update({ status: "declined" }).eq("id", id);
  // A decline is still an answer — the member is owed one either way (A2.6).
  if (request?.member_id) {
    await enqueue("notify_member", { member_id: request.member_id, kind: "visibility_declined", request_id: id, reason });
  }
  revalidatePath("/console/adverts/interest");
}

/* ---------- newsletter ---------- */

/** Turns the composer's picked stories/videos into position-ordered newsletter_items rows, stories first. */
function newsletterItemRows(issueId: string, storyIds: string[], videoIds: string[]) {
  return [
    ...storyIds.map((story_id, i) => ({ issue_id: issueId, story_id, position: i })),
    ...videoIds.map((video_id, i) => ({ issue_id: issueId, video_id, position: storyIds.length + i })),
  ];
}

export async function createIssue(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const { data: last } = await db.from("newsletter_issues").select("number").order("number", { ascending: false }).limit(1).single();
  const number = (last?.number ?? 46) + 1;
  const subject = String(formData.get("subject") ?? `SMI Monthly — issue ${number}`);
  const { data } = await db.from("newsletter_issues").insert({
    number, subject, intro: String(formData.get("intro") ?? ""), web_slug: `issue-${number}`,
  }).select("id").single();
  const rows = newsletterItemRows(data!.id, formData.getAll("stories").map(String), formData.getAll("videos").map(String));
  if (rows.length) await db.from("newsletter_items").insert(rows);
  revalidatePath("/console/newsletter");
}

const ISSUE_EDITABLE_STATUSES = new Set(["draft", "scheduled", "send_failed"]);

/**
 * B5.3: no way to edit an issue after creation — subject/intro and the
 * story/video pick were locked in at createIssue and never revisitable.
 * Full replace of newsletter_items rather than a diff, matching createIssue's
 * own shape; the composer's picker is small enough that this is simpler than
 * reconciling adds/removes.
 */
export async function updateIssue(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id"));
  const { data: issue } = await db.from("newsletter_issues").select("status").eq("id", id).single();
  if (!issue || !ISSUE_EDITABLE_STATUSES.has(issue.status)) {
    redirect(`/console/newsletter/${id}?error=${encodeURIComponent("This issue can no longer be edited.")}`);
  }
  await db.from("newsletter_issues").update({
    subject: String(formData.get("subject") ?? ""),
    intro: String(formData.get("intro") ?? ""),
  }).eq("id", id);

  await db.from("newsletter_items").delete().eq("issue_id", id);
  const rows = newsletterItemRows(id, formData.getAll("stories").map(String), formData.getAll("videos").map(String));
  if (rows.length) await db.from("newsletter_items").insert(rows);

  revalidatePath(`/console/newsletter/${id}`);
  revalidatePath("/console/newsletter");
}

/**
 * newsletter_ads is dateless/statusless (PK just issue_id+advert_id), with no
 * link to advert_bookings or a rate card — attach/detach is the whole write
 * surface, one issue at a time. The PK also means a double-click race can't
 * duplicate a row.
 */
export async function attachNewsletterAd(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const issueId = String(formData.get("issue_id"));
  const advertId = String(formData.get("advert_id"));
  const { count } = await db.from("newsletter_ads").select("*", { count: "exact", head: true }).eq("issue_id", issueId);
  await db.from("newsletter_ads").insert({ issue_id: issueId, advert_id: advertId, position: count ?? 0 });
  revalidatePath(`/console/newsletter/${issueId}`);
}

export async function detachNewsletterAd(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const issueId = String(formData.get("issue_id"));
  const advertId = String(formData.get("advert_id"));
  await db.from("newsletter_ads").delete().eq("issue_id", issueId).eq("advert_id", advertId);
  revalidatePath(`/console/newsletter/${issueId}`);
}

export async function sendIssue(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id"));
  // Doubles as the retry for a failed send: clear the previous error and drop
  // back to draft so the board doesn't show a stale failure while it reruns.
  await serviceDb()
    .from("newsletter_issues")
    .update({ status: "draft", send_error: null })
    .eq("id", id)
    .eq("status", "send_failed");
  await enqueue("newsletter_send", { issue_id: id });
  revalidatePath("/console/newsletter");
  revalidatePath("/console");
}

export async function scheduleIssue(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id"));
  const when = String(formData.get("scheduled_at") ?? "");
  if (!when) return;
  const at = new Date(when);
  const db = serviceDb();
  await db.from("newsletter_issues").update({ status: "scheduled", scheduled_at: at.toISOString() }).eq("id", id);
  await enqueue("newsletter_send", { issue_id: id }, at);
  revalidatePath("/console/newsletter");
}

export async function unscheduleIssue(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id"));
  const db = serviceDb();
  // the pending job would otherwise still fire at the original time — reverting
  // the row to draft alone doesn't stop it, since the job's only guard is
  // "is it already sent" (src/lib/jobs.ts)
  await db.from("jobs").delete().eq("kind", "newsletter_send").eq("status", "pending").filter("payload->>issue_id", "eq", id);
  await db.from("newsletter_issues").update({ status: "draft", scheduled_at: null }).eq("id", id);
  revalidatePath("/console/newsletter");
}

/* ---------- CRM ---------- */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const contactsFail = (message: string): never =>
  redirect(`/console/crm?error=${encodeURIComponent(message)}`);

/** A19/A20 — edit a mirrored contact in place; changes write through to Bigin. */
export async function saveContact(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = serviceDb();
  const { data: contact } = await db.from("contacts")
    .select("id, email, subscribed, unsubscribed_at").eq("id", id).single();
  if (!contact) return;

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return contactsFail("That is not a valid email address.");
  if (email !== contact.email) {
    const { data: clash } = await db.from("contacts").select("id").eq("email", email).neq("id", id).maybeSingle();
    if (clash) return contactsFail(`${email} is already on another contact.`);
  }

  const choice = String(formData.get("newsletter") ?? "");
  if (!NEWSLETTER_CHOICES.includes(choice as NewsletterChoice)) return;
  const optIn = applyOptIn(contact, {
    newsletter: choice as NewsletterChoice,
    reOptIn: formData.get("re_opt_in") === "on",
  });

  const name = String(formData.get("name") ?? "").trim() || null;
  const company = String(formData.get("company") ?? "").trim() || null;
  // last_synced_at means "reconciled with Bigin", not "edited here" — leave it
  const { error } = await db.from("contacts").update({
    email, name, company,
    member_id: String(formData.get("member_id") ?? "") || null,
    ...optIn,
  }).eq("id", id);
  if (error) return contactsFail(error.code === "23505" ? `${email} is already on another contact.` : error.message);

  const { getCrmSync } = await import("@/lib/adapters/crm");
  await getCrmSync().pushContact({ email, name: name ?? undefined, company: company ?? undefined });
  revalidatePath("/console/crm");
  redirect("/console/crm?saved=1");
}

export async function addContact(formData: FormData) {
  await requireConsole();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return;
  const db = serviceDb();
  const { data: existing } = await db.from("contacts").select("id").eq("email", email).maybeSingle();
  if (!existing) {
    await db.from("contacts").insert({
      email,
      name: String(formData.get("name") ?? "") || null,
      company: String(formData.get("company") ?? "") || null,
      source: "console",
    });
    const { getCrmSync } = await import("@/lib/adapters/crm");
    await getCrmSync().pushContact({ email }); // write-through to Bigin
  }
  revalidatePath("/console/crm");
}

/* ---------- members ---------- */

const memberFail = (id: string, message: string): never =>
  redirect(`/console/members/${id}?error=${encodeURIComponent(message)}`);

/** The audit trail + member email that activation owes, wherever it came from. */
async function recordActivation(memberId: string, userId: string) {
  await serviceDb().from("approvals").insert({
    kind: "member_activation", subject_id: memberId, decision: "approved", decided_by: userId,
  });
  await enqueue("notify_member", { member_id: memberId, kind: "page_live" });
}

/** A17 — the full member record, editable by Jas without the revision queue. */
export async function saveMember(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = serviceDb();
  // explicit columns: select("*") would drag the search_tsv vector across the wire
  const { data: member } = await db.from("members")
    .select("id, slug, status, social, address, lat, lng").eq("id", id).single();
  if (!member) return;

  // uploadImage throws on >8MB and on storage errors; redirect() must stay
  // outside the try or its NEXT_REDIRECT gets swallowed as an upload failure
  let uploaded: { logo_path: string | null; hero_path: string | null };
  let uploadError: string | null = null;
  try {
    const [logo_path, hero_path] = await Promise.all([
      uploadImage(formData.get("logo") as File | null, `members/${id}`),
      uploadImage(formData.get("hero") as File | null, `members/${id}`),
    ]);
    uploaded = { logo_path, hero_path };
  } catch (e) {
    uploaded = { logo_path: null, hero_path: null };
    uploadError = e instanceof Error ? e.message : "Image upload failed.";
  }
  if (uploadError) return memberFail(id, uploadError);

  const result = memberValuesFromForm(formData, member, uploaded);
  if ("error" in result) return memberFail(id, result.error);
  const { values, activatingDraft } = result;

  // Same rule as the member's own save — the two run the same form, so they
  // must derive the map pin the same way. Previously only the member side
  // geocoded, so an operator saving a member with a new address and no typed
  // coordinates left them without a map.
  const coords = await resolveCoordinates(
    { lat: values.lat ?? null, lng: values.lng ?? null },
    member,
    String(values.address ?? ""),
  );
  values.lat = coords.lat;
  values.lng = coords.lng;

  const slug = values.slug!;
  const slugChanged = slug !== member.slug;
  if (slugChanged) {
    // a draft has no public URL to break; a live one needs the operator to mean it
    if (member.status !== "draft" && formData.get("confirm_slug") !== "on") {
      return memberFail(id, "Changing the web address of a live member breaks existing links — tick the confirmation to go ahead.");
    }
    const { data: clash } = await db.from("members").select("id").eq("slug", slug).neq("id", id).maybeSingle();
    if (clash) return memberFail(id, `The web address “${slug}” is already used by another member.`);
  }

  const { error } = await db.from("members").update(values).eq("id", id);
  if (error) {
    return memberFail(id, error.code === "23505" ? "That web address is already taken — choose another." : error.message);
  }

  // Membership types (GAPS A8.1) live in a join table, not a members column —
  // synced separately from the plain update above, same shape as story_categories.
  const membershipTypeIds = formData.getAll("membership_types").map(Number).filter(Boolean);
  const { error: clearErr } = await db.from("member_membership_types").delete().eq("member_id", id);
  if (clearErr) return memberFail(id, clearErr.message);
  if (membershipTypeIds.length) {
    const { error: linkErr } = await db
      .from("member_membership_types")
      .insert(membershipTypeIds.map((membership_type_id) => ({ member_id: id, membership_type_id })));
    if (linkErr) return memberFail(id, linkErr.message);
  }

  // Services, the same way — the console had no way to edit these at all until
  // the two member forms were merged (GO-LIVE §3.2).
  try {
    await replaceMemberServices(db, id, formData.getAll("services").map(Number).filter(Boolean));
  } catch (e) {
    return memberFail(id, e instanceof Error ? e.message : "Could not save services.");
  }

  if (slugChanged && member.status !== "draft") {
    // keep inbound links and search results working — honoured by /member/[slug].
    // recordRename also clears the reverse row, so renaming back doesn't leave
    // two rows pointing at each other (see lib/redirects).
    await recordRename(`/member/${member.slug}`, `/member/${slug}`);
  }
  if (activatingDraft) await recordActivation(id, user.userId);

  revalidatePath("/console/members");
  revalidatePath("/console");
  redirect(`/console/members/${id}?saved=1`);
}

/**
 * A17 — Jas onboards a member who signed up by phone. Same provisioning as the
 * public join flow, minus the funnel notifications: Jas is the actor here.
 */
export async function createMember(formData: FormData) {
  await requireConsole();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const company = String(formData.get("company") ?? "").trim();

  const newFail = (message: string): never =>
    redirect(`/console/members/new?error=${encodeURIComponent(message)}`);
  if (!EMAIL_RE.test(email)) return newFail("Please enter a valid email.");
  if (password.length < 8) return newFail("Password needs at least 8 characters.");
  if (!company) return newFail("Company name is required.");

  const { provisionMember } = await import("@/lib/membership");
  const result = await provisionMember({ email, password, company });
  if ("error" in result) {
    // provisionMember's copy addresses the member ("try logging in") — the
    // admin needs a different next step, so rewrite it here rather than there
    return newFail(/already exists/i.test(result.error)
      ? "An account with that email already exists — find them in the members list, or use a different address."
      : result.error);
  }

  // Jas is usually on the phone to them, so the typed password stays — it gets
  // them in right now. This is the durable half: the member is told the account
  // exists and can set a password only they know. The link is emailed directly
  // rather than queued, so a credential-equivalent never sits in the
  // `notifications` payload for anyone with console access to read.
  const invited = await sendAccountInvite(email);

  revalidatePath("/console/members");
  revalidatePath("/console");
  redirect(`/console/members/${result.memberId}?created=1${invited ? "" : "&invite=failed"}`);
}

/**
 * Emails a new member a set-your-own-password link. Returns false if it could
 * not be sent, so the caller can tell Jas to pass the details on by phone
 * instead — a silently undelivered invite is how someone ends up with an
 * account they never learn about.
 */
async function sendAccountInvite(email: string): Promise<boolean> {
  try {
    const { data, error } = await serviceDb().auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${siteUrl()}/reset/confirm` },
    });
    const link = data?.properties?.action_link;
    if (error || !link) return false;

    const { getEmailSender } = await import("@/lib/adapters/email");
    const { renderNotification } = await import("@/lib/email/templates");
    const { loadEmailTemplates } = await import("@/lib/email/store");
    await getEmailSender().send({
      to: email,
      ...renderNotification({ kind: "account_created", action_link: link }, await loadEmailTemplates()),
    });
    return true;
  } catch (e) {
    console.error("[console] account invite failed:", e);
    return false;
  }
}

/**
 * A17 — record an offline payment or a comp. Goes through applyPaymentResult so
 * a manually-taken payment raises the same invoice a self-serve one does and
 * shows up under the member's Billing tab.
 */
export async function recordMemberPayment(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const months = Number(formData.get("months") || 0);
  const comping = String(formData.get("kind")) === "comped";
  if (comping && (!Number.isInteger(months) || months < 1 || months > 60)) {
    return memberFail(id, "Comp length must be a whole number of months (1–60).");
  }

  const { applyPaymentResult } = await import("@/lib/membership");
  await applyPaymentResult(id, comping ? { kind: "comped", months } : { kind: "paid" });
  revalidatePath("/console/members");
  revalidatePath("/console");
  redirect(`/console/members/${id}?saved=1`);
}

export async function setMemberStatus(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as MemberStatus;
  if (!MEMBER_STATUSES.includes(status)) return;
  const db = serviceDb();
  const { data: member } = await db.from("members").select("status, paid_at, comped_until").eq("id", id).single();
  if (!member) return;

  // V13 step 4 — activating a new member requires payment first (form is POSTable directly)
  if (activationBlocked(member, { status, paid_at: member.paid_at, comped_until: member.comped_until })) return;

  await db.from("members").update({ status }).eq("id", id);
  if (member.status === "draft" && status === "active") await recordActivation(id, user.userId);
  revalidatePath("/console/members");
  revalidatePath("/console");
}

/* ---------- inbox ---------- */

/**
 * Clear the whole unread queue (fix list). Scoped to the kind currently being
 * filtered on, so "mark all read" while looking at Advertising does not also
 * silently clear the Contact messages the operator has not seen — the button
 * only ever clears what is on screen.
 */
export async function markAllInboxRead(formData: FormData) {
  await requireConsole();
  const kind = String(formData.get("kind") ?? "");
  let q = serviceDb().from("inbox_messages").update({ read: true }).eq("read", false);
  if (kind) q = q.eq("kind", kind);
  await q;
  revalidatePath("/console");
  revalidatePath("/console/messages");
}

export async function markInboxRead(formData: FormData) {
  await requireConsole();
  // existing callers (the overview card) omit "read" and always mean "mark read"
  const read = formData.get("read") !== "0";
  await serviceDb().from("inbox_messages").update({ read }).eq("id", String(formData.get("id")));
  revalidatePath("/console");
  revalidatePath("/console/messages");
  // Optional bounce — the message detail page marks itself read on render, so
  // its "mark unread" must land back on the list or it would undo itself.
  const next = safeInternalPath(formData.get("next"));
  if (next) redirect(next);
}

/** Admin reply to an inbox enquiry, sent via the same adapter as every other outgoing mail. */
export async function replyToInboxMessage(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id"));
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!subject || !body) redirect(`/console/messages/${id}?error=${encodeURIComponent("Subject and message are required.")}`);

  const db = serviceDb();
  const { data: m } = await db.from("inbox_messages").select("email").eq("id", id).single();
  if (!m) redirect(`/console/messages/${id}?error=${encodeURIComponent("Message not found.")}`);

  try {
    const { getEmailSender } = await import("@/lib/adapters/email");
    await getEmailSender().send({ to: m.email, subject, text: body });
  } catch (e) {
    console.error("[console] inbox reply failed:", e);
    redirect(`/console/messages/${id}?error=${encodeURIComponent("Could not send — the mail provider rejected it. Try again.")}`);
  }

  revalidatePath(`/console/messages/${id}`);
  redirect(`/console/messages/${id}?replied=1`);
}

/* ---------- media library ---------- */

export async function renameMedia(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await serviceDb()
    .from("media")
    .update({
      original_name: String(formData.get("original_name") ?? "").trim() || null,
      alt_text: String(formData.get("alt_text") ?? "").trim() || null,
    })
    .eq("id", id);
  revalidatePath("/console/media");
}

export async function deleteMedia(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  const path = String(formData.get("path") ?? "");
  if (!id || !path || formData.get("confirm") !== "1") return;
  await removeMedia(path);
  revalidatePath("/console/media");
}

/* ---------- content pages ---------- */

/**
 * Create or update a standalone page (About, Policies, the MACH magazine page…).
 *
 * Until now `static_pages` had no writer anywhere in the app — the four rows in
 * it came from scripts/seed.ts, so changing a word of the About page meant a
 * reseed. This is that missing surface. Note it is NOT /console/pages, which
 * arranges blocks; this one owns the words.
 */
export async function saveContentPage(formData: FormData) {
  await requireConsole();

  const originalSlug = String(formData.get("original_slug") ?? "").trim();
  const isNew = !originalSlug;
  const title = String(formData.get("title") ?? "").trim();
  const slug = slugify(String(formData.get("slug") ?? "") || title);
  const body = sanitizeRichText(String(formData.get("body") ?? ""));
  const collapsible = formData.get("collapsible") === "on";

  const fail = (message: string): never =>
    redirect(`/console/content-pages/${isNew ? "new" : originalSlug}?error=${encodeURIComponent(message)}`);
  if (!title) return fail("Give the page a title.");
  if (!slug) return fail("That title has no letters or numbers in it — add a web address by hand.");

  const db = serviceDb();
  const { data: clash } = await db.from("static_pages").select("slug").eq("slug", slug).maybeSingle();
  if (clash && slug !== originalSlug) return fail(`The web address “${slug}” is already used by another page.`);

  if (isNew) {
    const { error } = await db.from("static_pages").insert({ slug, title, body, collapsible });
    if (error) return fail(error.message);
  } else {
    const { error } = await db
      .from("static_pages")
      .update({ slug, title, body, collapsible, updated_at: new Date().toISOString() })
      .eq("slug", originalSlug);
    if (error) return fail(error.message);
    if (slug !== originalSlug) {
      // Same contract as the member rename: keep the old URL working, and let
      // recordRename clear the reverse row so renaming back cannot build a loop.
      await recordRename(`/pages/${originalSlug}`, `/pages/${slug}`);
    }
  }

  revalidatePath(`/pages/${slug}`);
  revalidatePath("/console/content-pages");
  redirect(`/console/content-pages/${slug}?saved=1`);
}

export async function deleteContentPage(formData: FormData) {
  await requireConsole();
  const slug = String(formData.get("slug") ?? "");
  if (!slug) return;
  await serviceDb().from("static_pages").delete().eq("slug", slug);
  revalidatePath("/console/content-pages");
  redirect("/console/content-pages?deleted=1");
}

/* ---------- news categories ---------- */

export async function saveCategory(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const slug = slugify(String(formData.get("slug") ?? "").trim() || name);
  const db = serviceDb();

  if (id) {
    await db.from("categories").update({ name, slug }).eq("id", Number(id));
  } else {
    const { error } = await db.from("categories").insert({ name, slug });
    if (error) {
      redirect(
        `/console/categories/new?error=${encodeURIComponent(
          error.code === "23505" ? "That slug is already used by another category." : error.message
        )}`
      );
    }
  }
  revalidatePath("/console/categories");
  revalidatePath("/news");
  redirect("/console/categories?saved=1");
}

export async function deleteCategory(formData: FormData) {
  await requireConsole();
  const id = Number(formData.get("id"));
  if (!id || formData.get("confirm") !== "1") {
    redirect(`/console/categories/${id}?error=${encodeURIComponent("Tick the confirm box to delete this category.")}`);
  }
  const { error } = await serviceDb().from("categories").delete().eq("id", id);
  if (error) {
    redirect(`/console/categories/${id}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/console/categories");
  revalidatePath("/news");
  redirect("/console/categories?deleted=1");
}

/* ---------- industries ---------- */

export async function saveIndustry(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const slug = slugify(String(formData.get("slug") ?? "").trim() || name);
  const sort_order = Number(formData.get("sort_order")) || 0;
  const db = serviceDb();

  if (id) {
    await db.from("industries").update({ name, slug, sort_order }).eq("id", Number(id));
  } else {
    const { error } = await db.from("industries").insert({ name, slug, sort_order });
    if (error) {
      redirect(
        `/console/industries/new?error=${encodeURIComponent(
          error.code === "23505" ? "That slug is already used by another industry." : error.message
        )}`
      );
    }
  }
  // The industry strip is in the public layout, so it renders on every public
  // page — revalidating just /console/industries would leave the site stale.
  revalidatePath("/console/industries");
  revalidatePath("/", "layout");
  redirect("/console/industries?saved=1");
}

export async function deleteIndustry(formData: FormData) {
  await requireConsole();
  const id = Number(formData.get("id"));
  if (!id || formData.get("confirm") !== "1") {
    redirect(`/console/industries/${id}?error=${encodeURIComponent("Tick the confirm box to delete this industry.")}`);
  }
  const { error } = await serviceDb().from("industries").delete().eq("id", id);
  if (error) {
    redirect(
      `/console/industries/${id}?error=${encodeURIComponent(
        error.code === "23503"
          ? "This industry is still assigned to a member, story, video or event — reassign them first."
          : error.message
      )}`
    );
  }
  revalidatePath("/console/industries");
  revalidatePath("/", "layout");
  redirect("/console/industries?deleted=1");
}

/* ---------- promo codes ---------- */

export async function savePromoCode(formData: FormData) {
  await requireConsole();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  if (!code) return;
  const months = Number(formData.get("months") || 0);
  if (!Number.isInteger(months) || months < 1 || months > 60) {
    redirect(`/console/promo-codes?error=${encodeURIComponent("Months must be a whole number from 1 to 60.")}`);
  }
  const maxUsesRaw = String(formData.get("max_uses") ?? "").trim();
  const maxUses = maxUsesRaw ? Number(maxUsesRaw) : null;
  if (maxUsesRaw && (!Number.isInteger(maxUses) || (maxUses as number) < 1)) {
    redirect(`/console/promo-codes?error=${encodeURIComponent("Max uses must be a whole number, or left blank for unlimited.")}`);
  }
  const expiresAt = String(formData.get("expires_at") ?? "").trim() || null;

  const { error } = await serviceDb().from("promo_codes").insert({ code, months, max_uses: maxUses, expires_at: expiresAt });
  if (error) {
    redirect(`/console/promo-codes?error=${encodeURIComponent(
      error.code === "23505" ? "That code already exists." : error.message
    )}`);
  }
  revalidatePath("/console/promo-codes");
  redirect("/console/promo-codes?saved=1");
}

export async function setPromoCodeActive(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await serviceDb().from("promo_codes").update({ active: formData.get("active") === "1" }).eq("id", id);
  revalidatePath("/console/promo-codes");
}

/* ---------- member resources ---------- */

export async function saveResource(formData: FormData) {
  await requireConsole();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) redirect(`/console/resources?error=${encodeURIComponent("Choose a file to upload.")}`);
  const isPdf = file.type === "application/pdf";

  let path: string | null = null;
  try {
    path = isPdf ? await uploadDocument(file, "resources") : await uploadImage(file, "resources");
  } catch (e) {
    redirect(`/console/resources?error=${encodeURIComponent(e instanceof Error ? e.message : "Upload failed.")}`);
  }
  if (!path) redirect(`/console/resources?error=${encodeURIComponent("Upload failed.")}`);

  const { error } = await serviceDb().from("resources").insert({ title, path, kind: isPdf ? "document" : "image" });
  if (error) {
    await removeMedia(path);
    redirect(`/console/resources?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/console/resources");
  revalidatePath("/dashboard/resources");
  redirect("/console/resources?saved=1");
}

export async function deleteResource(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id || formData.get("confirm") !== "1") return;
  const { data: resource } = await serviceDb().from("resources").select("path").eq("id", id).single();
  await serviceDb().from("resources").delete().eq("id", id);
  if (resource?.path) await removeMedia(resource.path);
  revalidatePath("/console/resources");
  revalidatePath("/dashboard/resources");
  redirect("/console/resources?deleted=1");
}

/* ---------- dev board ---------- */

/** updated_at is stamped by hand — there is no trigger in this database, by convention. */

const devFail = (id: string, message: string): never =>
  redirect(`/console/dev/${id}?error=${encodeURIComponent(message)}`);

/** Mirrors the return_to allowlist at saveStory (line ~100) for /console/dev. */
function devBackTo(formData: FormData): string {
  const back = String(formData.get("return_to") ?? "");
  return /^\/console\/dev(\?[\w=&,%.-]*)?$/.test(back) ? back : "/console/dev";
}

/** Quick-add from a board column or the list view: title only, appended to the end of its column. */
export async function createDevTask(formData: FormData) {
  const user = await requireConsole();
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  if (!title) return;

  const statusRaw = String(formData.get("status") ?? "");
  const status: DevStatus = (DEV_STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as DevStatus) : "not_started";
  const assigneeRaw = String(formData.get("assignee") ?? "");
  const assignee = (DEV_ASSIGNEES as readonly string[]).includes(assigneeRaw) ? assigneeRaw : null;

  const db = serviceDb();
  const { data: last } = await db
    .from("dev_tasks")
    .select("sort_order")
    .eq("status", status)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  await db.from("dev_tasks").insert({
    title,
    status,
    assignee,
    created_by: user.userId,
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  revalidatePath("/console/dev");
}

/**
 * Detail-page form: insert or update. On success, returns to the filtered
 * board the caller came from — Save is a quick in-and-out edit, not a
 * dedicated editing session. On a validation error, re-renders the same
 * detail page instead, so a rejected edit doesn't lose the in-progress form.
 */
export async function saveDevTask(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id") ?? "");
  const parsed = devTaskValuesFromForm(formData);
  if ("error" in parsed) {
    redirect(`/console/dev/${id || "new"}?error=${encodeURIComponent(parsed.error)}`);
  }

  const db = serviceDb();
  if (id) {
    await db.from("dev_tasks").update({ ...parsed.values, updated_at: new Date().toISOString() }).eq("id", id);
  } else {
    const status = parsed.values.status ?? "not_started";
    const { data: last } = await db
      .from("dev_tasks")
      .select("sort_order")
      .eq("status", status)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    await db.from("dev_tasks").insert({ ...parsed.values, created_by: user.userId, sort_order: (last?.sort_order ?? -1) + 1 });
  }
  revalidatePath("/console/dev");
  const to = devBackTo(formData);
  redirect(`${to}${to.includes("?") ? "&" : "?"}saved=1`);
}

/** The card's status dropdown — the keyboard/no-JS path, and how a card leaves the board (via "canceled"). */
export async function setDevTaskStatus(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  const statusRaw = String(formData.get("status") ?? "");
  if (!id || !(DEV_STATUSES as readonly string[]).includes(statusRaw)) return;
  const status = statusRaw as DevStatus;

  const db = serviceDb();
  const { data: last } = await db
    .from("dev_tasks")
    .select("sort_order")
    .eq("status", status)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  await db
    .from("dev_tasks")
    .update({ status, sort_order: (last?.sort_order ?? -1) + 1, updated_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/console/dev");
}

export async function deleteDevTask(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  if (formData.get("confirm") !== "1") return devFail(id, "Tick the confirm box to delete this task.");
  await serviceDb().from("dev_tasks").delete().eq("id", id);
  revalidatePath("/console/dev");
  const to = devBackTo(formData);
  redirect(`${to}${to.includes("?") ? "&" : "?"}deleted=1`);
}

/**
 * Drag-and-drop persistence — a typed server action called directly from a
 * client component rather than FormData from a <form action=>. New for this
 * repo, but standard Next; the arguments are still attacker-controlled, so
 * every value is checked against the const arrays / real rows before use.
 * orderedIds is the full, dense id list of the destination column after the
 * move — every id in it belongs to `status` now. Concurrent per-row updates,
 * not a single upsert: upsert()'s types require every Insert-only column
 * (title included), which a reorder that only ever touches existing rows has
 * no business setting.
 */
export async function moveDevTask(input: { id: string; status: string; orderedIds: string[] }) {
  await requireConsole();
  if (!(DEV_STATUSES as readonly string[]).includes(input.status)) return;
  const status = input.status as DevStatus;

  const db = serviceDb();
  const { data: existing } = await db.from("dev_tasks").select("id").in("id", input.orderedIds);
  const validIds = new Set((existing ?? []).map((r) => r.id));
  const orderedIds = input.orderedIds.filter((id) => validIds.has(id));
  if (!orderedIds.includes(input.id)) return;

  await Promise.all(orderedIds.map((id, index) => db.from("dev_tasks").update({ status, sort_order: index }).eq("id", id)));
  revalidatePath("/console/dev");
}

/* ---------- lead gen ---------- */

/**
 * GAPS A8.3 / USE-CASES A29: mark a prospect to call, email, or add to a
 * sequence. The prospect itself lives in the `LeadGenSource` adapter, not our
 * database, so all that is persisted is the mark — see the adapter for why
 * Phase 1's source is a fixture.
 */
export async function markProspect(formData: FormData) {
  await requireConsole();
  const ref = String(formData.get("ref") ?? "").trim();
  const action = String(formData.get("action") ?? "");
  // The DB check constraint is the backstop, not the gate.
  if (!ref || !isProspectAction(action)) return;

  await getLeadGenSource().mark(ref, action, { memberId: null });

  const q = String(formData.get("q") ?? "");
  revalidatePath("/console/leads");
  // Back to the same search, rather than dumping the operator on an empty panel.
  redirect(`/console/leads?${q ? `${q}&` : ""}saved=1`);
}

/* ---------- email templates ---------- */

/**
 * Editing the copy of every email the site sends (fix-list 63).
 *
 * `email_templates` is an override table: a blank field is stored as null and
 * falls back to the copy shipped in `src/lib/email/defaults.ts`, so a kind
 * nobody has touched still picks up copy fixes made in code. "Reset to default"
 * is therefore a DELETE, not a re-write.
 */

const templateFail = (kind: string, message: string): never =>
  redirect(`/console/email-templates/${encodeURIComponent(kind)}?error=${encodeURIComponent(message)}`);

/** Blank means "fall back to the default", so it is stored as null rather than "". */
const orNull = (formData: FormData, field: string): string | null => {
  const value = String(formData.get(field) ?? "").trim();
  return value ? value : null;
};

export async function saveEmailTemplate(formData: FormData) {
  const user = await requireConsole();
  const kind = String(formData.get("kind") ?? "").trim();

  const { EDITABLE_KINDS, validateEmailTemplate } = await import("@/lib/email/templates");
  if (!EDITABLE_KINDS.includes(kind)) {
    redirect(`/console/email-templates?error=${encodeURIComponent("That email doesn't exist.")}`);
  }

  const fields = {
    subject: orNull(formData, "subject"),
    label: orNull(formData, "label"),
    body_html: orNull(formData, "body_html"),
    body_text: orNull(formData, "body_text"),
    cta_label: orNull(formData, "cta_label"),
  };

  // A mistyped token renders as literal braces in a member's inbox and the
  // person who typed it never finds out, so this refuses the save rather than
  // warning about it.
  const invalid = validateEmailTemplate(kind, fields);
  if (invalid) templateFail(kind, invalid);

  const { EMAIL_DEFAULTS } = await import("@/lib/email/defaults");
  const family = EMAIL_DEFAULTS[kind as keyof typeof EMAIL_DEFAULTS].family;

  const { error } = await serviceDb().from("email_templates").upsert({
    kind,
    family,
    ...fields,
    // Stamped by hand: no triggers in this database, by convention.
    updated_at: new Date().toISOString(),
    updated_by: user.userId,
  });
  if (error) templateFail(kind, error.message);

  revalidatePath("/console/email-templates");
  revalidatePath(`/console/email-templates/${kind}`);
  // The in-app notification feed reads its labels from the same row.
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/notifications");
  redirect(`/console/email-templates/${encodeURIComponent(kind)}?saved=1`);
}

export async function resetEmailTemplate(formData: FormData) {
  await requireConsole();
  const kind = String(formData.get("kind") ?? "").trim();
  if (!kind || formData.get("confirm") !== "1") {
    templateFail(kind, "Tick the confirm box to put this email back to its original wording.");
  }

  // Deleting the row IS the reset: with nothing stored, every field falls back
  // to the copy in src/lib/email/defaults.ts.
  const { error } = await serviceDb().from("email_templates").delete().eq("kind", kind);
  if (error) templateFail(kind, error.message);

  revalidatePath("/console/email-templates");
  revalidatePath(`/console/email-templates/${kind}`);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/notifications");
  redirect(`/console/email-templates/${encodeURIComponent(kind)}?reset=1`);
}

/**
 * Sends the logged-in admin a copy of this email, as it currently stands.
 *
 * Always to `user.email` and never to a typed address: a free-text recipient
 * field here would be an authenticated open relay on the SMI sending domain.
 */
export async function sendTestEmail(formData: FormData) {
  const user = await requireConsole();
  const kind = String(formData.get("kind") ?? "").trim();
  if (!user.email) templateFail(kind, "Your console account has no email address to send to.");

  const [{ getEmailSender }, { renderPreview }, { loadEmailTemplates }] = await Promise.all([
    import("@/lib/adapters/email"),
    import("@/lib/email/templates"),
    import("@/lib/email/store"),
  ]);

  const mail = renderPreview(kind, await loadEmailTemplates());
  try {
    // The sender throws on a provider rejection by design, so that a bad key or
    // an unverified domain is visible rather than silent.
    await getEmailSender().send({ to: user.email!, subject: `[Test] ${mail.subject}`, text: mail.text, html: mail.html });
  } catch (e) {
    templateFail(kind, e instanceof Error ? e.message : "The test email could not be sent.");
  }
  redirect(`/console/email-templates/${encodeURIComponent(kind)}?tested=1`);
}

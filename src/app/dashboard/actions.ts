"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { geocodeAddress } from "@/lib/adapters/geocode";
import { getLeadGenSource } from "@/lib/adapters/leadgen";
import { mediaUrl, serviceDb, sessionDb } from "@/lib/db/server";
import { isEventType } from "@/lib/event-types";
import { removeMedia, uploadImage } from "@/lib/media";
import { companyPageValuesFromForm } from "@/lib/member-form";
import { resolveCoordinates } from "@/lib/member-geocode";
import {
  membershipTypeIdsFromForm,
  membershipTypesError,
  replaceMemberMembershipTypes,
  replaceMemberServices,
} from "@/lib/member-services";
import { sanitizeRichText } from "@/lib/sanitize";
import { HOUR, withinLimit } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site-url";
import { EMAIL_RE } from "@/lib/validate";
import { optionalYoutubeUrl, YOUTUBE_ONLY_ERROR, youtubeId } from "@/lib/youtube";

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

type EditableTable = "stories" | "videos" | "events" | "featured_machines";
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

type OwnedBooking = { id: string; status: string; advert_id: string; product_id: string | null };

/** The `advert_bookings` row `id` if it belongs to this member (via its advert), else null. */
async function assertOwnsBooking(db: ReturnType<typeof serviceDb>, id: string, memberId: string): Promise<OwnedBooking | null> {
  const { data } = await db
    .from("advert_bookings")
    .select("id, status, advert_id, product_id, advert:adverts(member_id)")
    .eq("id", id)
    .single();
  if (!data || data.advert?.member_id !== memberId) return null;
  return { id: data.id, status: data.status, advert_id: data.advert_id, product_id: data.product_id };
}

/** True when the `prospect_marks` row `id` is this member's own — never an admin mark. */
async function assertOwnsMark(db: ReturnType<typeof serviceDb>, id: string, memberId: string): Promise<boolean> {
  const { data } = await db.from("prospect_marks").select("id, member_id").eq("id", id).single();
  return data?.member_id === memberId;
}

/** Editor image upload — returns the public URL for insertion as <img src>. */
export async function memberUploadImage(formData: FormData): Promise<string | null> {
  const user = await requireMember();
  const path = await uploadImage(formData.get("file") as File | null, `stories/${user.memberId}`);
  return mediaUrl(path);
}

/** M3 — member self-post: lands awaiting approval, never live directly. */
export async function submitStory(formData: FormData) {
  const user = await requireMember();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  let cover: string | null = null;
  try {
    cover = await uploadImage(formData.get("cover") as File | null, "stories");
  } catch (e) {
    // Was an unhandled throw into the error boundary — an 8MB file lost the
    // whole draft. redirect() stays outside the try: its NEXT_REDIRECT must
    // not be caught as an upload failure.
    redirect(`/dashboard/story/new?error=${encodeURIComponent(e instanceof Error ? e.message : "Cover upload failed.")}`);
  }
  if (!cover) redirect(`/dashboard/story/new?error=${encodeURIComponent("A cover image is required.")}`);
  const db = serviceDb();
  const { data } = await db.from("stories").insert({
    slug: `${slugify(title)}-${Date.now().toString(36)}`,
    title,
    excerpt: String(formData.get("excerpt") ?? ""),
    body: sanitizeRichText(String(formData.get("body") ?? "")),
    status: "awaiting_approval",
    source: "member",
    is_member_news: true,
    member_id: user.memberId,
    submitted_by: user.userId,
    industry_id: Number(formData.get("industry_id")) || null,
    cover_path: cover,
    ...(formData.get("focus_x")
      ? { cover_focus: { x: Number(formData.get("focus_x")), y: Number(formData.get("focus_y")), scale: Number(formData.get("focus_scale") || 1) } }
      : {}),
  }).select("id").single();
  const cat = Number(formData.get("category") || 0);
  if (cat && data) await db.from("story_categories").insert({ story_id: data.id, category_id: cat });
  await notifySubmitted("story_submitted", user.memberId, { story_id: data?.id }, `Submitted a story for approval: “${title}”.`);
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=story");
}

/** Pull back a story that's still waiting on (or was sent back from) a decision. */
export async function withdrawStory(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id"));
  const db = serviceDb();
  if (!(await assertOwnsRow(db, "stories", id, user.memberId))) return;
  await db.from("stories").update({ status: "withdrawn" }).eq("id", id);
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/** Edit and resubmit a story that's awaiting approval or was rejected — mirrors resubmitAdvert. */
export async function editStory(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id"));
  const db = serviceDb();
  if (!(await assertOwnsRow(db, "stories", id, user.memberId))) return;
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  let cover: string | null = null;
  try {
    cover = await uploadImage(formData.get("cover") as File | null, "stories");
  } catch (e) {
    redirect(`/dashboard/story/${id}/edit?error=${encodeURIComponent(e instanceof Error ? e.message : "Cover upload failed.")}`);
  }
  // A cover is mandatory — fine to keep the existing one on a resubmit, but a
  // story that somehow has neither (pre-dates this rule) can't stay without one.
  if (!cover) {
    const { data: existing } = await db.from("stories").select("cover_path").eq("id", id).single();
    if (!existing?.cover_path) redirect(`/dashboard/story/${id}/edit?error=${encodeURIComponent("A cover image is required.")}`);
  }
  await db.from("stories").update({
    title,
    excerpt: String(formData.get("excerpt") ?? ""),
    body: sanitizeRichText(String(formData.get("body") ?? "")),
    status: "awaiting_approval",
    industry_id: Number(formData.get("industry_id")) || null,
    // cleared so the member is not still shown last time's reason once they act on it
    rejected_reason: null,
    updated_at: new Date().toISOString(),
    ...(cover ? { cover_path: cover } : {}),
    ...(formData.get("focus_x")
      ? { cover_focus: { x: Number(formData.get("focus_x")), y: Number(formData.get("focus_y")), scale: Number(formData.get("focus_scale") || 1) } }
      : {}),
  }).eq("id", id);
  const cat = Number(formData.get("category") || 0);
  if (cat) {
    await db.from("story_categories").delete().eq("story_id", id);
    await db.from("story_categories").insert({ story_id: id, category_id: cat });
  }
  await notifySubmitted("story_submitted", user.memberId, { story_id: id }, `Resubmitted their story “${title}” after changes.`);
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=story");
}

/** Editor image upload for the description field — returns the public URL for insertion as <img src>. */
export async function memberUploadVideoImage(formData: FormData): Promise<string | null> {
  const user = await requireMember();
  const path = await uploadImage(formData.get("file") as File | null, `videos/${user.memberId}`);
  return mediaUrl(path);
}

/** Member self-post: lands awaiting approval, never live directly. */
export async function submitVideo(formData: FormData) {
  const user = await requireMember();
  const title = String(formData.get("title") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  // Say why rather than silently re-rendering the form (same as submitStory).
  const problem = !title || !url ? "A title and a YouTube link are both required." : !youtubeId(url) ? YOUTUBE_ONLY_ERROR : null;
  if (problem) redirect(`/dashboard/video/new?error=${encodeURIComponent(problem)}`);
  const thumbnail = await uploadImage(formData.get("thumbnail") as File | null, "videos");
  // The id is selected back purely so the console notification can link to it.
  const { data } = await serviceDb().from("videos").insert({
    slug: `${slugify(title)}-${Date.now().toString(36)}`,
    title,
    url,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    industry_id: Number(formData.get("industry_id")) || null,
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
  const thumbnail = await uploadImage(formData.get("thumbnail") as File | null, "videos");
  await db.from("videos").update({
    title,
    url,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    industry_id: Number(formData.get("industry_id")) || null,
    status: "awaiting_approval",
    rejected_reason: null,
    updated_at: new Date().toISOString(),
    ...(thumbnail ? { thumbnail_path: thumbnail } : {}),
  }).eq("id", id);
  await notifySubmitted("video_submitted", user.memberId, { video_id: id }, `Resubmitted their video “${title}” after changes.`);
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=video");
}

/** Editor image upload for the description field — returns the public URL for insertion as <img src>. */
export async function memberUploadEventImage(formData: FormData): Promise<string | null> {
  const user = await requireMember();
  const path = await uploadImage(formData.get("file") as File | null, `events/${user.memberId}`);
  return mediaUrl(path);
}

/** M4 — member adds an event; Jas approves. */
export async function submitEvent(formData: FormData) {
  const user = await requireMember();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const cover = await uploadImage(formData.get("cover") as File | null, "events");
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
    industry_id: Number(formData.get("industry_id")) || null,
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
  const cover = await uploadImage(formData.get("cover") as File | null, "events");
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
    industry_id: Number(formData.get("industry_id")) || null,
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
      uploadImage(formData.get("logo") as File | null, `members/${user.memberId}`),
      uploadImage(formData.get("hero") as File | null, `members/${user.memberId}`),
    ]);
    uploaded = { logo_path, hero_path };
  } catch (e) {
    // redirect() must stay outside the try or its NEXT_REDIRECT is swallowed
    // as an upload failure — same reasoning as saveMember.
    uploaded = { logo_path: null, hero_path: null };
    back(e instanceof Error ? e.message : "Image upload failed.");
    return;
  }

  const parsed = companyPageValuesFromForm(formData, member, uploaded);
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
  const image = await uploadImage(formData.get("image") as File | null, `machines/${user.memberId}`);
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
  const image = await uploadImage(formData.get("image") as File | null, `machines/${user.memberId}`);
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
  await serviceDb().from("visibility_requests").insert({
    member_id: user.memberId,
    product: String(formData.get("product")),
    message: String(formData.get("message") ?? "") || null,
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
  await requireMember();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < PASSWORD_MIN_LENGTH) redirect("/dashboard/settings/security?perror=short");
  if (password !== confirm) redirect("/dashboard/settings/security?perror=mismatch");

  const db = await sessionDb();
  const { error } = await db.auth.updateUser({ password });
  if (error) redirect("/dashboard/settings/security?perror=failed");

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

  let desktop_path: string | null = null;
  let mobile_path: string | null = null;
  try {
    desktop_path = await uploadImage(formData.get("desktop") as File | null, `panels/${user.memberId}`);
    mobile_path = await uploadImage(formData.get("mobile") as File | null, `panels/${user.memberId}`);
  } catch (e) {
    redirect(`/dashboard/advertising/buy?error=${encodeURIComponent(e instanceof Error ? e.message : "Artwork upload failed.")}`);
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
    link_url: String(formData.get("link_url") ?? "").trim() || null,
  }).select("id").single();
  if (!advert) {
    // Nothing was written, so the just-uploaded artwork would otherwise be
    // orphaned storage with no row pointing at it.
    await Promise.all([removeMedia(desktop_path), removeMedia(mobile_path)]);
    redirect(`/dashboard/advertising/buy?error=${encodeURIComponent(advertError?.message ?? "Could not save the advert.")}`);
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
    redirect(`/dashboard/advertising/buy?error=${encodeURIComponent(
      bookingError.message.includes("ends_on")
        ? "The run must end on or after its start date."
        : bookingError.message,
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

  let desktop_path: string | null = null;
  let mobile_path: string | null = null;
  try {
    desktop_path = await uploadImage(formData.get("desktop") as File | null, `panels/${user.memberId}`);
    mobile_path = await uploadImage(formData.get("mobile") as File | null, `panels/${user.memberId}`);
  } catch (e) {
    redirect(`/dashboard/advert/${id}?error=${encodeURIComponent(e instanceof Error ? e.message : "Artwork upload failed.")}`);
  }

  const name = String(formData.get("name") ?? "").trim();
  if (name || desktop_path || mobile_path || formData.get("link_url") !== null) {
    await db.from("adverts").update({
      ...(name ? { name } : {}),
      link_url: String(formData.get("link_url") ?? "").trim() || null,
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

/** Rebook a finished run: same artwork, new dates, back through approval. */
export async function renewAdvertBooking(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id"));
  const db = serviceDb();
  const prev = await assertOwnsBooking(db, id, user.memberId);
  if (!prev) return;

  const { data: renewal } = await db.from("advert_bookings").insert({
    advert_id: prev.advert_id,
    product_id: prev.product_id,
    starts_on: String(formData.get("starts_on")),
    ends_on: String(formData.get("ends_on")),
    status: "awaiting_approval",
    source: "member",
    renewed_from: id,
    submitted_by: user.userId,
    submitted_at: new Date().toISOString(),
  }).select("id").single();
  // Links to the NEW booking, not the run it was renewed from — the new one is
  // the row awaiting a decision.
  await notifySubmitted("advert_submitted", user.memberId, { booking_id: renewal?.id }, `Asked to renew an advert run: ${String(formData.get("starts_on"))} to ${String(formData.get("ends_on"))}.`);
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
    desktop_path = await uploadImage(formData.get("desktop") as File | null, `panels/${user.memberId}`);
    mobile_path = await uploadImage(formData.get("mobile") as File | null, `panels/${user.memberId}`);
  } catch (e) {
    redirect(`/dashboard/advert/${String(formData.get("booking_id"))}?error=${encodeURIComponent(e instanceof Error ? e.message : "Artwork upload failed.")}`);
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
    redirect(`/dashboard/advert/${String(formData.get("booking_id"))}?error=${encodeURIComponent(
      error.message.includes("advert_artwork_proposals_one_pending")
        ? "You already have a swap awaiting a decision on this advert."
        : error.message,
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

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const db = serviceDb();
  if (!(await assertOwnsMark(db, id, user.memberId))) return;

  await db.from("prospect_marks").delete().eq("id", id);
  revalidatePath("/dashboard/leads");
}

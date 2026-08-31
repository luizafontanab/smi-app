"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { removeMedia, uploadImage } from "@/lib/media";
import { sanitizeRichText } from "@/lib/sanitize";
import { mergeSocial } from "@/lib/social";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

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
    cover_path: cover,
    ...(formData.get("focus_x")
      ? { cover_focus: { x: Number(formData.get("focus_x")), y: Number(formData.get("focus_y")), scale: Number(formData.get("focus_scale") || 1) } }
      : {}),
  }).select("id").single();
  const cat = Number(formData.get("category") || 0);
  if (cat && data) await db.from("story_categories").insert({ story_id: data.id, category_id: cat });
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
  if (!title || !url) return;
  const thumbnail = await uploadImage(formData.get("thumbnail") as File | null, "videos");
  await serviceDb().from("videos").insert({
    slug: `${slugify(title)}-${Date.now().toString(36)}`,
    title,
    url,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    status: "awaiting_approval",
    source: "member",
    member_id: user.memberId,
    submitted_by: user.userId,
    thumbnail_path: thumbnail,
  });
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
  await serviceDb().from("events").insert({
    slug: `${slugify(title)}-${Date.now().toString(36)}`,
    title,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    location: String(formData.get("location") ?? ""),
    starts_on: String(formData.get("starts_on")),
    starts_time: String(formData.get("starts_time") ?? "") || null,
    ends_on: String(formData.get("ends_on") ?? "") || null,
    link: String(formData.get("link") ?? "") || null,
    member_id: user.memberId,
    status: "awaiting_approval",
    source: "member",
    submitted_by: user.userId,
    cover_path: cover,
  });
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=event");
}

/**
 * M5 — profile edits are approval-gated (working assumption #2): stored as a revision.
 * Draft members (V13 step 3 of 4) write their page directly instead — it's not public
 * yet, and Jas's Activate is the one approval; a revision would mean approving twice.
 */
export async function submitProfileEdit(formData: FormData) {
  const user = await requireMember();
  const [logoPath, heroPath] = await Promise.all([
    uploadImage(formData.get("logo") as File | null, `members/${user.memberId}`),
    uploadImage(formData.get("hero") as File | null, `members/${user.memberId}`),
  ]);
  const db = serviceDb();
  const { data: member } = await db.from("members")
    .select("name, status, draft_submitted_at, social").eq("id", user.memberId).single();

  const social = mergeSocial(member?.social, (key) => String(formData.get(key) ?? ""));

  const payload = {
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    ...(logoPath ? { logo_path: logoPath } : {}),
    ...(heroPath ? { hero_path: heroPath } : {}),
    address: String(formData.get("address") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    website: String(formData.get("website") ?? ""),
    video_url: String(formData.get("video_url") ?? "") || null,
    social,
  };

  if (member?.status === "draft") {
    const firstSubmit = !member.draft_submitted_at;
    await db.from("members").update({
      ...payload, // description already sanitised above; page stays hidden until Activate
      draft_submitted_at: member.draft_submitted_at ?? new Date().toISOString(),
    }).eq("id", user.memberId);
    if (firstSubmit) {
      const { notifyAdminFunnel } = await import("@/lib/notify-admin");
      await notifyAdminFunnel({
        name: member.name,
        email: user.email,
        message: "Submitted their draft company page for review — ready for your verification and approval.",
      });
    }
    revalidatePath("/dashboard");
    redirect("/dashboard?submitted=page");
  }

  await db.from("member_revisions").insert({
    member_id: user.memberId,
    payload: payload as import("@/lib/db/types").Json,
  });
  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=profile");
}

/** Member equipment submission — approval-gated like stories, never live directly. */
export async function submitMachine(formData: FormData) {
  const user = await requireMember();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const image = await uploadImage(formData.get("image") as File | null, `machines/${user.memberId}`);
  await serviceDb().from("featured_machines").insert({
    name,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    external_url: String(formData.get("external_url") ?? "") || null,
    image_path: image,
    member_id: user.memberId,
    status: "awaiting_approval",
    source: "member",
    submitted_by: user.userId,
  });
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
    redirect(`/dashboard/advert/new?error=${encodeURIComponent(e instanceof Error ? e.message : "Artwork upload failed.")}`);
  }
  if (!desktop_path || !mobile_path) {
    redirect(`/dashboard/advert/new?error=${encodeURIComponent("Both a desktop and a mobile image are required.")}`);
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
    redirect(`/dashboard/advert/new?error=${encodeURIComponent(advertError?.message ?? "Could not save the advert.")}`);
  }

  const { error: bookingError } = await db.from("advert_bookings").insert({
    advert_id: advert.id,
    starts_on,
    ends_on,
    status: "awaiting_approval",
    source: "member",
    submitted_by: user.userId,
    submitted_at: new Date().toISOString(),
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (bookingError) {
    // The advert row is worthless without a booking on it (and would show up
    // nowhere the member or console can reach to retry) — clean it and its
    // artwork up rather than leaving an orphan and redirecting to "success".
    await Promise.all([removeMedia(desktop_path), removeMedia(mobile_path)]);
    await db.from("adverts").delete().eq("id", advert.id);
    redirect(`/dashboard/advert/new?error=${encodeURIComponent(
      bookingError.message.includes("ends_on")
        ? "The run must end on or after its start date."
        : bookingError.message,
    )}`);
  }
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
  const { data: booking } = await db
    .from("advert_bookings")
    .select("id, status, advert:adverts(id, member_id)")
    .eq("id", id)
    .single();
  // ownership is checked here because these actions use the service role, which
  // bypasses RLS
  if (!booking || booking.advert?.member_id !== user.memberId) return;
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
    }).eq("id", booking.advert!.id);
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

  revalidatePath("/dashboard");
  redirect("/dashboard?submitted=advert");
}

/** Rebook a finished run: same artwork, new dates, back through approval. */
export async function renewAdvertBooking(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id"));
  const db = serviceDb();
  const { data: prev } = await db
    .from("advert_bookings")
    .select("id, advert_id, product_id, advert:adverts(member_id)")
    .eq("id", id)
    .single();
  if (!prev || prev.advert?.member_id !== user.memberId) return;

  await db.from("advert_bookings").insert({
    advert_id: prev.advert_id,
    product_id: prev.product_id,
    starts_on: String(formData.get("starts_on")),
    ends_on: String(formData.get("ends_on")),
    status: "awaiting_approval",
    source: "member",
    renewed_from: id,
    submitted_by: user.userId,
    submitted_at: new Date().toISOString(),
  });
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
  const { data: advert } = await db.from("adverts").select("id, member_id").eq("id", advertId).single();
  if (!advert || advert.member_id !== user.memberId) return;

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
  revalidatePath("/dashboard/advert");
  redirect(`/dashboard/advert/${String(formData.get("booking_id"))}?submitted=swap`);
}

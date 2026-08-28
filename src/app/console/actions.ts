"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canApprove, canWrite, requireConsole } from "@/lib/auth";
import { applyOptIn, NEWSLETTER_CHOICES, type NewsletterChoice } from "@/lib/contacts";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { DEV_ASSIGNEES, DEV_STATUSES, devTaskValuesFromForm, type DevStatus } from "@/lib/dev-tasks";
import { enqueue } from "@/lib/jobs";
import { uploadImage } from "@/lib/media";
import { memberValuesFromForm } from "@/lib/member-form";
import { recordRename } from "@/lib/redirects";
import { activationBlocked, MEMBER_STATUSES, type MemberStatus } from "@/lib/membership";
import { renderableHtml, sanitizeRichText } from "@/lib/sanitize";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** Editor image upload — returns the public URL for insertion as <img src>. */
export async function consoleUploadImage(formData: FormData): Promise<string | null> {
  const user = await requireConsole();
  if (!canWrite(user)) return null;
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

  const values = {
    title,
    excerpt: String(formData.get("excerpt") ?? ""),
    body: sanitizeRichText(String(formData.get("body") ?? "")),
    member_id: String(formData.get("member_id") ?? "") || null,
    is_member_news: formData.get("is_member_news") === "on",
    cover_focus: formData.get("focus_x")
      ? { x: Number(formData.get("focus_x")), y: Number(formData.get("focus_y")), scale: Number(formData.get("focus_scale") || 1) }
      : undefined,
  };

  if (!canWrite(user)) return;

  let storyId = id;
  if (id) {
    await db.from("stories").update(values).eq("id", id);
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
  if (!canWrite(user)) return;
  const id = String(formData.get("id"));
  const when = String(formData.get("scheduled_at") ?? "");
  const db = serviceDb();
  if (formData.get("mode") === "now") {
    // urgent override — publish immediately, social push follows on its delay
    await db.from("stories").update({ status: "published", published_at: new Date().toISOString() }).eq("id", id);
    const { data: s } = await db.from("stories").select("member_id").eq("id", id).single();
    await enqueue("social_push", { story_id: id }, new Date(Date.now() + 30 * 60_000));
    if (s?.member_id) await enqueue("notify_member", { member_id: s.member_id, kind: "story_live", story_id: id });
  } else if (when) {
    await db.from("stories").update({ status: "scheduled", scheduled_at: new Date(when).toISOString() }).eq("id", id);
  }
  revalidatePath("/console/stories");
  // come back to whichever Story Engine view the operator came from (board or
  // calendar). Validated, not trusted — this is POST-reachable like every action.
  const back = String(formData.get("return_to") ?? "");
  redirect(/^\/console\/stories(\?[\w=&-]*)?$/.test(back) ? back : "/console/stories");
}

export async function decideStory(formData: FormData) {
  const user = await requireConsole();
  if (!canApprove(user)) return;
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
  const user = await requireConsole();
  if (!canWrite(user)) return;
  const id = String(formData.get("id"));
  const days = Number(formData.get("days") || 0);
  await serviceDb().from("stories").update({
    pinned_until: days > 0 ? new Date(Date.now() + days * 864e5).toISOString() : null,
  }).eq("id", id);
  revalidatePath("/console/stories");
}

/* ---------- videos ---------- */

/** Editor image upload for the description field — returns the public URL for insertion as <img src>. */
export async function consoleUploadVideoImage(formData: FormData): Promise<string | null> {
  const user = await requireConsole();
  if (!canWrite(user)) return null;
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
  if (!canWrite(user)) return;

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
  if (!canWrite(user)) return;
  const id = String(formData.get("id"));
  const when = String(formData.get("scheduled_at") ?? "");
  const db = serviceDb();
  if (formData.get("mode") === "now") {
    // urgent override — publish immediately, social push follows on its delay
    await db.from("videos").update({ status: "published", published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
    const { data: v } = await db.from("videos").select("member_id").eq("id", id).single();
    await enqueue("social_push", { video_id: id }, new Date(Date.now() + 30 * 60_000));
    if (v?.member_id) await enqueue("notify_member", { member_id: v.member_id, kind: "video_live", video_id: id });
  } else if (when) {
    await db.from("videos").update({ status: "scheduled", scheduled_at: new Date(when).toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
  }
  revalidatePath("/console/videos");
  const back = String(formData.get("return_to") ?? "");
  redirect(/^\/console\/videos(\?[\w=&-]*)?$/.test(back) ? back : "/console/videos");
}

export async function decideVideo(formData: FormData) {
  const user = await requireConsole();
  if (!canApprove(user)) return;
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
  const user = await requireConsole();
  if (!canWrite(user)) return;
  const id = String(formData.get("id"));
  const days = Number(formData.get("days") || 0);
  await serviceDb().from("videos").update({
    pinned_until: days > 0 ? new Date(Date.now() + days * 864e5).toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  revalidatePath("/console/videos");
}

/* ---------- events & member revisions ---------- */

/** Editor image upload for the description field — returns the public URL for insertion as <img src>. */
export async function consoleUploadEventImage(formData: FormData): Promise<string | null> {
  const user = await requireConsole();
  if (!canWrite(user)) return null;
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
  if (!canWrite(user)) return;

  let cover_path: string | null = null;
  try {
    cover_path = await uploadImage(formData.get("cover") as File | null, "events");
  } catch (e) {
    redirect(`/console/events/${id || "new"}?error=${encodeURIComponent(e instanceof Error ? e.message : "Cover upload failed.")}`);
  }

  const values = {
    title,
    starts_on,
    ends_on: String(formData.get("ends_on") ?? "") || null,
    starts_time: String(formData.get("starts_time") ?? "") || null,
    location: String(formData.get("location") ?? "") || null,
    link: String(formData.get("link") ?? "") || null,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    member_id: String(formData.get("member_id") ?? "") || null,
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
  if (!canApprove(user)) return;
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

export async function decideRevision(formData: FormData) {
  const user = await requireConsole();
  if (!canApprove(user)) return;
  const id = String(formData.get("id"));
  const approve = formData.get("decision") === "approve";
  const reason = String(formData.get("reason") ?? "");
  const db = serviceDb();
  const { data: rev } = await db.from("member_revisions").select("id, member_id, payload, status").eq("id", id).single();
  if (!rev || rev.status !== "awaiting_approval") return;
  if (approve) {
    type MemberUpdate = import("@/lib/db/types").Database["public"]["Tables"]["members"]["Update"];
    const payload = { ...(rev.payload as MemberUpdate) };
    // revisions are member-authored and POST-reachable — never apply unsanitised markup
    if (typeof payload.description === "string") payload.description = renderableHtml(payload.description);
    await db.from("members").update(payload).eq("id", rev.member_id);
    await db.from("member_revisions").update({ status: "published", decided_at: new Date().toISOString() }).eq("id", id);
  } else {
    await db.from("member_revisions").update({ status: "rejected", rejected_reason: reason, decided_at: new Date().toISOString() }).eq("id", id);
  }
  await db.from("approvals").insert({ kind: "member_revision", subject_id: id, decision: approve ? "approved" : "rejected", reason: reason || null, decided_by: user.userId });
  revalidatePath("/console");
}

/* ---------- page layouts ---------- */

const PAGE_TYPES = ["story", "member_profile", "featured_machine"] as const;

export async function saveLayout(formData: FormData) {
  const user = await requireConsole();
  if (!canWrite(user)) return;
  const pageType = String(formData.get("page_type")) as (typeof PAGE_TYPES)[number];
  if (!PAGE_TYPES.includes(pageType)) return;
  const entityId = String(formData.get("entity_id") ?? "") || null;
  let layout: unknown;
  try {
    layout = JSON.parse(String(formData.get("layout") ?? ""));
  } catch {
    return;
  }
  const { validateLayout } = await import("@/lib/blocks/schema");
  const qs = `type=${pageType}${entityId ? `&entity=${entityId}` : ""}`;
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
  const user = await requireConsole();
  if (!canWrite(user)) return;
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
  if (!canWrite(user)) return;
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
  if (!canApprove(user)) return;
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
  const user = await requireConsole();
  if (!canWrite(user)) return;
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

/* ---------- adverts ---------- */

export async function saveBooking(formData: FormData) {
  const user = await requireConsole();
  if (!canWrite(user)) return;
  const db = serviceDb();
  const advertId = String(formData.get("advert_id"));
  await db.from("advert_bookings").insert({
    advert_id: advertId,
    starts_on: String(formData.get("starts_on")),
    ends_on: String(formData.get("ends_on")),
    notes: String(formData.get("notes") ?? "") || null,
  });
  revalidatePath("/console/adverts");
}

export async function endBooking(formData: FormData) {
  const user = await requireConsole();
  if (!canWrite(user)) return;
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  await serviceDb().from("advert_bookings").update({ ends_on: yesterday }).eq("id", String(formData.get("id")));
  revalidatePath("/console/adverts");
}

export async function saveAdvertProduct(formData: FormData) {
  const user = await requireConsole();
  const id = String(formData.get("id") ?? "");
  const db = serviceDb();
  const short_name = String(formData.get("short_name") ?? "").trim();
  const format = String(formData.get("format") ?? "");
  const cap = Math.max(1, Number(formData.get("cap") ?? 1));
  if (!short_name || !format) return;
  if (!canWrite(user)) return;

  let sample_path: string | null = null;
  try {
    sample_path = await uploadImage(formData.get("sample") as File | null, "advert-products");
  } catch (e) {
    redirect(`/console/adverts/spots/${id || "new"}?error=${encodeURIComponent(e instanceof Error ? e.message : "Sample upload failed.")}`);
  }

  const values = {
    short_name,
    format,
    cap,
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

export async function deleteAdvertProduct(formData: FormData) {
  const user = await requireConsole();
  if (!canWrite(user)) return;
  await serviceDb().from("advert_products").delete().eq("id", String(formData.get("id")));
  revalidatePath("/console/adverts/spots");
}

/* ---------- newsletter ---------- */

export async function createIssue(formData: FormData) {
  const user = await requireConsole();
  if (!canWrite(user)) return;
  const db = serviceDb();
  const { data: last } = await db.from("newsletter_issues").select("number").order("number", { ascending: false }).limit(1).single();
  const number = (last?.number ?? 46) + 1;
  const subject = String(formData.get("subject") ?? `SMI Monthly — issue ${number}`);
  const { data } = await db.from("newsletter_issues").insert({
    number, subject, intro: String(formData.get("intro") ?? ""), web_slug: `issue-${number}`,
  }).select("id").single();
  const storyIds = formData.getAll("stories").map(String);
  if (storyIds.length) {
    await db.from("newsletter_items").insert(storyIds.map((story_id, i) => ({ issue_id: data!.id, story_id, position: i })));
  }
  revalidatePath("/console/newsletter");
}

export async function sendIssue(formData: FormData) {
  const user = await requireConsole();
  if (!canWrite(user)) return;
  await enqueue("newsletter_send", { issue_id: String(formData.get("id")) });
  revalidatePath("/console/newsletter");
}

export async function scheduleIssue(formData: FormData) {
  const user = await requireConsole();
  if (!canWrite(user)) return;
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
  const user = await requireConsole();
  if (!canWrite(user)) return;
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
  const user = await requireConsole();
  if (!canWrite(user)) return;
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
  const user = await requireConsole();
  if (!canWrite(user)) return;
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
  if (!canWrite(user)) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const db = serviceDb();
  // explicit columns: select("*") would drag the search_tsv vector across the wire
  const { data: member } = await db.from("members")
    .select("id, slug, status, social").eq("id", id).single();
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
  const user = await requireConsole();
  if (!canWrite(user)) return;
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

  revalidatePath("/console/members");
  revalidatePath("/console");
  redirect(`/console/members/${result.memberId}?created=1`);
}

/**
 * A17 — record an offline payment or a comp. Goes through applyPaymentResult so
 * a manually-taken payment raises the same invoice a self-serve one does and
 * shows up under the member's Billing tab.
 */
export async function recordMemberPayment(formData: FormData) {
  const user = await requireConsole();
  if (!canWrite(user)) return;
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
  if (!canWrite(user)) return;
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

export async function markInboxRead(formData: FormData) {
  await requireConsole();
  await serviceDb().from("inbox_messages").update({ read: true }).eq("id", String(formData.get("id")));
  revalidatePath("/console");
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
  const user = await requireConsole();
  if (!canWrite(user)) return;

  const originalSlug = String(formData.get("original_slug") ?? "").trim();
  const isNew = !originalSlug;
  const title = String(formData.get("title") ?? "").trim();
  const slug = slugify(String(formData.get("slug") ?? "") || title);
  const body = sanitizeRichText(String(formData.get("body") ?? ""));

  const fail = (message: string): never =>
    redirect(`/console/content-pages/${isNew ? "new" : originalSlug}?error=${encodeURIComponent(message)}`);
  if (!title) return fail("Give the page a title.");
  if (!slug) return fail("That title has no letters or numbers in it — add a web address by hand.");

  const db = serviceDb();
  const { data: clash } = await db.from("static_pages").select("slug").eq("slug", slug).maybeSingle();
  if (clash && slug !== originalSlug) return fail(`The web address “${slug}” is already used by another page.`);

  if (isNew) {
    const { error } = await db.from("static_pages").insert({ slug, title, body });
    if (error) return fail(error.message);
  } else {
    const { error } = await db
      .from("static_pages")
      .update({ slug, title, body, updated_at: new Date().toISOString() })
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
  const user = await requireConsole();
  if (!canWrite(user)) return;
  const slug = String(formData.get("slug") ?? "");
  if (!slug) return;
  await serviceDb().from("static_pages").delete().eq("slug", slug);
  revalidatePath("/console/content-pages");
  redirect("/console/content-pages?deleted=1");
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

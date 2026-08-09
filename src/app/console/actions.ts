"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canApprove, canWrite, requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { enqueue } from "@/lib/jobs";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

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
    body: String(formData.get("body") ?? ""),
    member_id: String(formData.get("member_id") ?? "") || null,
    is_member_news: formData.get("is_member_news") === "on",
    cover_focus: formData.get("focus_x")
      ? { x: Number(formData.get("focus_x")), y: Number(formData.get("focus_y")), scale: Number(formData.get("focus_scale") || 1) }
      : undefined,
  };

  // input_only (external media company) can only create/edit drafts
  const inputOnly = user.role === "input_only";
  if (!canWrite(user) && !inputOnly) return;

  let storyId = id;
  if (id) {
    if (inputOnly) {
      const { data: existing } = await db.from("stories").select("status").eq("id", id).single();
      if (existing?.status !== "draft") return;
    }
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
  redirect("/console/stories");
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

/* ---------- events & member revisions ---------- */

export async function decideEvent(formData: FormData) {
  const user = await requireConsole();
  if (!canApprove(user)) return;
  const id = String(formData.get("id"));
  const approve = formData.get("decision") === "approve";
  const db = serviceDb();
  await db.from("events").update({ status: approve ? "published" : "rejected" }).eq("id", id);
  await db.from("approvals").insert({ kind: "event", subject_id: id, decision: approve ? "approved" : "rejected", decided_by: user.userId });
  revalidatePath("/console");
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
    await db.from("members").update(rev.payload as MemberUpdate).eq("id", rev.member_id);
    await db.from("member_revisions").update({ status: "published", decided_at: new Date().toISOString() }).eq("id", id);
  } else {
    await db.from("member_revisions").update({ status: "rejected", rejected_reason: reason, decided_at: new Date().toISOString() }).eq("id", id);
  }
  await db.from("approvals").insert({ kind: "member_revision", subject_id: id, decision: approve ? "approved" : "rejected", reason: reason || null, decided_by: user.userId });
  revalidatePath("/console");
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

/* ---------- CRM ---------- */

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
  revalidatePath("/console/members");
}

/* ---------- inbox ---------- */

export async function markInboxRead(formData: FormData) {
  await requireConsole();
  await serviceDb().from("inbox_messages").update({ read: true }).eq("id", String(formData.get("id")));
  revalidatePath("/console");
}

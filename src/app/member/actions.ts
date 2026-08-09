"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

async function uploadCover(file: File | null, prefix: string): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (file.size > 8 * 1024 * 1024) throw new Error("Image too large (8MB max)");
  const db = serviceDb();
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().slice(0, 4);
  const path = `${prefix}/${Date.now().toString(36)}.${ext}`;
  const { error } = await db.storage.from("media").upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  return path;
}

/** M3 — member self-post: lands awaiting approval, never live directly. */
export async function submitStory(formData: FormData) {
  const user = await requireMember();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const cover = await uploadCover(formData.get("cover") as File | null, "stories");
  const db = serviceDb();
  const { data } = await db.from("stories").insert({
    slug: `${slugify(title)}-${Date.now().toString(36)}`,
    title,
    excerpt: String(formData.get("excerpt") ?? ""),
    body: `<p>${String(formData.get("body") ?? "").replace(/\n\n/g, "</p><p>")}</p>`,
    status: "awaiting_approval",
    source: "member",
    is_member_news: true,
    member_id: user.memberId,
    submitted_by: user.userId,
    cover_path: cover,
  }).select("id").single();
  const cat = Number(formData.get("category") || 0);
  if (cat && data) await db.from("story_categories").insert({ story_id: data.id, category_id: cat });
  revalidatePath("/member");
  redirect("/member?submitted=story");
}

/** M4 — member adds an event; Jas approves. */
export async function submitEvent(formData: FormData) {
  const user = await requireMember();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  await serviceDb().from("events").insert({
    slug: `${slugify(title)}-${Date.now().toString(36)}`,
    title,
    description: String(formData.get("description") ?? ""),
    location: String(formData.get("location") ?? ""),
    starts_on: String(formData.get("starts_on")),
    ends_on: String(formData.get("ends_on") ?? "") || null,
    link: String(formData.get("link") ?? "") || null,
    member_id: user.memberId,
    status: "awaiting_approval",
  });
  revalidatePath("/member");
  redirect("/member?submitted=event");
}

/** M5 — profile edits are approval-gated (working assumption #2): stored as a revision. */
export async function submitProfileEdit(formData: FormData) {
  const user = await requireMember();
  const payload: Record<string, unknown> = {
    description: String(formData.get("description") ?? ""),
    address: String(formData.get("address") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    website: String(formData.get("website") ?? ""),
    video_url: String(formData.get("video_url") ?? "") || null,
    social: {
      linkedin: String(formData.get("linkedin") ?? ""),
      x: String(formData.get("x") ?? ""),
      facebook: String(formData.get("facebook") ?? ""),
      instagram: String(formData.get("instagram") ?? ""),
    },
  };
  await serviceDb().from("member_revisions").insert({ member_id: user.memberId, payload });
  revalidatePath("/member");
  redirect("/member?submitted=profile");
}

/** M11 — "Buy" request: no online payment; Jas confirms and invoices. */
export async function requestVisibility(formData: FormData) {
  const user = await requireMember();
  await serviceDb().from("visibility_requests").insert({
    member_id: user.memberId,
    product: String(formData.get("product")),
    message: String(formData.get("message") ?? "") || null,
  });
  revalidatePath("/member");
  redirect("/member?submitted=buy");
}

export async function savePrefs(formData: FormData) {
  const user = await requireMember();
  await serviceDb().from("notification_prefs").upsert({
    member_id: user.memberId,
    stats_frequency: String(formData.get("stats_frequency") ?? "quarterly"),
    leads_frequency: String(formData.get("leads_frequency") ?? "weekly"),
  });
  revalidatePath("/member/settings");
  redirect("/member/settings?saved=1");
}

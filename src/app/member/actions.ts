"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { uploadImage } from "@/lib/media";
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
  const cover = await uploadImage(formData.get("cover") as File | null, "stories");
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
    revalidatePath("/member");
    redirect("/member?submitted=page");
  }

  await db.from("member_revisions").insert({
    member_id: user.memberId,
    payload: payload as import("@/lib/db/types").Json,
  });
  revalidatePath("/member");
  redirect("/member?submitted=profile");
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
  revalidatePath("/member");
  redirect("/member?submitted=machine");
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

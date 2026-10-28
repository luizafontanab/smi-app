"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { logError } from "@/lib/log";
import { isMemberLinkable } from "@/lib/member-visibility";
import { syncBiginSources } from "@/lib/sources/bigin";
import { normalizeSourceUrl } from "@/lib/sources/extract";
import { replaceStoryMembers } from "@/lib/story-members";

/*
 * Story sources (ChangeTower replacement, migration 20261020000002).
 *
 * Kept out of console/actions.ts on purpose: this is a self-contained module
 * the requirements say must be severable (06-content-os.md "Must be fully
 * severable"), and nothing else in the console calls into it. Every export is
 * async — this is a "use server" module.
 *
 * Nothing here publishes. "Start story" makes an ordinary admin draft and
 * hands it to the normal editor and approval flow.
 */

const PAGE = "/console/sources";
const back = (query: string) => `${PAGE}?${query}`;

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

export async function addSource(formData: FormData) {
  await requireConsole();
  const parsed = normalizeSourceUrl(String(formData.get("url") ?? ""));
  if (!parsed) redirect(back(`view=sources&error=${encodeURIComponent("That isn't a web address — paste the company's news page, e.g. https://example.co.uk/news/.")}`));
  const label = String(formData.get("label") ?? "").trim() || null;
  const { error } = await serviceDb().from("content_sources").insert({ url: parsed.url, domain: parsed.domain, label });
  if (error) {
    if (error.code === "23505") redirect(back(`view=sources&error=${encodeURIComponent("That news page is already on the list.")}`));
    logError({ source: "db", area: "action:addSource", error: error.message, context: { code: error.code ?? null } });
    redirect(back(`view=sources&error=${encodeURIComponent("The source couldn't be added — please try again.")}`));
  }
  revalidatePath(PAGE);
  redirect(back("view=sources&added=1"));
}

/** Pause or resume a source. A paused source is never fetched. */
export async function setSourceActive(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  await serviceDb().from("content_sources").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath(PAGE);
  redirect(back(`view=sources&${String(formData.get("return") ?? "")}`));
}

/**
 * Forget how a source is read and put it first in line: the next job run
 * works the method out from scratch. For a site that has moved to a feed, or
 * one Jas has fixed the address of.
 */
export async function recheckSource(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  await serviceDb().from("content_sources").update({
    method: null, method_url: null, failure_count: 0, last_checked_at: null, updated_at: new Date().toISOString(),
  }).eq("id", id);
  revalidatePath(PAGE);
  redirect(back(`view=sources&queued=1&${String(formData.get("return") ?? "")}`));
}

/**
 * A source linked to a Bigin company follows that company's News Page URL:
 * changed or removed here, the next Bigin sync would undo it (pause the edited
 * row and re-add Bigin's address). So the address is changed in Bigin.
 */
const BIGIN_OWNED = "This source comes from a Bigin company's News Page URL — change or clear it in Bigin, or pause it here.";
async function biginLinked(id: string): Promise<boolean> {
  const { data } = await serviceDb().from("content_sources").select("bigin_account_id").eq("id", id).maybeSingle();
  return !!data?.bigin_account_id;
}

/** Change a source's address (e.g. a news page that moved), which also re-checks it. */
export async function updateSourceUrl(formData: FormData) {
  await requireConsole();
  const id = String(formData.get("id") ?? "");
  if (await biginLinked(id)) redirect(back(`view=sources&error=${encodeURIComponent(BIGIN_OWNED)}`));
  const parsed = normalizeSourceUrl(String(formData.get("url") ?? ""));
  if (!parsed) redirect(back(`view=sources&error=${encodeURIComponent("That isn't a web address.")}`));
  const { error } = await serviceDb().from("content_sources").update({
    url: parsed.url, domain: parsed.domain, method: null, method_url: null, access: "unknown",
    failure_count: 0, last_checked_at: null, last_error: null, updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) {
    if (error.code === "23505") redirect(back(`view=sources&error=${encodeURIComponent("That news page is already on the list.")}`));
    logError({ source: "db", area: "action:updateSourceUrl", error: error.message, context: { code: error.code ?? null } });
    redirect(back(`view=sources&error=${encodeURIComponent("The address couldn't be changed — please try again.")}`));
  }
  revalidatePath(PAGE);
  redirect(back("view=sources&queued=1"));
}

/** Remove a source and every link it found. Drafted stories are kept — only their link back goes. */
export async function deleteSource(formData: FormData) {
  await requireConsole();
  if (formData.get("confirm") !== "1") redirect(back(`view=sources&error=${encodeURIComponent("Tick the box to confirm removing the source.")}`));
  if (await biginLinked(String(formData.get("id") ?? ""))) redirect(back(`view=sources&error=${encodeURIComponent(BIGIN_OWNED)}`));
  await serviceDb().from("content_sources").delete().eq("id", String(formData.get("id") ?? ""));
  revalidatePath(PAGE);
  redirect(back("view=sources&removed=1"));
}

/** Not news worth a story. Kept, not deleted, so the same link never comes back as new. */
export async function dismissSuggestion(formData: FormData) {
  await requireConsole();
  await serviceDb().from("source_items")
    .update({ state: "dismissed", updated_at: new Date().toISOString() })
    .eq("id", String(formData.get("id") ?? ""))
    .eq("state", "new");
  revalidatePath(PAGE);
  redirect(back(String(formData.get("return") ?? "")));
}

/**
 * Turn a suggestion into an ordinary admin draft titled after the article,
 * and open it in the story editor. The source link stays on the suggestion
 * (shown in the editor) — it is never written into the story body, where it
 * could go live by accident.
 *
 * A source matched to a member (Bigin sync, lib/sources/bigin.ts) tags the
 * draft with them as its subject, provided they still have a live page. An
 * admin draft naming a member is not shown to that member (memberContent and
 * member_read_own_stories), and the editor can change the tag before it goes
 * anywhere.
 */
export async function startStoryFromSuggestion(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id") ?? "");
  const { data: item } = await db.from("source_items")
    .select("id, title, state, story_id, source:content_sources(member:members(id, status, archived_at))")
    .eq("id", id).maybeSingle();
  if (!item) redirect(back(`error=${encodeURIComponent("That suggestion no longer exists.")}`));
  // A second click (or a second admin) lands on the story already started.
  if (item.state === "drafted" && item.story_id) redirect(`/console/stories/${item.story_id}`);

  const member = item.source?.member ?? null;
  const memberId = isMemberLinkable(member) ? member.id : null;

  const { data: story, error } = await db.from("stories").insert({
    title: item.title,
    slug: `${slugify(item.title) || "story"}-${Date.now().toString(36)}`,
    status: "draft",
    source: "admin",
    submitted_by: user.userId,
    member_id: memberId,
  }).select("id").single();
  if (error || !story) {
    logError({ source: "db", area: "action:startStoryFromSuggestion", error: error?.message ?? "no row", context: { item: id } });
    redirect(back(`error=${encodeURIComponent("The draft couldn't be created — please try again.")}`));
  }
  let tagNote = "";
  if (memberId) {
    // story_members holds every tagged member, primary included (20261015000003).
    // If that write fails, the draft goes untagged rather than half-tagged.
    try {
      await replaceStoryMembers(db, story.id, [memberId]);
    } catch (e) {
      logError({ source: "db", area: "action:startStoryFromSuggestion", error: e, context: { story: story.id, member: memberId } });
      await db.from("stories").update({ member_id: null }).eq("id", story.id);
      tagNote = `?error=${encodeURIComponent("The draft was created, but its member couldn't be tagged — choose them in the editor.")}`;
    }
  }
  await db.from("source_items").update({ state: "drafted", story_id: story.id, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath(PAGE);
  revalidatePath("/console/stories");
  redirect(`/console/stories/${story.id}${tagNote}`);
}

/**
 * "Sync from Bigin now": the daily source_bigin_sync, on demand. Respects
 * the Story crawler flag like the job does.
 */
export async function syncSourcesFromBigin() {
  await requireConsole();
  if (!(await isFeatureEnabled("story_crawler"))) {
    redirect(back(`view=sources&error=${encodeURIComponent("The story crawler is off — turn it on in Features first.")}`));
  }
  let run: Awaited<ReturnType<typeof syncBiginSources>>;
  try {
    run = await syncBiginSources();
  } catch (e) {
    logError({ source: "job", area: "action:syncSourcesFromBigin", error: e });
    redirect(back(`view=sources&error=${encodeURIComponent("The Bigin sync failed part-way — please try again.")}`));
  }
  if (!run) redirect(back(`view=sources&error=${encodeURIComponent("Bigin isn't connected, so there's nothing to sync.")}`));
  revalidatePath(PAGE);
  redirect(back("view=sources&bigin=synced"));
}

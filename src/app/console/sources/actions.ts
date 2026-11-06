"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { logError } from "@/lib/log";
import { removeMedia, uploadImage } from "@/lib/media";
import { isMemberLinkable } from "@/lib/member-visibility";
import { syncCompanies } from "@/lib/crm-companies/sync";
import { prepareDraft } from "@/lib/sources/draft";
import { NOT_STARTED, runSourceCheck, type SourceCheckOutcome } from "@/lib/sources/run";
import { normalizeSourceUrl } from "@/lib/sources/extract";
import { UploadRejectedError } from "@/lib/upload-limits";
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
 * "Start story" on a suggestion: an admin draft pre-loaded from the article
 * page — title, summary, body rewritten to third person, cover image, and the
 * member's name linked to their page (lib/sources/draft.ts; Luiza, 28 Oct).
 * The article's own text is kept in story_originals so the editor can show
 * it next to the rewrite. Whatever couldn't be loaded is listed in a notice;
 * the draft is always made.
 *
 * A source matched to a member (Bigin sync, lib/sources/bigin.ts) tags the
 * draft with them as its subject, provided they still have a live page, and
 * the draft takes their industry. An admin draft naming a member is not shown
 * to that member (memberContent and member_read_own_stories), and the editor
 * can change the tag before it goes anywhere.
 */
export async function startStoryFromSuggestion(formData: FormData) {
  const user = await requireConsole();
  const db = serviceDb();
  const id = String(formData.get("id") ?? "");
  const { data: item } = await db.from("source_items")
    .select("id, url, title, state, story_id, source:content_sources(label, domain, bigin_account_name, member:members(id, name, slug, industry_id, status, archived_at))")
    .eq("id", id).maybeSingle();
  if (!item) redirect(back(`error=${encodeURIComponent("That suggestion no longer exists.")}`));
  // A second click (or a second admin) lands on the story already started.
  if (item.state === "drafted" && item.story_id) redirect(`/console/stories/${item.story_id}`);

  const member = item.source?.member ?? null;
  const linked = isMemberLinkable(member) ? member : null;
  const company = linked?.name ?? item.source?.bigin_account_name ?? item.source?.label ?? item.source?.domain ?? "the company";

  const draft = await prepareDraft({ url: item.url, title: item.title, company, member: linked });
  const notes = [...draft.notes];

  let coverPath: string | null = null;
  if (draft.cover) {
    try {
      coverPath = await uploadImage(draft.cover, "stories");
    } catch (e) {
      // A refused image (not really an image, too large once decoded) is a note, not a failure.
      if (!(e instanceof UploadRejectedError)) logError({ source: "server", area: "action:startStoryFromSuggestion", error: e, context: { item: id } });
      notes.push("The article's image couldn't be used — add a cover by hand.");
    }
  }

  const { data: story, error } = await db.from("stories").insert({
    title: draft.title,
    slug: `${slugify(draft.title) || "story"}-${Date.now().toString(36)}`,
    excerpt: draft.excerpt,
    body: draft.body,
    cover_path: coverPath,
    status: "draft",
    source: "admin",
    submitted_by: user.userId,
    member_id: linked?.id ?? null,
    industry_id: linked?.industry_id ?? null,
  }).select("id").single();
  if (error || !story) {
    logError({ source: "db", area: "action:startStoryFromSuggestion", error: error?.message ?? "no row", context: { item: id } });
    // Nothing points at the cover yet — don't leave it in storage.
    if (coverPath) await removeMedia(coverPath);
    redirect(back(`error=${encodeURIComponent("The draft couldn't be created — please try again.")}`));
  }

  let tagError = "";
  if (linked) {
    // story_members holds every tagged member, primary included (20261015000003).
    // If that write fails, the draft goes untagged rather than half-tagged.
    try {
      await replaceStoryMembers(db, story.id, [linked.id]);
    } catch (e) {
      logError({ source: "db", area: "action:startStoryFromSuggestion", error: e, context: { story: story.id, member: linked.id } });
      await db.from("stories").update({ member_id: null }).eq("id", story.id);
      tagError = "The draft was created, but its member couldn't be tagged — choose them in the editor.";
    }
  }
  if (draft.original) {
    const { error: originalError } = await db.from("story_originals")
      .insert({ story_id: story.id, source_url: item.url, body: draft.original, rewritten: draft.rewritten });
    if (originalError) {
      logError({ source: "db", area: "action:startStoryFromSuggestion", error: originalError.message, context: { story: story.id } });
      notes.push("The article's original text couldn't be saved alongside the draft.");
    }
  }
  // Claim the suggestion only if nobody else did while the draft was being
  // prepared (up to a minute): a second admin, or a second tab. The loser's
  // draft is removed rather than left orphaned, and it opens the winner's.
  const { data: claimed, error: claimError } = await db.from("source_items")
    .update({ state: "drafted", story_id: story.id, updated_at: new Date().toISOString() })
    .eq("id", id).eq("state", item.state)
    .select("id").maybeSingle();
  if (claimError) {
    // Couldn't tell — keep the draft and open it, as before this check existed.
    logError({ source: "db", area: "action:startStoryFromSuggestion", error: claimError.message, context: { item: id, story: story.id } });
  } else if (!claimed) {
    await db.from("stories").delete().eq("id", story.id);
    if (coverPath) await removeMedia(coverPath);
    const { data: now } = await db.from("source_items").select("state, story_id").eq("id", id).maybeSingle();
    revalidatePath(PAGE);
    if (now?.state === "drafted" && now.story_id) redirect(`/console/stories/${now.story_id}`);
    redirect(back(`error=${encodeURIComponent("That suggestion changed while the draft was being prepared, so no draft was made.")}`));
  }
  revalidatePath(PAGE);
  revalidatePath("/console/stories");
  const query = new URLSearchParams();
  if (tagError) query.set("error", tagError);
  if (notes.length) query.set("notice", notes.join("\n"));
  const qs = query.toString();
  redirect(`/console/stories/${story.id}${qs ? `?${qs}` : ""}`);
}

/**
 * "Sync from Bigin now": the daily source_bigin_sync (the company sync,
 * lib/crm-companies/sync), on demand. Respects the Story crawler flag like
 * the job does; CRM's "Sync companies" is the one that works with it off.
 */
export async function syncSourcesFromBigin() {
  await requireConsole();
  if (!(await isFeatureEnabled("story_crawler"))) {
    redirect(back(`view=sources&error=${encodeURIComponent("The story crawler is off — turn it on in Features first.")}`));
  }
  let run: Awaited<ReturnType<typeof syncCompanies>>;
  try {
    run = await syncCompanies();
  } catch (e) {
    logError({ source: "job", area: "action:syncSourcesFromBigin", error: e });
    redirect(back(`view=sources&error=${encodeURIComponent("The Bigin sync failed part-way — please try again.")}`));
  }
  if (!run) redirect(back(`view=sources&error=${encodeURIComponent("Bigin isn't connected, so there's nothing to sync.")}`));
  revalidatePath(PAGE);
  redirect(back("view=sources&bigin=synced"));
}

/** Where "Check sources now" may send the admin back to: the pages that show the button. */
const CHECK_RETURNS = ["/console", "/console/sources", "/console/sources?view=sources"] as const;

/**
 * "Check sources now" (issue #42): one source check, the same batch a
 * scheduled run does, started by an admin from Command Centre or Story
 * sources. It runs inside the click (up to 55s, so both pages allow 120s) and
 * ignores the once-a-day rule: it reads the least recently checked sources
 * even if they were checked within the day. It never runs alongside another check: a second click while one runs gets "busy",
 * and nothing is fetched (lib/sources/run).
 *
 * The redirect names the run it started (`checkrun`), so the page reports
 * that run's suggestions and not those of a scheduled run that finished since.
 */
export async function checkSourcesNow(formData: FormData) {
  const user = await requireConsole();
  const ret = CHECK_RETURNS.find((r) => r === formData.get("return")) ?? "/console/sources";
  const to = (result: string, runId?: string) =>
    `${ret}${ret.includes("?") ? "&" : "?"}sourcecheck=${result}${runId ? `&checkrun=${runId}` : ""}#source-check`;
  if (!(await isFeatureEnabled("story_crawler"))) redirect(to("off"));
  let outcome: SourceCheckOutcome;
  try {
    outcome = await runSourceCheck({ startedBy: user.displayName || user.email, force: true });
  } catch (e) {
    logError({ source: "job", area: "action:checkSourcesNow", error: e });
    // Before the lock nothing ran; after it, the record keeps what was reached.
    redirect(to(e instanceof Error && e.name === NOT_STARTED ? "notstarted" : "failed"));
  }
  revalidatePath("/console");
  revalidatePath(PAGE);
  if (outcome.status === "busy") redirect(to("busy"));
  // Unfinished: a site was still winding down at the hard stop, so the lock is held a few minutes more.
  redirect(to(outcome.run.finished_at ? "done" : "held", outcome.run.id));
}

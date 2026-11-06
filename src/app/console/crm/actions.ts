"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { adoptImportedSource } from "@/lib/crm-companies/covered";
import { companyListParams, parseCompanyListState, type CompanyListState } from "@/lib/crm-companies/list";
import { checkCompanyWriteAccess, setCompanyNewsPage, type NewsPageSave } from "@/lib/crm-companies/news-page";
import { syncCompanies } from "@/lib/crm-companies/sync";
import { serviceDb } from "@/lib/db/server";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { logError } from "@/lib/log";
import { refreshMembers } from "@/lib/sources/bigin";
import { normalizeSourceUrl } from "@/lib/sources/extract";
import { UUID_RE } from "@/lib/validate";

/*
 * The CRM page's Companies box (issue #50, spec #49, ADR 0002). Contact
 * actions stay in console/actions.ts; company actions live here — saving a
 * News Page URL (#55), "Use as News Page URL" (#56) and the member override
 * (#53) join this file. "use server": every export must be async.
 *
 * Each redirects back to the box (#companies) with `companies=` on success or
 * `companies_error=` on failure, read by the Companies box. A company form
 * carries the box's list state (`cid`, `cq`, `cfilter`, `cpage`) as hidden
 * inputs, so its redirect lands on the list the admin was looking at.
 */

const BOX = "/console/crm";

/** The box, showing `list` (the defaults when none), with `query` (a flash or an error). */
function back(query: string, list: CompanyListState = {}): string {
  const kept = new URLSearchParams(companyListParams(list)).toString();
  return `${BOX}?${kept ? `${kept}&` : ""}${query}#companies`;
}

/** Both pages that show a company's address or member. */
function revalidateCompanies() {
  revalidatePath(BOX);
  revalidatePath("/console/sources");
}

/**
 * A company form's way back: its company (`company`, a row id) and the
 * list state it carried. `done` and `fail` land on the company's panel —
 * `fail(message, { panel: false })` on the list only, for a company that
 * isn't there to open. A company id that isn't a uuid is refused here.
 */
function companyForm(formData: FormData) {
  const company = String(formData.get("company") ?? "");
  const list = parseCompanyListState((name) => formData.get(name));
  const at = (query: string, panel = true) => back(`${panel ? `company=${company}&` : ""}${query}`, list);
  const fail = (message: string, { panel = true } = {}): never => redirect(at(`companies_error=${encodeURIComponent(message)}`, panel));
  if (!UUID_RE.test(company)) fail("That company couldn't be found.", { panel: false });
  return { company, fail, done: (flash: string): never => redirect(at(`companies=${flash}`)) };
}

const NOT_ALLOWED = "Bigin doesn't let the app change companies yet, so edit in Bigin for now.";
const NOT_FOUND = "That company isn't stored any more. Sync companies and try again.";
const DELETED = "That company was deleted in Bigin, so its News Page URL can't be changed. Restore it in Bigin and sync companies to edit it again.";

/**
 * "Sync companies": the company sync, on demand. Works whether or not the
 * Story crawler is on, so CRM can always mirror Bigin (spec #49's open
 * decision, taken as its default). With the crawler off it stores the
 * companies but leaves story sources alone, as the daily job would (it
 * doesn't run at all then): the flag keeps gating everything the crawler
 * reads. Separate from "Sync with Bigin now" (contacts); neither touches the
 * other.
 */
export async function syncCompaniesNow() {
  await requireConsole();
  const crawlerOn = await isFeatureEnabled("story_crawler");
  let run: Awaited<ReturnType<typeof syncCompanies>>;
  try {
    run = await syncCompanies({ deriveSources: crawlerOn });
  } catch (e) {
    logError({ source: "job", area: "action:syncCompaniesNow", error: e });
    redirect(back(`companies_error=${encodeURIComponent("The company sync failed part-way — please try again.")}`));
  }
  if (!run) redirect(back(`companies_error=${encodeURIComponent("Bigin isn't connected, so there are no companies to sync.")}`));
  // Whether News Page URL editing is on (#55). A failed check keeps the last answer.
  await checkCompanyWriteAccess().catch((e: unknown) => logError({ source: "server", area: "action:syncCompaniesNow:writeAccess", error: e }));
  revalidateCompanies();
  redirect(back(`companies=${run.sources ? "synced" : "synced_no_sources"}`));
}

/**
 * The member override (#53): an admin chooses a CRM company's member by hand,
 * or clears the choice (an empty `member_id`) to go back to the automatic
 * match. Kept in the app only — Bigin has no member field — and never written
 * by the company sync, so it survives every sync. Either way the company's
 * story sources are re-tagged straight away (refreshMembers, the same step
 * the sync runs), so "Start story" drafts pick it up without waiting for the
 * next sync. The sources' member changes even with the Story crawler off:
 * it's only a tag, and nothing is read because of it.
 */
export async function setCompanyMember(formData: FormData) {
  await requireConsole();
  const { company, fail, done } = companyForm(formData);
  const memberId = String(formData.get("member_id") ?? "");
  if (memberId && !UUID_RE.test(memberId)) fail("Choose a member from the list.");

  const db = serviceDb();
  if (memberId) {
    const { data: member, error } = await db.from("members").select("id").eq("id", memberId).is("archived_at", null).maybeSingle();
    if (error) {
      logError({ source: "db", area: "action:setCompanyMember", error: error.message, context: { company, code: error.code ?? null } });
      fail("The member couldn't be saved — please try again.");
    }
    if (!member) fail("That member isn't available any more (archived or removed). Choose another.");
  }

  const { data: saved, error } = await db.from("crm_companies")
    .update({ member_override_id: memberId || null, updated_at: new Date().toISOString() })
    .eq("id", company)
    .select("id");
  if (error) {
    logError({ source: "db", area: "action:setCompanyMember", error: error.message, context: { company, code: error.code ?? null } });
    fail("The member couldn't be saved — please try again.");
  }
  if (!saved?.length) fail("That company couldn't be found. Sync companies and try again.", { panel: false });

  let retagged = true;
  try {
    await refreshMembers(db);
  } catch (e) {
    retagged = false;
    logError({ source: "server", area: "action:setCompanyMember", error: e, context: { company } });
  }
  revalidateCompanies();
  if (!retagged) fail("Saved, but the company's story source couldn't be re-tagged just now — the next company sync will do it.");
  done(memberId ? "member_set" : "member_cleared");
}

/**
 * Save a CRM company's News Page URL from the Companies box's editor (issue
 * #55), written through to Bigin by setCompanyNewsPage. An empty field
 * clears it, so the company's Website stands in. An address without
 * https:// is completed; anything that isn't a web address is refused before
 * anything is saved. While the Bigin token can't write companies, or for a
 * company deleted in Bigin, the editor is disabled; a post that gets here
 * anyway is refused the same way.
 */
export async function saveCompanyNewsPage(formData: FormData) {
  await requireConsole();
  const { company, fail, done } = companyForm(formData);

  const raw = String(formData.get("news_page_url") ?? "").trim();
  const parsed = raw ? normalizeSourceUrl(raw) : null;
  if (raw && !parsed) fail("That isn't a web address. Enter the page's full address, like https://example.com/news.");

  const crawlerOn = await isFeatureEnabled("story_crawler");
  let outcome: NewsPageSave | "failed";
  try {
    outcome = await setCompanyNewsPage({ id: company }, parsed?.url ?? null, { deriveSources: crawlerOn });
  } catch (e) {
    logError({ source: "server", area: "action:saveCompanyNewsPage", error: e });
    outcome = "failed";
  }
  if (outcome === "failed") fail("The News Page URL couldn't be saved. Please try again.");
  if (outcome === "not_allowed") fail(NOT_ALLOWED);
  if (outcome === "not_found") fail(NOT_FOUND);
  if (outcome === "deleted") fail(DELETED);
  revalidateCompanies();
  done(outcome === "pushed" ? "news_page_saved" : "news_page_pending");
}

/**
 * "Use as News Page URL" (#56): a company "covered by imported list" takes
 * one of those imported sources' address as its News Page URL, through the
 * same write-through as saveCompanyNewsPage, and that existing source is
 * linked to the company (no second row). The only way such a source is ever
 * linked. Refused like the editor while the Bigin token can't write
 * companies, and when the source no longer covers the company (linked
 * meanwhile, or the company got a News Page URL).
 */
export async function adoptImportedNewsPage(formData: FormData) {
  await requireConsole();
  const { company, fail, done } = companyForm(formData);
  const source = String(formData.get("source") ?? "");
  if (!UUID_RE.test(source)) fail("Choose one of the imported sources listed.");

  let result: Awaited<ReturnType<typeof adoptImportedSource>> | null = null;
  try {
    result = await adoptImportedSource(company, source);
  } catch (e) {
    logError({ source: "server", area: "action:adoptImportedNewsPage", error: e, context: { company, source } });
  }
  if (!result) return fail("The News Page URL couldn't be saved. Please try again.");
  if (result.outcome === "not_allowed") fail(NOT_ALLOWED);
  if (result.outcome === "not_found") fail(NOT_FOUND);
  if (result.outcome === "deleted") fail(DELETED);
  if (result.outcome === "not_covering") {
    fail("That imported source can't be used for this company any more: it may have been linked to a company meanwhile. Choose again from the list.");
  }
  revalidateCompanies();
  if (!result.linked) fail("News Page URL saved, but the imported source couldn't be linked just now. The next company sync will link it.");
  done(result.outcome === "pushed" ? "imported_used" : "imported_used_pending");
}

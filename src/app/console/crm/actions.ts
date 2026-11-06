"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { checkCompanyWriteAccess, setCompanyNewsPage, type NewsPageSave } from "@/lib/crm-companies/news-page";
import { syncCompanies } from "@/lib/crm-companies/sync";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { logError } from "@/lib/log";
import { normalizeSourceUrl } from "@/lib/sources/extract";

/*
 * The CRM page's Companies box (issue #50, spec #49, ADR 0002). Contact
 * actions stay in console/actions.ts; company actions live here — saving a
 * News Page URL (#55), "Use as News Page URL" (#56) and the member override
 * (#53) join this file. "use server": every export must be async.
 *
 * Each redirects back to the box (#companies) with `companies=` on success or
 * `companies_error=` on failure, read by the Companies box.
 */

const BOX = "/console/crm";
const back = (query: string) => `${BOX}?${query}#companies`;

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
  revalidatePath(BOX);
  revalidatePath("/console/sources");
  redirect(back(`companies=${run.sources ? "synced" : "synced_no_sources"}`));
}

/**
 * Save a CRM company's News Page URL from the Companies box's editor (issue
 * #55), written through to Bigin by setCompanyNewsPage. An empty field
 * clears it, so the company's Website stands in. An address without
 * https:// is completed; anything that isn't a web address is refused before
 * anything is saved. While the Bigin token can't write companies the editor
 * is disabled; a post that gets here anyway is refused the same way.
 */
export async function saveCompanyNewsPage(formData: FormData) {
  await requireConsole();
  const biginId = String(formData.get("company") ?? "").trim();
  if (!biginId) redirect(back(`companies_error=${encodeURIComponent("No company was chosen.")}`));
  const at = (query: string) => back(`company=${encodeURIComponent(biginId)}&${query}`);
  const fail = (message: string) => redirect(at(`companies_error=${encodeURIComponent(message)}`));

  const raw = String(formData.get("news_page_url") ?? "").trim();
  const parsed = raw ? normalizeSourceUrl(raw) : null;
  if (raw && !parsed) fail("That isn't a web address. Enter the page's full address, like https://example.com/news.");

  const crawlerOn = await isFeatureEnabled("story_crawler");
  let outcome: NewsPageSave | "failed";
  try {
    outcome = await setCompanyNewsPage(biginId, parsed?.url ?? null, { deriveSources: crawlerOn });
  } catch (e) {
    logError({ source: "server", area: "action:saveCompanyNewsPage", error: e });
    outcome = "failed";
  }
  if (outcome === "failed") fail("The News Page URL couldn't be saved. Please try again.");
  if (outcome === "not_allowed") fail("Bigin doesn't let the app change companies yet, so edit in Bigin for now.");
  if (outcome === "not_found") fail("That company isn't stored any more. Sync companies and try again.");
  revalidatePath(BOX);
  revalidatePath("/console/sources");
  redirect(at(`companies=${outcome === "pushed" ? "news_page_saved" : "news_page_pending"}`));
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { syncCompanies } from "@/lib/crm-companies/sync";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { logError } from "@/lib/log";

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
  revalidatePath(BOX);
  revalidatePath("/console/sources");
  redirect(back(`companies=${run.sources ? "synced" : "synced_no_sources"}`));
}

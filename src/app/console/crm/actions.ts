"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { syncCompanies } from "@/lib/crm-companies/sync";
import { serviceDb } from "@/lib/db/server";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { logError } from "@/lib/log";
import { refreshMembers } from "@/lib/sources/bigin";
import { UUID_RE } from "@/lib/validate";

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
  const company = String(formData.get("company") ?? "");
  const memberId = String(formData.get("member_id") ?? "");
  const fail = (message: string, keep = true): never =>
    redirect(back(`${keep ? `company=${company}&` : ""}companies_error=${encodeURIComponent(message)}`));
  if (!UUID_RE.test(company)) fail("That company couldn't be found.", false);
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
  if (!saved?.length) fail("That company couldn't be found. Sync companies and try again.", false);

  let retagged = true;
  try {
    await refreshMembers(db);
  } catch (e) {
    retagged = false;
    logError({ source: "server", area: "action:setCompanyMember", error: e, context: { company } });
  }
  revalidatePath(BOX);
  revalidatePath("/console/sources");
  if (!retagged) fail("Saved, but the company's story source couldn't be re-tagged just now — the next company sync will do it.");
  redirect(back(`company=${company}&companies=${memberId ? "member_set" : "member_cleared"}`));
}

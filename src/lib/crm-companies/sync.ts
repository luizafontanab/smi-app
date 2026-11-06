import { getCrmSync, type CompanyNewsPages, type CrmCompanies, type CrmSync } from "../adapters/crm";
import { serviceDb } from "../db/server";
import type { Json, Tables } from "../db/types";
import { applyBiginSources, companyNewsPages, type BiginSourcesRun } from "../sources/bigin";

/**
 * The company sync (issue #50, spec #49, ADR 0002): the app's own copy of
 * every CRM company in Bigin, and the story sources that follow from it.
 *
 *   1. Read every Bigin company (CrmSync.listCompanies).
 *   2. Store every one of them in `crm_companies` — members and non-members,
 *      with or without an address.
 *   3. Derive story sources exactly as the sources-from-Bigin sync always
 *      has (lib/sources/bigin: companyNewsPages → applyBiginSources).
 *
 * A partial read stores what it got and changes nothing destructive: no
 * company row is removed, and the source rules already never unlink or pause
 * on a partial read.
 *
 * planCompanySync is pure (records + local rows in, plan out); syncCompanies
 * only reads and writes. Later tickets hook in here: deleted-in-Bigin marks
 * (#52) in the planner, the member override (#53) in the source derivation's
 * member matching.
 *
 * Pending edits win (#55): a company whose News Page URL edit hasn't reached
 * Bigin yet (`news_page_pending_at`, lib/crm-companies/news-page.ts) keeps
 * its local News Page URL — Bigin's copy is the stale one — and that local
 * value is what its story source is derived from. Its name and Website still
 * come from Bigin.
 */

export const COMPANY_SYNC_LAST_KEY = "crm_companies_last";

/** What CRM's "last synced" line shows — `settings` key crm_companies_last. */
export type CompanySyncRun = {
  at: string;
  complete: boolean;
  /** companies Bigin returned */
  read: number;
  /** of `read`, companies not stored before */
  added: number;
  /** of `read`, stored companies whose name, Website or News Page URL changed */
  updated: number;
  /** the story-source run, or null when sources weren't derived (Story crawler off) */
  sources: BiginSourcesRun | null;
};

export type LocalCompanyRow = Pick<Tables<"crm_companies">, "bigin_id" | "name" | "website" | "news_page_url" | "news_page_pending_at">;
type CompanyWrite = Pick<LocalCompanyRow, "bigin_id" | "name" | "website" | "news_page_url">;

export type CompanyPlan = {
  /** new or changed companies, written in full */
  write: CompanyWrite[];
  /**
   * companies with a pending News Page URL edit whose name or Website
   * changed: written without the News Page URL, so the sync can't overwrite
   * the edit (an upsert would write every column it is given)
   */
  refresh: Pick<LocalCompanyRow, "bigin_id" | "name" | "website">[];
  /** unchanged companies: only their last-synced time moves */
  touch: string[];
  added: number;
  /** what the story sources are derived from */
  newsPages: CompanyNewsPages;
};

/** What the sync should do with one read of Bigin, given the companies already stored. */
export function planCompanySync(read: CrmCompanies, local: readonly LocalCompanyRow[]): CompanyPlan {
  const stored = new Map(local.map((r) => [r.bigin_id, r]));
  // The pending local value stands in for Bigin's before anything is derived from it.
  const effective: CrmCompanies = {
    complete: read.complete,
    companies: read.companies.map((c) => {
      const before = stored.get(c.id);
      return before?.news_page_pending_at ? { ...c, newsPageUrl: before.news_page_url } : c;
    }),
  };
  const plan: CompanyPlan = { write: [], refresh: [], touch: [], added: 0, newsPages: companyNewsPages(effective) };
  const seen = new Set<string>();
  for (const c of effective.companies) {
    if (seen.has(c.id)) continue; // a record repeated across pages: one row, as Bigin has one company
    seen.add(c.id);
    const row: CompanyWrite = { bigin_id: c.id, name: c.name, website: c.website, news_page_url: c.newsPageUrl };
    const before = stored.get(c.id);
    if (!before) plan.added++;
    if (before?.news_page_pending_at && (before.name !== row.name || before.website !== row.website)) {
      plan.refresh.push({ bigin_id: c.id, name: c.name, website: c.website });
    } else if (before && before.name === row.name && before.website === row.website && before.news_page_url === row.news_page_url) {
      plan.touch.push(c.id);
    } else {
      plan.write.push(row);
    }
  }
  return plan;
}

const CHUNK = 200;
const PAGE = 1000;
function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

/**
 * The `source_bigin_sync` job, "Sync companies" on CRM and "Sync from Bigin
 * now" on Story sources. Null when Bigin isn't connected. Throws on a
 * database error. `deriveSources: false` stores the companies only — the
 * CRM button with the Story crawler off (see syncCompaniesNow).
 */
export async function syncCompanies({
  crm = getCrmSync(),
  now = () => new Date(),
  deriveSources = true,
}: { crm?: CrmSync; now?: () => Date; deriveSources?: boolean } = {}): Promise<CompanySyncRun | null> {
  const read = await crm.listCompanies();
  if (!read) return null;
  const db = serviceDb();
  const fail = (what: string, error: { message: string }): never => { throw new Error(`company sync: ${what}: ${error.message}`); };

  const local: LocalCompanyRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("crm_companies").select("bigin_id, name, website, news_page_url, news_page_pending_at").order("bigin_id").range(from, from + PAGE - 1);
    if (error) fail("reading stored companies", error);
    local.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const plan = planCompanySync(read, local);
  const stamp = now().toISOString();
  for (const part of chunks(plan.write)) {
    const { error } = await db.from("crm_companies")
      .upsert(part.map((r) => ({ ...r, last_synced_at: stamp, updated_at: stamp })), { onConflict: "bigin_id" });
    if (error) fail("storing companies", error);
  }
  for (const r of plan.refresh) {
    const { error } = await db.from("crm_companies")
      .update({ name: r.name, website: r.website, last_synced_at: stamp, updated_at: stamp })
      .eq("bigin_id", r.bigin_id);
    if (error) fail("storing companies", error);
  }
  for (const part of chunks(plan.touch)) {
    const { error } = await db.from("crm_companies").update({ last_synced_at: stamp }).in("bigin_id", part);
    if (error) fail("stamping companies", error);
  }

  const sources = deriveSources ? await applyBiginSources(plan.newsPages, { now }) : null;

  const run: CompanySyncRun = {
    at: stamp,
    complete: read.complete,
    read: plan.write.length + plan.refresh.length + plan.touch.length,
    added: plan.added,
    updated: plan.write.length + plan.refresh.length - plan.added,
    sources,
  };
  const { error: saveError } = await db.from("settings").upsert({ key: COMPANY_SYNC_LAST_KEY, value: run as unknown as Json });
  if (saveError) fail("saving the run", saveError);
  return run;
}

export async function readCompanySyncRun(): Promise<CompanySyncRun | null> {
  const { data } = await serviceDb().from("settings").select("value").eq("key", COMPANY_SYNC_LAST_KEY).maybeSingle();
  return (data?.value as CompanySyncRun | undefined) ?? null;
}

import { getCrmSync, NEWS_PAGE_FIELD, type CompanyField, type CompanyFieldList, type CompanyNewsPages, type CrmCompanies, type CrmSync } from "../adapters/crm";
import { serviceDb } from "../db/server";
import type { Json, Tables } from "../db/types";
import { applyBiginSources, companyNewsPages, type BiginSourcesRun } from "../sources/bigin";

/**
 * The company sync (issue #50, spec #49, ADR 0002): the app's own copy of
 * every CRM company in Bigin, and the story sources that follow from it.
 *
 *   1. Read every Bigin company (CrmSync.listCompanies).
 *   2. Store every one of them in `crm_companies` — members and non-members,
 *      with or without an address — with a JSON copy of every Bigin field
 *      when the field list could be read (#54).
 *   3. Mark companies missing from a complete read as deleted in Bigin
 *      (#52) — kept, never removed — and clear the mark on any that came back.
 *   4. Derive story sources exactly as the sources-from-Bigin sync always
 *      has (lib/sources/bigin: companyNewsPages → applyBiginSources). A
 *      deleted company is simply absent from that read, so the source rules
 *      already unlink its source, and pause it only if it was bigin_only.
 *
 * A partial read stores what it got and changes nothing destructive: no
 * company is marked deleted (let alone removed), and the source rules already
 * never unlink or pause on a partial read. Nor does a "complete" read with no
 * companies at all — an empty CRM is far less likely than a broken read, and
 * the source rules don't trust that absence either (planBiginSources).
 *
 * Deletion is worked out only from the absence in a complete list read —
 * never from a single-record lookup (the adapter's isGone, used by the
 * contacts push, plays no part here).
 *
 * planCompanySync is pure (records + local rows in, plan out); syncCompanies
 * only reads and writes. Later tickets hook in here: the member override
 * (#53) in the source derivation's member matching.
 *
 * Pending edits win (#55): a company whose News Page URL edit hasn't reached
 * Bigin yet (`news_page_pending_at`, lib/crm-companies/news-page.ts) keeps
 * its local News Page URL — Bigin's copy is the stale one — and that local
 * value is what its story source is derived from. Its name and Website
 * still come from Bigin.
 */

export const COMPANY_SYNC_LAST_KEY = "crm_companies_last";
/** Bigin's Companies field labels from the last read that got them — `settings` key crm_company_fields (#54). */
export const COMPANY_FIELDS_KEY = "crm_company_fields";

/** What crm_company_fields holds: the labels the detail view shows, and the News Page URL field's API name. */
export type CompanyFieldLabels = { at: string; newsPageField: string; fields: CompanyField[] };

/** What CRM's "last synced" line shows — `settings` key crm_companies_last. */
export type CompanySyncRun = {
  at: string;
  complete: boolean;
  /** companies Bigin returned */
  read: number;
  /** of `read`, companies not stored before */
  added: number;
  /** of `read`, stored companies with any field changed (only name, Website and News Page URL while the field list can't be read) */
  updated: number;
  /** which fields were read (#54); absent from runs saved before it */
  fieldList?: Omit<CompanyFieldList, "fields">;
  /** stored companies newly found missing from a complete read, marked deleted in Bigin (absent before #52) */
  deleted?: number;
  /** of `read`, companies marked deleted in Bigin that came back; the mark is cleared (absent before #52) */
  restored?: number;
  /** the story-source run, or null when sources weren't derived (Story crawler off) */
  sources: BiginSourcesRun | null;
};

export type LocalCompanyRow = Pick<Tables<"crm_companies">, "bigin_id" | "name" | "website" | "news_page_url" | "deleted_in_bigin_at" | "fields" | "news_page_pending_at">;
/**
 * A company in the read is in Bigin, so every write clears the deleted mark.
 * `fields` is left out when the read didn't get every field and the row is
 * already stored, so a full copy isn't shrunk (#54).
 */
type CompanyWrite = Pick<LocalCompanyRow, "bigin_id" | "name" | "website" | "news_page_url"> & { deleted_in_bigin_at: null; fields?: Json };

/** The same JSON whatever order its keys come in — jsonb returns them in its own. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export type CompanyPlan = {
  /** new or changed companies, written in full */
  write: CompanyWrite[];
  /**
   * companies with a pending News Page URL edit that changed (or came back):
   * written without the News Page URL, so the sync can't overwrite the edit
   * (an upsert writes every column it is given)
   */
  refresh: (Pick<LocalCompanyRow, "bigin_id" | "name" | "website"> & { deleted_in_bigin_at: null; fields?: Json })[];
  /** unchanged companies: only their last-synced time moves */
  touch: string[];
  added: number;
  /** of `write`, stored companies with any field changed (only name, Website and News Page URL while the field list can't be read) */
  updated: number;
  /** of `write`, companies marked deleted in Bigin that are back in this read */
  restored: number;
  /** stored companies, not yet marked, missing from a complete read: mark them deleted in Bigin */
  markDeleted: string[];
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
  const plan: CompanyPlan = {
    write: [], refresh: [], touch: [], added: 0, updated: 0, restored: 0, markDeleted: [], newsPages: companyNewsPages(effective),
  };
  const allFields = read.fieldList?.allFields === true;
  // The News Page URL field as Bigin's field list names it (#54), for the pending value in the JSON copy.
  const newsPageKey = read.fieldList?.newsPageField ?? NEWS_PAGE_FIELD;
  const seen = new Set<string>();
  for (const c of effective.companies) {
    if (seen.has(c.id)) continue; // a record repeated across pages: one row, as Bigin has one company
    seen.add(c.id);
    const row: CompanyWrite = { bigin_id: c.id, name: c.name, website: c.website, news_page_url: c.newsPageUrl, deleted_in_bigin_at: null };
    const before = stored.get(c.id);
    // Every field, or a company seen for the first time: keep Bigin's record. Otherwise the stored copy stays.
    if (allFields || !before) {
      // A pending edit is what the copy shows too, under the field's own name.
      row.fields = (before?.news_page_pending_at ? { ...c.fields, [newsPageKey]: before.news_page_url } : c.fields) as Json;
    }
    if (!before) {
      plan.added++;
      plan.write.push(row);
      continue;
    }
    const changed = before.name !== row.name || before.website !== row.website || before.news_page_url !== row.news_page_url ||
      (allFields && canonical(before.fields) !== canonical(row.fields));
    if (changed) plan.updated++;
    if (before.deleted_in_bigin_at) plan.restored++;
    if (!changed && !before.deleted_in_bigin_at) plan.touch.push(c.id);
    else if (before.news_page_pending_at) {
      plan.refresh.push({ bigin_id: c.id, name: c.name, website: c.website, deleted_in_bigin_at: null, ...("fields" in row ? { fields: row.fields } : {}) });
    } else plan.write.push(row);
  }
  // Only a complete read can say a company is gone — and not one that found
  // no companies at all (see the module comment). A company already marked
  // keeps the time it was first found missing.
  if (read.complete && seen.size > 0) {
    for (const r of local) if (!seen.has(r.bigin_id) && !r.deleted_in_bigin_at) plan.markDeleted.push(r.bigin_id);
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
 * The `source_bigin_sync` job and "Sync companies" on CRM. Null when Bigin
 * isn't connected. Throws on a database error. `deriveSources: false`
 * stores the companies only — the CRM button with the Story crawler off
 * (see syncCompaniesNow).
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
    const { data, error } = await db.from("crm_companies").select("bigin_id, name, website, news_page_url, deleted_in_bigin_at, fields, news_page_pending_at").order("bigin_id").range(from, from + PAGE - 1);
    if (error) fail("reading stored companies", error);
    local.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const plan = planCompanySync(read, local);
  const stamp = now().toISOString();
  // Rows with and without `fields` in separate upserts: in one, PostgREST would set a missing `fields` to its default.
  const withFields = plan.write.filter((r) => "fields" in r);
  const withoutFields = plan.write.filter((r) => !("fields" in r));
  for (const part of [...chunks(withFields), ...chunks(withoutFields)]) {
    const { error } = await db.from("crm_companies")
      .upsert(part.map((r) => ({ ...r, last_synced_at: stamp, updated_at: stamp })), { onConflict: "bigin_id" });
    if (error) fail("storing companies", error);
  }
  for (const { bigin_id, ...patch } of plan.refresh) {
    const { error } = await db.from("crm_companies")
      .update({ ...patch, last_synced_at: stamp, updated_at: stamp })
      .eq("bigin_id", bigin_id);
    if (error) fail("storing companies", error);
  }
  for (const part of chunks(plan.touch)) {
    const { error } = await db.from("crm_companies").update({ last_synced_at: stamp }).in("bigin_id", part);
    if (error) fail("stamping companies", error);
  }
  for (const part of chunks(plan.markDeleted)) {
    // Never removed: kept, marked, and hidden by default in CRM (ADR 0002).
    const { error } = await db.from("crm_companies")
      .update({ deleted_in_bigin_at: stamp, updated_at: stamp })
      .in("bigin_id", part)
      .is("deleted_in_bigin_at", null);
    if (error) fail("marking companies deleted in Bigin", error);
  }

  const sources = deriveSources ? await applyBiginSources(plan.newsPages, { now }) : null;

  const run: CompanySyncRun = {
    at: stamp,
    complete: read.complete,
    read: plan.write.length + plan.refresh.length + plan.touch.length,
    added: plan.added,
    updated: plan.updated,
    deleted: plan.markDeleted.length,
    restored: plan.restored,
    sources,
    ...(read.fieldList ? { fieldList: { read: read.fieldList.read, allFields: read.fieldList.allFields, newsPageField: read.fieldList.newsPageField, newsPageFieldFound: read.fieldList.newsPageFieldFound } } : {}),
  };
  if (read.fieldList?.read === "bigin") {
    const labels: CompanyFieldLabels = { at: stamp, newsPageField: read.fieldList.newsPageField, fields: read.fieldList.fields };
    const { error } = await db.from("settings").upsert({ key: COMPANY_FIELDS_KEY, value: labels as unknown as Json });
    if (error) fail("saving the field labels", error);
  }
  const { error: saveError } = await db.from("settings").upsert({ key: COMPANY_SYNC_LAST_KEY, value: run as unknown as Json });
  if (saveError) fail("saving the run", saveError);
  return run;
}

/** The field labels from the last read of Bigin's field list, or null if it has never been read. */
export async function readCompanyFieldLabels(): Promise<CompanyFieldLabels | null> {
  const { data } = await serviceDb().from("settings").select("value").eq("key", COMPANY_FIELDS_KEY).maybeSingle();
  return (data?.value as CompanyFieldLabels | undefined) ?? null;
}

export async function readCompanySyncRun(): Promise<CompanySyncRun | null> {
  const { data } = await serviceDb().from("settings").select("value").eq("key", COMPANY_SYNC_LAST_KEY).maybeSingle();
  return (data?.value as CompanySyncRun | undefined) ?? null;
}

import "server-only";
import { KNOWN_COMPANY_FIELDS, type CompanyField } from "../adapters/crm";
import type { serviceDb } from "../db/server";
import { UUID_RE } from "../validate";
import { readCompanyMember, type CompanyMemberDetail } from "./list";
import { readCompanyFieldLabels, type CompanySyncRun } from "./sync";

/**
 * The Companies box's detail view (issue #54): every field Bigin holds for
 * one CRM company, under Bigin's own labels, read from the JSON copy the
 * company sync stores (crm_companies.fields) and the labels it keeps
 * (settings crm_company_fields).
 */

export type CompanyFieldRow = { apiName: string; label: string; value: string | null };

/** Bigin's own record keys: the id is shown elsewhere, `$`-keys are system bookkeeping. */
const hidden = (key: string) => key === "id" || key.startsWith("$");
const fromApiName = (apiName: string) => apiName.replace(/_+/g, " ").trim();

/** A Bigin value as one line of text; null when empty. Lookups and owners show their name. */
function show(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(show).filter((x): x is string => x !== null).join(", ") || null;
  if (typeof v === "object") {
    const name = (v as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim();
    return JSON.stringify(v);
  }
  return String(v);
}

/**
 * One row per field: Bigin's field list order and labels first, every one of
 * them even when empty, then any field the record has that the labels don't
 * know. With no labels (the field list has never been read), the record's
 * own fields, named from the known labels or their API name.
 */
export function companyFieldRows(fields: unknown, labels: readonly CompanyField[] | null): CompanyFieldRow[] {
  const record = fields && typeof fields === "object" && !Array.isArray(fields) ? (fields as Record<string, unknown>) : {};
  const rows: CompanyFieldRow[] = [];
  const done = new Set<string>();
  for (const f of labels ?? []) {
    if (done.has(f.apiName)) continue;
    done.add(f.apiName);
    rows.push({ apiName: f.apiName, label: f.label, value: show(record[f.apiName]) });
  }
  const known = new Map(KNOWN_COMPANY_FIELDS.map((f) => [f.apiName, f.label]));
  for (const [key, value] of Object.entries(record)) {
    if (hidden(key) || done.has(key)) continue;
    rows.push({ apiName: key, label: (!labels && known.get(key)) || fromApiName(key), value: show(value) });
  }
  return rows;
}

export type CompanyDetail = { id: string; biginId: string; name: string; lastSyncedAt: string; rows: CompanyFieldRow[] };

type Db = ReturnType<typeof serviceDb>;

/** `?company=` is raw input against a uuid column: anything else is "none selected", not a 22P02. */
export async function readCompanyDetail(db: Db, id: string | null): Promise<CompanyDetail | null> {
  if (!id || !UUID_RE.test(id)) return null;
  const [{ data, error }, labels] = await Promise.all([
    db.from("crm_companies").select("id, bigin_id, name, fields, last_synced_at").eq("id", id).maybeSingle(),
    readCompanyFieldLabels(),
  ]);
  if (error) throw new Error(`console/crm company ${id}: ${error.message}`);
  if (!data) return null;
  return { id: data.id, biginId: data.bigin_id, name: data.name, lastSyncedAt: data.last_synced_at, rows: companyFieldRows(data.fields, labels?.fields ?? null) };
}

/**
 * Everything the Companies box's one company panel (`?company=`) shows: the
 * Bigin fields (#54, read-only), the member override (#53), and the News
 * Page URL editor (#55): the Website beside it, and whether an edit is still
 * on its way to Bigin.
 */
export type OpenCompany = CompanyDetail &
  Pick<CompanyMemberDetail, "member" | "memberChosen" | "website" | "newsPageUrl" | "inUse" | "pushPending">;

export async function readOpenCompany(db: Db, id: string | null): Promise<OpenCompany | null> {
  if (!id || !UUID_RE.test(id)) return null;
  const [detail, member] = await Promise.all([readCompanyDetail(db, id), readCompanyMember(db, id)]);
  if (!detail || !member) return null;
  return {
    ...detail, member: member.member, memberChosen: member.memberChosen,
    website: member.website, newsPageUrl: member.newsPageUrl, inUse: member.inUse, pushPending: member.pushPending,
  };
}

/**
 * The quiet note under the last-synced line about which fields the sync could
 * read (#54). Null when there's nothing to say.
 */
export function describeFieldRead(run: Pick<CompanySyncRun, "fieldList">): string | null {
  const f = run.fieldList;
  if (!f) return null;
  if (f.read === "refused") {
    return "Only name, Website and News Page URL are kept: the Bigin connection isn't allowed to read the field list yet (HUMAN-TODO 1.15b).";
  }
  if (f.read === "failed") return "Only name, Website and News Page URL were read this time: Bigin's field list couldn't be read.";
  const notes: string[] = [];
  if (!f.allFields) notes.push("Not every field came back this time, so company details show the last full copy.");
  if (!f.newsPageFieldFound) notes.push(`Bigin has no field labelled "News Page URL", so ${f.newsPageField} was used.`);
  return notes.length ? notes.join(" ") : null;
}

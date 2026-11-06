import type { CompanyNewsPage, CompanyNewsPages, CrmCompanies } from "../adapters/crm";
import { allRows } from "../db/all-rows";
import { serviceDb } from "../db/server";
import type { Json, Tables } from "../db/types";
import { PUBLIC_MEMBER_STATUSES } from "../member-visibility";
import { normalizeSourceUrl } from "./extract";

/**
 * Story sources from Bigin (Luiza, 27 Oct 2026; migration
 * 20261027000004_content_sources_bigin). Each Bigin company's News Page URL
 * — or, when that's blank, its Website (5 Nov 2026; migration
 * 20261105000001, `bigin_from_website`) — is a story source alongside the
 * imported spreadsheet list:
 *
 *  · a URL already on the list (spreadsheet or console) is linked to the
 *    company — never duplicated, never paused by this sync;
 *  · a URL that isn't is added, marked bigin_only;
 *  · a company whose URL changed or was cleared loses the link on its old
 *    row, and that row is paused if it was bigin_only. Only at that moment —
 *    an admin who turns it back on keeps it on;
 *  · a partial read (Bigin refused a call part-way) adds and links but never
 *    unlinks or pauses: a company missing from a partial list isn't cleared.
 *
 * Each linked source is matched to one member — through a contact linked to
 * both the company and a member, else by website domain — so "Start story"
 * on its suggestion opens a draft already tagged. Ambiguous → nobody. An
 * admin's member override on the CRM company (crm_companies.member_override_id,
 * issue #53) beats both, on every sync.
 *
 * Since 6 Nov 2026 (issue #50) the entry point is the company sync
 * (lib/crm-companies/sync.ts): it stores every CRM company first, then hands
 * the companies to companyNewsPages and applyBiginSources here.
 *
 * The decisions are pure functions (companyNewsPages, planBiginSources,
 * matchMembers) so they can be tested without a database; applyBiginSources
 * only reads and writes.
 */

export const BIGIN_SOURCES_LAST_KEY = "bigin_sources_last";

export type BiginSourcesRun = {
  at: string;
  complete: boolean;
  /** companies with a usable address: a News Page URL, or a Website standing in for one */
  companies: number;
  /** of `companies`, those using their Website (absent on runs before 5 Nov 2026) */
  fromWebsite?: number;
  /** no company had a News Page URL, so Websites weren't used either — likely a misnamed field */
  websiteFallbackWithheld?: boolean;
  added: number;
  linked: number;
  unlinked: number;
  paused: number;
  /** URLs that aren't an address, or claimed by two companies — listed in CRM's Companies box for fixing in Bigin */
  skipped: { company: string; url: string; reason: "invalid_url" | "clash" }[];
  /** sources whose member changed this run */
  membersSet: number;
};

export type LinkedRow = Pick<Tables<"content_sources">, "id" | "url" | "bigin_account_id" | "bigin_account_name" | "bigin_only" | "bigin_from_website">;
export type UrlRow = Pick<Tables<"content_sources">, "id" | "url" | "bigin_account_id" | "bigin_only">;

export type SourcePlan = {
  /** new rows, bigin_only */
  insert: { url: string; domain: string; label: string; accountId: string; accountName: string; fromWebsite: boolean }[];
  /**
   * Existing rows to link (or whose company name changed). `reactivate`: a
   * bigin_only row Bigin lists again after it was dropped (and so paused) —
   * a fresh link from Bigin, so it runs again.
   */
  link: { id: string; accountId: string; accountName: string; reactivate: boolean; fromWebsite: boolean }[];
  /**
   * Rows losing their Bigin link, run before `link`; `pause` when the row was
   * bigin_only and no other company takes it over this run (a hand-over is in
   * both lists, and stays running).
   */
  unlink: { id: string; pause: boolean }[];
  skipped: { accountId: string; name: string; url: string; reason: "invalid_url" | "clash" }[];
};

/**
 * Each company's story-source address: its News Page URL, else its Website
 * (`fromWebsite`); a company with neither has no source.
 *
 * The Website stands in only in a read where at least one company has a News
 * Page URL. If none does, the field is most likely misnamed (NEWS_PAGE_FIELD
 * is unconfirmed, HUMAN-TODO 1.15a), and falling back would quietly swap
 * every news page already linked for a homepage. So that read gives no
 * companies at all, flagged `websiteFallbackWithheld`, which the source sync
 * treats as "nothing to change" (planBiginSources' trustAbsence).
 */
export function companyNewsPages(read: CrmCompanies): CompanyNewsPages {
  const companies: CompanyNewsPage[] = [];
  for (const c of read.companies) {
    const url = c.newsPageUrl ?? c.website;
    if (url) companies.push({ id: c.id, name: c.name, url, fromWebsite: !c.newsPageUrl });
  }
  if (companies.length === 0 || companies.some((c) => !c.fromWebsite)) return { complete: read.complete, companies };
  return { complete: read.complete, companies: [], websiteFallbackWithheld: true };
}

/**
 * What the sync should do. `linked` is every row currently linked to a
 * company; `byUrl` the existing rows for the URLs Bigin lists (linked or not).
 */
export function planBiginSources(
  read: { complete: boolean; companies: CompanyNewsPage[] },
  linked: readonly LinkedRow[],
  byUrl: readonly UrlRow[],
): SourcePlan {
  const plan: SourcePlan = { insert: [], link: [], unlink: [], skipped: [] };
  const linkedByAccount = new Map(linked.filter((r) => r.bigin_account_id).map((r) => [r.bigin_account_id!, r]));
  const rowByUrl = new Map(byUrl.map((r) => [r.url, r]));
  const unlinked = new Set<string>();
  const unlink = (row: LinkedRow) => {
    if (unlinked.has(row.id)) return;
    unlinked.add(row.id);
    plan.unlink.push({ id: row.id, pause: row.bigin_only });
  };

  // Normalise first; the first company to list a URL keeps it — and a News
  // Page URL comes before any Website, so a company's chosen news page beats
  // another company's homepage fallback to the same address.
  const wanted = new Map<string, { url: string; domain: string; name: string; fromWebsite: boolean }>();
  const urlOwner = new Map<string, string>();
  const ordered = [...read.companies.filter((c) => !c.fromWebsite), ...read.companies.filter((c) => c.fromWebsite)];
  for (const c of ordered) {
    const parsed = normalizeSourceUrl(c.url);
    if (!parsed) {
      plan.skipped.push({ accountId: c.id, name: c.name, url: c.url, reason: "invalid_url" });
      continue;
    }
    const owner = urlOwner.get(parsed.url);
    if (owner && owner !== c.id) {
      plan.skipped.push({ accountId: c.id, name: c.name, url: parsed.url, reason: "clash" });
      continue;
    }
    urlOwner.set(parsed.url, c.id);
    wanted.set(c.id, { ...parsed, name: c.name, fromWebsite: c.fromWebsite });
  }

  // Releases first, so a URL one company dropped can be picked up by another
  // in the same run whatever order Bigin lists them in.
  // A company no longer listing a usable URL: only a complete read can say so.
  // And not one that found no URLs at all while some are linked: that is a
  // renamed or misnamed field (every company reads as blank), not every
  // company clearing its page on the same day.
  const trustAbsence = read.complete && (read.companies.length > 0 || linkedByAccount.size === 0);
  if (trustAbsence) {
    for (const row of linkedByAccount.values()) if (!wanted.has(row.bigin_account_id!)) unlink(row);
  }
  // A company whose URL changed — that much a partial read does know.
  for (const [accountId, w] of wanted) {
    const current = linkedByAccount.get(accountId);
    if (current && current.url !== w.url) unlink(current);
  }

  for (const [accountId, w] of wanted) {
    const current = linkedByAccount.get(accountId);
    if (current && current.url === w.url) {
      if ((current.bigin_account_name ?? "") !== w.name || current.bigin_from_website !== w.fromWebsite) {
        plan.link.push({ id: current.id, accountId, accountName: w.name, reactivate: false, fromWebsite: w.fromWebsite });
      }
      continue;
    }

    const target = rowByUrl.get(w.url);
    if (!target) {
      plan.insert.push({ url: w.url, domain: w.domain, label: w.name || w.domain, accountId, accountName: w.name, fromWebsite: w.fromWebsite });
      continue;
    }
    const holder = target.bigin_account_id;
    // Held by another company that still lists it (or might, on a partial read) → leave it with them.
    if (holder && holder !== accountId && !unlinked.has(target.id)) {
      plan.skipped.push({ accountId, name: w.name, url: w.url, reason: "clash" });
      continue;
    }
    plan.link.push({ id: target.id, accountId, accountName: w.name, reactivate: target.bigin_only && !holder, fromWebsite: w.fromWebsite });
  }

  // A row released above and re-linked to another company is a hand-over: it
  // stays running (never paused), but its unlink is kept, because the unlinks
  // run before the links. Dropping it broke a swap — A takes B's page and B
  // takes A's — where the first link hit the unique index on bigin_account_id
  // while the other row still held that company.
  const relinked = new Set(plan.link.map((l) => l.id));
  plan.unlink = plan.unlink.map((u) => (relinked.has(u.id) ? { ...u, pause: false } : u));
  return plan;
}

/**
 * The member each company's source belongs to. An admin's override for the
 * company (`overrides`, by Bigin id — issue #53) wins outright: it was chosen
 * by hand, so it isn't second-guessed by the eligibility rule below.
 * Otherwise a contact linked to both the company and an eligible member wins;
 * with no such contact, a single eligible member whose website is on the
 * source's domain. Two candidates either way → null: a wrong tag is worse
 * than none.
 */
export function matchMembers(
  sources: readonly { accountId: string; domain: string }[],
  contacts: readonly { bigin_company_id: string | null; member_id: string | null }[],
  members: readonly { id: string; website: string | null }[],
  overrides: ReadonlyMap<string, string> = new Map(),
): Map<string, string | null> {
  const eligible = new Set(members.map((m) => m.id));
  const byCompany = new Map<string, Set<string>>();
  for (const c of contacts) {
    if (!c.bigin_company_id || !c.member_id || !eligible.has(c.member_id)) continue;
    const set = byCompany.get(c.bigin_company_id) ?? new Set<string>();
    set.add(c.member_id);
    byCompany.set(c.bigin_company_id, set);
  }
  const byDomain = new Map<string, Set<string>>();
  for (const m of members) {
    const domain = m.website ? normalizeSourceUrl(m.website)?.domain : null;
    if (!domain) continue;
    const set = byDomain.get(domain) ?? new Set<string>();
    set.add(m.id);
    byDomain.set(domain, set);
  }
  const only = (set: Set<string> | undefined) => (set?.size === 1 ? [...set][0] : null);
  const result = new Map<string, string | null>();
  for (const s of sources) {
    const chosen = overrides.get(s.accountId);
    if (chosen) {
      result.set(s.accountId, chosen);
      continue;
    }
    const viaContacts = byCompany.get(s.accountId);
    result.set(s.accountId, viaContacts?.size ? only(viaContacts) : only(byDomain.get(s.domain)));
  }
  return result;
}

const IN_CHUNK = 200;
function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += IN_CHUNK) out.push(items.slice(i, i + IN_CHUNK));
  return out;
}

/**
 * Story sources from one read of Bigin's companies (already turned into
 * addresses by companyNewsPages). Called by the company sync
 * (lib/crm-companies/sync.ts) — the `source_bigin_sync` job, "Sync companies"
 * on CRM and "Sync from Bigin now" on Story sources. Throws on a database
 * error; the run's counts are saved to settings.bigin_sources_last for the
 * console.
 */
export async function applyBiginSources(read: CompanyNewsPages, { now = () => new Date() }: { now?: () => Date } = {}): Promise<BiginSourcesRun> {
  const db = serviceDb();
  const fail = (what: string, error: { message: string }) => { throw new Error(`source_bigin_sync: ${what}: ${error.message}`); };

  const { data: linked, error: linkedError } = await db.from("content_sources")
    .select("id, url, bigin_account_id, bigin_account_name, bigin_only, bigin_from_website")
    .not("bigin_account_id", "is", null);
  if (linkedError) fail("reading linked sources", linkedError);

  const urls = [...new Set(read.companies.map((c) => normalizeSourceUrl(c.url)?.url).filter((u): u is string => !!u))];
  const byUrl: UrlRow[] = [];
  for (const part of chunks(urls)) {
    const { data, error } = await db.from("content_sources").select("id, url, bigin_account_id, bigin_only").in("url", part);
    if (error) fail("reading sources by address", error);
    byUrl.push(...(data ?? []));
  }

  const plan = planBiginSources(read, linked ?? [], byUrl);
  const stamp = now().toISOString();
  let added = 0;

  // Unlink before linking: a hand-over between companies frees the unique index first.
  for (const u of plan.unlink) {
    const { error } = await db.from("content_sources").update({
      bigin_account_id: null, bigin_account_name: null, bigin_from_website: false, updated_at: stamp, ...(u.pause ? { active: false } : {}),
    }).eq("id", u.id);
    if (error) fail(`unlinking source ${u.id}`, error);
  }
  for (const l of plan.link) {
    const { error } = await db.from("content_sources")
      .update({
        bigin_account_id: l.accountId, bigin_account_name: l.accountName || null, bigin_from_website: l.fromWebsite,
        updated_at: stamp, ...(l.reactivate ? { active: true } : {}),
      })
      .eq("id", l.id);
    if (error) fail(`linking source ${l.id}`, error);
  }
  for (const i of plan.insert) {
    const { data, error } = await db.from("content_sources").insert({
      url: i.url, domain: i.domain, label: i.label, active: true, bigin_only: true,
      bigin_account_id: i.accountId, bigin_account_name: i.accountName || null, bigin_from_website: i.fromWebsite,
    }).select("id");
    // 23505: added by hand (or another run) since this one read the list — next run links it.
    if (error && error.code !== "23505") fail(`adding ${i.url}`, error);
    if (!error) added += data?.length ?? 1;
  }

  const membersSet = await refreshMembers(db);

  const run: BiginSourcesRun = {
    at: stamp,
    complete: read.complete,
    companies: read.companies.length,
    fromWebsite: read.companies.filter((c) => c.fromWebsite).length,
    ...(read.websiteFallbackWithheld ? { websiteFallbackWithheld: true } : {}),
    added,
    linked: plan.link.length,
    // a hand-over is unlinked then linked in the same run — not a loss
    unlinked: plan.unlink.filter((u) => !plan.link.some((l) => l.id === u.id)).length,
    paused: plan.unlink.filter((u) => u.pause).length,
    // A bad URL is Bigin data to fix, not an app error — listed, not logged.
    skipped: plan.skipped.slice(0, 50).map((x) => ({ company: x.name || x.accountId, url: x.url, reason: x.reason })),
    membersSet,
  };
  const { error: saveError } = await db.from("settings").upsert({ key: BIGIN_SOURCES_LAST_KEY, value: run as unknown as Json });
  if (saveError) fail("saving the run", saveError);
  return run;
}

/**
 * Re-match every Bigin-linked source to its member, the admin's override
 * winning; returns how many changed. Run by each source sync, and straight
 * after the member override is set or cleared in CRM (console/crm/actions).
 */
export async function refreshMembers(db: ReturnType<typeof serviceDb> = serviceDb()): Promise<number> {
  const { data: sources, error } = await db.from("content_sources")
    .select("id, domain, bigin_account_id, member_id")
    .not("bigin_account_id", "is", null);
  if (error) throw new Error(`source_bigin_sync: reading sources for members: ${error.message}`);
  if (!sources?.length) return 0;

  const accountIds = sources.map((s) => s.bigin_account_id!);
  const contacts: { bigin_company_id: string | null; member_id: string | null }[] = [];
  const overrides = new Map<string, string>();
  for (const part of chunks(accountIds)) {
    const { data, error: e } = await db.from("contacts").select("bigin_company_id, member_id").in("bigin_company_id", part).not("member_id", "is", null);
    if (e) throw new Error(`source_bigin_sync: reading contacts: ${e.message}`);
    contacts.push(...(data ?? []));
    const { data: chosen, error: oe } = await db.from("crm_companies").select("bigin_id, member_override_id").in("bigin_id", part).not("member_override_id", "is", null);
    if (oe) throw new Error(`source_bigin_sync: reading member overrides: ${oe.message}`);
    for (const c of chosen ?? []) if (c.member_override_id) overrides.set(c.bigin_id, c.member_override_id);
  }
  // Only members with a live page: the same rule a story's byline uses (member-visibility).
  const members = await allRows<{ id: string; website: string | null }>((from, to) =>
    db.from("members").select("id, website").is("archived_at", null).in("status", [...PUBLIC_MEMBER_STATUSES]).order("id").range(from, to));

  const matched = matchMembers(sources.map((s) => ({ accountId: s.bigin_account_id!, domain: s.domain })), contacts, members, overrides);
  let changed = 0;
  for (const s of sources) {
    const memberId = matched.get(s.bigin_account_id!) ?? null;
    if (memberId === s.member_id) continue;
    const { error: e } = await db.from("content_sources").update({ member_id: memberId, updated_at: new Date().toISOString() }).eq("id", s.id);
    if (e) throw new Error(`source_bigin_sync: setting member on ${s.id}: ${e.message}`);
    changed++;
  }
  return changed;
}

export async function readBiginSourcesRun(): Promise<BiginSourcesRun | null> {
  const { data } = await serviceDb().from("settings").select("value").eq("key", BIGIN_SOURCES_LAST_KEY).maybeSingle();
  return (data?.value as BiginSourcesRun | undefined) ?? null;
}

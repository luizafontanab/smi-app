import "server-only";
import { lastPage, pagedList } from "@/app/console/paged-list";
import { allRows } from "../db/all-rows";
import type { serviceDb } from "../db/server";
import { ilikeTerm } from "../queries";
import { normalizeSourceUrl } from "../sources/extract";

/**
 * The read model behind CRM's Companies box (issue #50): one page of stored
 * CRM companies, with what the box shows beside each — which address is in
 * use, how many of the app's contacts are linked to it, and the member its
 * story source is matched to.
 *
 * The member shown is the admin's override when there is one (#53), else
 * the member the company's source is matched to.
 *
 * Companies deleted in Bigin (#52) are hidden under every filter but their
 * own, "Deleted in Bigin".
 *
 * "Covered by imported list" (#56): a company with no News Page URL whose
 * Website is on the same domain as an imported source (bigin_only false)
 * that no company is linked to. Many of the imported spreadsheet's pages are
 * these companies' news pages under a slightly different address, so they're
 * already watched. It's a display state worked out here at read time, never
 * stored and never acted on by the sync: the source is linked only when an
 * admin clicks "Use as News Page URL" (lib/crm-companies/covered.ts). Such a
 * company shows under its own filter, not under "Using website".
 */

export const COMPANY_FILTERS = ["all", "using_website", "no_address", "covered", "deleted"] as const;
export type CompanyFilter = (typeof COMPANY_FILTERS)[number];
export const COMPANY_FILTER_LABEL: Record<CompanyFilter, string> = {
  all: "All", using_website: "Using website", no_address: "No address", covered: "Covered by imported list", deleted: "Deleted in Bigin",
};

export function parseCompanyFilter(raw: unknown): CompanyFilter {
  return COMPANY_FILTERS.find((f) => f === raw) ?? "all";
}

/** Which address the company's story source comes from, by the rule the sync applies. */
export type AddressInUse = "news_page" | "website" | "none";
export function addressInUse(c: { news_page_url: string | null; website: string | null }): AddressInUse {
  return c.news_page_url ? "news_page" : c.website ? "website" : "none";
}

/** An imported source that could be the company's News Page URL (#56). */
export type CoveringSource = { id: string; url: string; label: string | null };

/** The domain of a company's Website, the way story sources record theirs (no www., lower case). */
export function websiteDomain(website: string | null): string | null {
  return website ? normalizeSourceUrl(website)?.domain ?? null : null;
}

export type CompanyListRow = {
  id: string;
  biginId: string;
  name: string;
  website: string | null;
  newsPageUrl: string | null;
  inUse: AddressInUse;
  lastSyncedAt: string;
  /** when the sync first found it missing from a complete Bigin read; null while Bigin has it */
  deletedInBiginAt: string | null;
  /** contacts here (not in Bigin) whose Bigin company is this one */
  contacts: number;
  /** the admin's member override, else the member the company's story source is matched to */
  member: { id: string; name: string } | null;
  /** `member` was chosen by hand in CRM (#53), not matched automatically */
  memberChosen: boolean;
  /** its story source on Story Sources, if Bigin's address made one (#51) */
  sourceId: string | null;
  /** a News Page URL edit made here that Bigin hasn't accepted yet (#55) */
  pushPending: boolean;
  /** the unlinked imported sources on its Website's domain; any → "covered by imported list" (#56) */
  covered: CoveringSource[];
};

type Db = ReturnType<typeof serviceDb>;
type SourceRow = CoveringSource & { domain: string; bigin_account_id: string | null; bigin_only: boolean };

/**
 * Imported sources linked to no company, by domain: all of them, or those on
 * `domains`. Filtered again here, so only rows that qualify ever count.
 */
async function readImportedSources(db: Db, domains?: string[]): Promise<Map<string, CoveringSource[]>> {
  const byDomain = new Map<string, CoveringSource[]>();
  if (domains && !domains.length) return byDomain;
  const rows = await allRows<SourceRow>(async (from, to) => {
    let query = db.from("content_sources")
      .select("id, url, label, domain, bigin_account_id, bigin_only")
      .is("bigin_account_id", null)
      .eq("bigin_only", false);
    if (domains) query = query.in("domain", domains);
    const { data, error } = await query.order("url").range(from, to);
    if (error) throw new Error(`console/crm imported sources: ${error.message}`);
    return { data: Array.isArray(data) ? data : [] };
  });
  for (const s of rows) {
    if (s.bigin_account_id || s.bigin_only || !s.domain) continue;
    const list = byDomain.get(s.domain) ?? [];
    list.push({ id: s.id, url: s.url, label: s.label ?? null });
    byDomain.set(s.domain, list);
  }
  return byDomain;
}

/** What covers a company, given the imported sources by domain: nothing once it has a News Page URL or is gone from Bigin. */
function coveredBy(
  c: { website: string | null; news_page_url: string | null; deleted_in_bigin_at?: string | null },
  imported: ReadonlyMap<string, CoveringSource[]>,
): CoveringSource[] {
  if (c.news_page_url || c.deleted_in_bigin_at) return [];
  const domain = websiteDomain(c.website);
  return (domain && imported.get(domain)) || [];
}

const LIST_SELECT = "id, bigin_id, name, website, news_page_url, last_synced_at, deleted_in_bigin_at, news_page_pending_at, override:members!crm_companies_member_override_id_fkey(id, name)" as const;

export async function readCompanyList(
  db: Db,
  { q = "", filter = "all", page = 1, size = 50, biginId }: {
    q?: string; filter?: CompanyFilter; page?: number; size?: number;
    /** just this company: where a Bigin-linked source on Story Sources links to (#51) */
    biginId?: string;
  },
): Promise<{ rows: CompanyListRow[]; count: number; page: number }> {
  const term = ilikeTerm(q);
  const search = term ? `name.ilike.%${term}%,website.ilike.%${term}%,news_page_url.ilike.%${term}%` : null;

  let data: { id: string; bigin_id: string; name: string; website: string | null; news_page_url: string | null; last_synced_at: string; deleted_in_bigin_at: string | null; news_page_pending_at: string | null; override: { id: string; name: string } | null }[];
  let count: number;
  let shown: number;
  let imported: Map<string, CoveringSource[]>;
  if (filter === "covered" || filter === "using_website") {
    // Covered depends on the sources' domains, which a query on crm_companies
    // can't see: filter every Website-only company here, then read one page.
    imported = await readImportedSources(db);
    const candidates = await allRows<{ id: string; website: string | null }>(async (from, to) => {
      let query = db.from("crm_companies").select("id, website")
        .is("deleted_in_bigin_at", null).is("news_page_url", null).not("website", "is", null);
      if (biginId) query = query.eq("bigin_id", biginId);
      if (search) query = query.or(search);
      const { data: rows, error } = await query.order("name").order("bigin_id").range(from, to);
      if (error) throw new Error(`console/crm companies: ${error.message}`);
      return { data: rows ?? [] };
    });
    const wanted = candidates
      .filter((c) => (coveredBy({ website: c.website, news_page_url: null }, imported).length > 0) === (filter === "covered"))
      .map((c) => c.id);
    count = wanted.length;
    shown = Math.min(Math.max(1, Math.floor(page) || 1), lastPage(count, size));
    const ids = wanted.slice((shown - 1) * size, shown * size);
    if (ids.length) {
      const { data: rows, error } = await db.from("crm_companies").select(LIST_SELECT).in("id", ids).order("name").order("bigin_id");
      if (error) throw new Error(`console/crm companies: ${error.message}`);
      data = rows ?? [];
    } else data = [];
  } else {
    // Rebuilt per attempt: pagedList re-runs it as the last page when ?cpage= is past the end.
    const build = (from: number, to: number) => {
      let query = db.from("crm_companies")
        .select(LIST_SELECT, { count: "exact" })
        .order("name")
        .order("bigin_id");
      if (biginId) query = query.eq("bigin_id", biginId);
      if (search) query = query.or(search);
      query = filter === "deleted" ? query.not("deleted_in_bigin_at", "is", null) : query.is("deleted_in_bigin_at", null);
      if (filter === "no_address") query = query.is("news_page_url", null).is("website", null);
      return query.range(from, to);
    };
    ({ data, count, page: shown } = await pagedList(build, page, size, "console/crm companies"));
    const domains = data.filter((c) => !c.news_page_url && !c.deleted_in_bigin_at).map((c) => websiteDomain(c.website)).filter((d): d is string => !!d);
    imported = await readImportedSources(db, [...new Set(domains)]);
  }
  if (!data.length) return { rows: [], count, page: shown };
  const ids = data.map((c) => c.bigin_id);

  const [contacts, sources] = ids.length
    ? await Promise.all([
      allRows<{ bigin_company_id: string | null }>((from, to) =>
        db.from("contacts").select("bigin_company_id").in("bigin_company_id", ids).order("id").range(from, to)),
      db.from("content_sources").select("id, bigin_account_id, member:members(id, name)").in("bigin_account_id", ids),
    ])
    : [[], { data: [], error: null }];
  if (sources.error) throw new Error(`console/crm company sources: ${sources.error.message}`);

  const contactCount = new Map<string, number>();
  for (const c of contacts) if (c.bigin_company_id) contactCount.set(c.bigin_company_id, (contactCount.get(c.bigin_company_id) ?? 0) + 1);
  const memberOf = new Map<string, { id: string; name: string }>();
  const sourceOf = new Map<string, string>();
  for (const s of sources.data ?? []) {
    if (!s.bigin_account_id) continue;
    sourceOf.set(s.bigin_account_id, s.id);
    if (s.member) memberOf.set(s.bigin_account_id, s.member);
  }

  return {
    count,
    page: shown,
    rows: data.map((c) => ({
      id: c.id,
      biginId: c.bigin_id,
      name: c.name,
      website: c.website,
      newsPageUrl: c.news_page_url,
      inUse: addressInUse(c),
      lastSyncedAt: c.last_synced_at,
      deletedInBiginAt: c.deleted_in_bigin_at,
      contacts: contactCount.get(c.bigin_id) ?? 0,
      member: c.override ?? memberOf.get(c.bigin_id) ?? null,
      memberChosen: !!c.override,
      sourceId: sourceOf.get(c.bigin_id) ?? null,
      pushPending: !!c.news_page_pending_at,
      covered: coveredBy(c, imported),
    })),
  };
}

/**
 * One company for the Companies box's editor (`?company=`): its member, and
 * whether it was chosen by hand; its Website and News Page URL, and whether
 * an edit of the latter is still on its way to Bigin (#55).
 */
export type CompanyMemberDetail = Pick<
  CompanyListRow, "id" | "biginId" | "name" | "member" | "memberChosen" | "website" | "newsPageUrl" | "inUse" | "pushPending" | "covered"
>;

export async function readCompanyMember(db: Db, id: string): Promise<CompanyMemberDetail | null> {
  const { data: c, error } = await db.from("crm_companies")
    .select("id, bigin_id, name, website, news_page_url, news_page_pending_at, deleted_in_bigin_at, override:members!crm_companies_member_override_id_fkey(id, name)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`console/crm company: ${error.message}`);
  if (!c) return null;
  let member = c.override;
  if (!member) {
    const { data: source, error: e } = await db.from("content_sources").select("member:members(id, name)").eq("bigin_account_id", c.bigin_id).maybeSingle();
    if (e) throw new Error(`console/crm company source: ${e.message}`);
    member = source?.member ?? null;
  }
  const domain = !c.news_page_url && !c.deleted_in_bigin_at ? websiteDomain(c.website) : null;
  const imported = await readImportedSources(db, domain ? [domain] : []);
  return {
    id: c.id, biginId: c.bigin_id, name: c.name, member, memberChosen: !!c.override,
    website: c.website, newsPageUrl: c.news_page_url, inUse: addressInUse(c), pushPending: !!c.news_page_pending_at,
    covered: coveredBy(c, imported),
  };
}

import "server-only";
import { pagedList } from "@/app/console/paged-list";
import { allRows } from "../db/all-rows";
import type { serviceDb } from "../db/server";
import { ilikeTerm } from "../queries";

/**
 * The read model behind CRM's Companies box (issue #50): one page of stored
 * CRM companies, with what the box shows beside each — which address is in
 * use, how many of the app's contacts are linked to it, and the member its
 * story source is matched to.
 *
 * Later tickets hook in here: the deleted-in-Bigin filter and default (#52),
 * the member override shown beside the match (#53), and the "covered by
 * imported list" state and filter (#56) — a display state worked out at read
 * time, so it belongs in this module, not the sync.
 */

export const COMPANY_FILTERS = ["all", "using_website", "no_address"] as const;
export type CompanyFilter = (typeof COMPANY_FILTERS)[number];
export const COMPANY_FILTER_LABEL: Record<CompanyFilter, string> = { all: "All", using_website: "Using website", no_address: "No address" };

export function parseCompanyFilter(raw: unknown): CompanyFilter {
  return COMPANY_FILTERS.find((f) => f === raw) ?? "all";
}

/** Which address the company's story source comes from, by the rule the sync applies. */
export type AddressInUse = "news_page" | "website" | "none";
export function addressInUse(c: { news_page_url: string | null; website: string | null }): AddressInUse {
  return c.news_page_url ? "news_page" : c.website ? "website" : "none";
}

export type CompanyListRow = {
  id: string;
  biginId: string;
  name: string;
  website: string | null;
  newsPageUrl: string | null;
  inUse: AddressInUse;
  lastSyncedAt: string;
  /** contacts here (not in Bigin) whose Bigin company is this one */
  contacts: number;
  /** the member the company's story source is matched to, if any */
  member: { id: string; name: string } | null;
  /** its story source on Story Sources, if Bigin's address made one (#51) */
  sourceId: string | null;
};

type Db = ReturnType<typeof serviceDb>;

export async function readCompanyList(
  db: Db,
  { q = "", filter = "all", page = 1, size = 50, biginId }: {
    q?: string; filter?: CompanyFilter; page?: number; size?: number;
    /** just this company: where a Bigin-linked source on Story Sources links to (#51) */
    biginId?: string;
  },
): Promise<{ rows: CompanyListRow[]; count: number; page: number }> {
  const term = ilikeTerm(q);
  // Rebuilt per attempt: pagedList re-runs it as the last page when ?cpage= is past the end.
  const build = (from: number, to: number) => {
    let query = db.from("crm_companies")
      .select("id, bigin_id, name, website, news_page_url, last_synced_at", { count: "exact" })
      .order("name")
      .order("bigin_id");
    if (biginId) query = query.eq("bigin_id", biginId);
    if (term) query = query.or(`name.ilike.%${term}%,website.ilike.%${term}%,news_page_url.ilike.%${term}%`);
    if (filter === "using_website") query = query.is("news_page_url", null).not("website", "is", null);
    if (filter === "no_address") query = query.is("news_page_url", null).is("website", null);
    return query.range(from, to);
  };
  const { data, count, page: shown } = await pagedList(build, page, size, "console/crm companies");
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
      contacts: contactCount.get(c.bigin_id) ?? 0,
      member: memberOf.get(c.bigin_id) ?? null,
      sourceId: sourceOf.get(c.bigin_id) ?? null,
    })),
  };
}

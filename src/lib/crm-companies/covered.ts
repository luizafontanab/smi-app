import "server-only";
import { getCrmSync, type CrmSync } from "../adapters/crm";
import { serviceDb } from "../db/server";
import { coverableDomain } from "./list";
import { setCompanyNewsPage, type NewsPageSave } from "./news-page";

/**
 * "Use as News Page URL" (issue #56, spec #49, ADR 0002). A company with no
 * News Page URL is "covered by imported list" when an imported source that
 * no company is linked to is on its Website's domain (the read model works
 * that out: lib/crm-companies/list.ts). One click makes that source's
 * address the company's News Page URL, and that is the only way such a
 * source gets linked — never automatically.
 *
 * It goes through the News Page URL write-through (setCompanyNewsPage, #55):
 * saved here, marked pending, pushed to Bigin, refused up front while the
 * Bigin token can't write companies. The source's stored address is used
 * exactly as it is, so the write-through's source step finds that row by
 * its address and links it to the company: no second row. The company's
 * old source (its Website, if the Bigin sync made one) is let go as any
 * change of address does, and paused if Bigin made it.
 *
 * The source is linked even with the Story crawler off: linking an existing
 * row adds nothing to what's read.
 */

export type AdoptSourceOutcome = NewsPageSave | "not_covering";

export async function adoptImportedSource(
  companyId: string,
  sourceId: string,
  { crm = getCrmSync(), now = () => new Date() }: { crm?: CrmSync; now?: () => Date } = {},
): Promise<{ outcome: AdoptSourceOutcome; linked: boolean }> {
  const db = serviceDb();
  const [{ data: company, error: companyError }, { data: source, error: sourceError }] = await Promise.all([
    db.from("crm_companies").select("bigin_id, website, news_page_url, deleted_in_bigin_at").eq("id", companyId).maybeSingle(),
    db.from("content_sources").select("id, url, domain, bigin_account_id, bigin_only").eq("id", sourceId).maybeSingle(),
  ]);
  if (companyError) throw new Error(`reading company ${companyId}: ${companyError.message}`);
  if (sourceError) throw new Error(`reading source ${sourceId}: ${sourceError.message}`);
  if (!company) return { outcome: "not_found", linked: false };
  // Checked again here, not trusted from the page: the list may be stale, and the form is just a post.
  const domain = coverableDomain(company);
  const covers = !!source && !source.bigin_account_id && !source.bigin_only && !!domain && source.domain === domain;
  if (!covers) return { outcome: "not_covering", linked: false };

  const outcome = await setCompanyNewsPage({ id: companyId }, source.url, { crm, now, deriveSources: true });
  if (outcome !== "pushed" && outcome !== "pending") return { outcome, linked: false };

  // The write-through's source step doesn't fail the save; say whether the link landed.
  const { data: after, error } = await db.from("content_sources").select("bigin_account_id").eq("id", sourceId).maybeSingle();
  if (error) throw new Error(`reading source ${sourceId} after linking: ${error.message}`);
  return { outcome, linked: after?.bigin_account_id === company.bigin_id };
}

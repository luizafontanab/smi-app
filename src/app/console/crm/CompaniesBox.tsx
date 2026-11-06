import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { SubmitButton } from "@/components/SubmitButton";
import type { CompanySyncRun } from "@/lib/crm-companies/sync";
import { COMPANY_FILTERS, COMPANY_FILTER_LABEL, type AddressInUse, type CompanyDetail, type CompanyFilter, type CompanyListRow } from "@/lib/crm-companies/list";
import { saveCompanyNewsPage, syncCompaniesNow } from "./actions";

/**
 * CRM's Companies box (issue #50): a mirror of every CRM company in Bigin,
 * members and non-members, address or not. Its own "Sync companies" button
 * and last-synced line, separate from the contacts sync above.
 *
 * Opening a company (`?company=`) shows the editor above the table, where its
 * News Page URL is edited and written through to Bigin (#55). The Website is
 * shown, never edited here. While the Bigin token can't write companies
 * (`canEditCompanies` false), the field is disabled with "edit in Bigin for
 * now".
 *
 * Later tickets add to it: the Bigin sources panel moved from Story sources
 * (#51), the deleted-in-Bigin filter (#52), a detail editor above the table
 * for the member override (#53), every Bigin field (#54) and the News Page URL
 * (#55), and "covered by imported list" (#56).
 */

const IN_USE_LABEL: Record<AddressInUse, string> = { news_page: "News Page URL", website: "Website stand-in", none: "none" };

const fmt = (iso: string) => iso.slice(0, 16).replace("T", " ");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The last-synced line: what the run read and changed, leaving out the zeros. */
export function describeCompanyRun(run: CompanySyncRun): string {
  const parts = [plural(run.read, "company", "companies") + " read"];
  if (run.added) parts.push(`${run.added} new`);
  if (run.updated) parts.push(`${run.updated} changed`);
  const s = run.sources;
  if (!s) parts.push("story sources not updated (story crawler off)");
  else {
    const changed = [
      s.added && `${s.added} added`, s.linked && `${s.linked} linked`, s.unlinked && `${s.unlinked} unlinked`,
      s.paused && `${s.paused} paused`, s.skipped.length && `${s.skipped.length} skipped`,
    ].filter(Boolean);
    parts.push(`story sources: ${changed.length ? changed.join(", ") : "no change"}`);
  }
  return parts.join(" · ") + (run.complete ? "" : ". Bigin stopped part-way, so nothing was removed or paused.");
}

export function CompaniesBox({
  live, list, q, filter, run, flash, error, href, keep, selected, canEditCompanies,
}: {
  live: boolean;
  list: { rows: CompanyListRow[]; count: number; page: number; pages: number } | null;
  q: string;
  filter: CompanyFilter;
  run: CompanySyncRun | null;
  flash: string | undefined;
  error: string | undefined;
  /** a /console/crm link keeping the contacts box's state, ending #companies */
  href: (over: Record<string, string | number | undefined>) => string;
  /** the contacts box's state, carried through this box's search form */
  keep: Record<string, string | undefined>;
  /** the company open in the editor, if any */
  selected: CompanyDetail | null;
  /** whether the Bigin token may write companies (lib/crm-companies/news-page) */
  canEditCompanies: boolean;
}) {
  return (
    <section id="companies" aria-labelledby="companies-heading" className="mt-4 rounded-xl bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="companies-heading" className="font-bold text-ink">Companies (Bigin mirror{list ? ` — ${list.count} ${filter === "all" && !q ? "total" : "shown"}` : ""})</h2>
        {live && (
          <form action={syncCompaniesNow}>
            <SubmitButton className="rounded border px-3 py-1.5 text-sm" pendingLabel="Syncing…">Sync companies</SubmitButton>
          </form>
        )}
      </div>

      {flash === "synced" && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Companies synced from Bigin.</p>}
      {flash === "synced_no_sources" && (
        <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">
          Companies synced from Bigin. Story sources weren&apos;t updated, because the story crawler is off.
        </p>
      )}
      {flash === "news_page_saved" && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">News Page URL saved, and Bigin has it.</p>}
      {flash === "news_page_pending" && (
        <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">
          News Page URL saved. Bigin hasn&apos;t accepted it yet, so it shows as push pending and is retried automatically.
        </p>
      )}
      {error && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{error}</p>}

      {!live || !list ? (
        <p className="mt-2 text-sm text-graphite">
          Bigin isn&apos;t connected, so there are no companies to show. They appear here once the Bigin keys are set (HUMAN-TODO §7).
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-graphite">
            {run ? <>Last synced {fmt(run.at)}: {describeCompanyRun(run)}</> : "Not synced yet. Sync companies to bring in every company from Bigin."}
          </p>
          <p className="mt-1 text-xs text-graphite">
            Open a company to edit its News Page URL. Change any other detail in Bigin, then sync.
          </p>

          {selected && <CompanyEditor company={selected} canEdit={canEditCompanies} closeHref={href({ company: undefined })} />}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <nav aria-label="Filter companies" className="flex flex-wrap gap-1">
              {COMPANY_FILTERS.map((f) => (
                <Link
                  key={f}
                  href={href({ cfilter: f === "all" ? undefined : f, cpage: undefined })}
                  aria-current={f === filter ? "page" : undefined}
                  className={`rounded px-2.5 py-1 text-xs ${f === filter ? "bg-ink text-white" : "border text-graphite hover:text-ink"}`}
                >
                  {COMPANY_FILTER_LABEL[f]}
                </Link>
              ))}
            </nav>
            <form className="flex gap-2" role="search" action="/console/crm#companies">
              {Object.entries(keep).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
              {filter !== "all" && <input type="hidden" name="cfilter" value={filter} />}
              <label htmlFor="crm-company-search" className="sr-only">Search companies</label>
              <input id="crm-company-search" type="search" name="cq" defaultValue={q} placeholder="Search name, website, news page…" className="rounded border px-3 py-1.5" />
              <button className="rounded border px-3 py-1.5">Search</button>
            </form>
          </div>

          <div className="mt-3 max-h-80 overflow-y-auto">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-graphite">
                    <th scope="col" className="py-1">Company</th><th scope="col">Website</th><th scope="col">News Page URL</th>
                    <th scope="col">In use</th><th scope="col">Contacts</th><th scope="col">Member</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((c) => (
                    <tr key={c.id} className="border-t align-top">
                      <td className="py-1.5">
                        <Link href={href({ company: c.biginId })} aria-current={selected?.biginId === c.biginId ? "true" : undefined} className="text-ink underline-offset-2 hover:underline">
                          {c.name || <span className="text-graphite">(no name)</span>}
                        </Link>
                      </td>
                      <td className="max-w-48 break-all text-xs text-graphite">{c.website ?? "—"}</td>
                      <td className="max-w-48 break-all text-xs text-graphite">
                        {c.newsPageUrl ?? "—"}
                        {c.pushPending && <span className="block whitespace-nowrap text-danger">push pending</span>}
                      </td>
                      <td className={`text-xs ${c.inUse === "none" ? "text-danger" : c.inUse === "website" ? "text-graphite" : "text-success"}`}>{IN_USE_LABEL[c.inUse]}</td>
                      <td className="text-xs text-graphite">{c.contacts}</td>
                      <td className="text-xs text-graphite">{c.member?.name ?? "—"}</td>
                    </tr>
                  ))}
                  {list.rows.length === 0 && (
                    <tr><td colSpan={6} className="py-2 text-sm text-graphite">{run || q || filter !== "all" ? "No companies match." : "No companies stored yet."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination page={list.page} pages={list.pages} hrefFor={(p) => href({ cpage: p })} />
        </>
      )}
    </section>
  );
}

/**
 * The one editor above the table. Only the News Page URL is editable; an
 * empty field means the Website stands in. A save that hasn't reached Bigin
 * shows as push pending until it does.
 */
function CompanyEditor({ company, canEdit, closeHref }: { company: CompanyDetail; canEdit: boolean; closeHref: string }) {
  return (
    <div className="mt-3 rounded-lg border p-4" aria-labelledby="company-editor-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="company-editor-heading" className="font-semibold text-ink">{company.name || "(no name)"}</h3>
        <Link href={closeHref} className="text-xs text-graphite hover:text-ink">Close</Link>
      </div>
      <p className="mt-1 text-sm text-graphite">
        Website: {company.website ?? "none"} <span className="text-xs">(change it in Bigin)</span>
      </p>
      <form action={saveCompanyNewsPage} className="mt-3">
        <input type="hidden" name="company" value={company.biginId} />
        <label htmlFor="company-news-page" className="block text-sm font-medium text-ink">News Page URL</label>
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            id="company-news-page"
            name="news_page_url"
            inputMode="url"
            defaultValue={company.newsPageUrl ?? ""}
            placeholder={company.website ? `empty: ${company.website} is watched instead` : "https://example.com/news"}
            disabled={!canEdit}
            aria-describedby="company-news-page-help"
            className="min-w-0 flex-1 rounded border px-3 py-1.5 text-sm disabled:bg-paper disabled:text-graphite"
          />
          <SubmitButton disabled={!canEdit} className="rounded bg-ink px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" pendingLabel="Saving…">
            Save
          </SubmitButton>
        </div>
        <p id="company-news-page-help" className="mt-1 text-xs text-graphite">
          {canEdit
            ? "Saved here and in Bigin. Leave it empty to watch the company's Website instead."
            : "Bigin doesn't let the app change companies yet, so edit in Bigin for now."}
        </p>
        {company.pushPending && (
          <p className="mt-2 text-xs text-graphite">
            <span className="text-danger">Push pending.</span>{" "}
            Saved here, but Bigin hasn&apos;t accepted it yet. It&apos;s retried automatically, and a sync from Bigin won&apos;t undo it meanwhile.
          </p>
        )}
      </form>
    </div>
  );
}

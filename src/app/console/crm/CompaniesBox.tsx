import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { SubmitButton } from "@/components/SubmitButton";
import { NEWS_PAGE_LABEL } from "@/lib/adapters/crm";
import type { CompanySyncRun } from "@/lib/crm-companies/sync";
import {
  COMPANY_FILTERS, COMPANY_FILTER_LABEL, companyListParams, type AddressInUse, type CompanyListRow, type CompanyListState,
} from "@/lib/crm-companies/list";
import { describeFieldRead, type OpenCompany } from "@/lib/crm-companies/detail";
import type { BiginSourcesRun } from "@/lib/sources/bigin";
import { adoptImportedNewsPage, saveCompanyNewsPage, setCompanyMember, syncCompaniesNow } from "./actions";
import { BiginSourcesPanel } from "./BiginSourcesPanel";

/**
 * CRM's Companies box (issue #50): a read-only mirror of every CRM company in
 * Bigin, members and non-members, address or not. Its own "Sync companies"
 * button and last-synced line, separate from the contacts sync above.
 *
 * The Bigin sources panel moved here from Story Sources (#51); each company
 * links to its source there, and a Bigin-linked source links back with
 * `?cid=<bigin id>`, which narrows the list to that company.
 *
 * Opening a company (`?company=<row id>`, its name in the table) shows one
 * panel above the table, as Contacts has: every field Bigin holds for it,
 * read-only under Bigin's labels (#54), and the member override (#53): the
 * member chosen by hand wins over the automatic match. The same panel edits
 * the News Page URL (#55), written through to Bigin and shown as push
 * pending until Bigin accepts it; the Website is shown, never edited here.
 * While the Bigin token can't write companies (`canEditCompanies` false) the
 * field is disabled with "edit in Bigin for now".
 *
 * A company with no News Page URL whose Website shares its domain with an
 * imported source no company is linked to shows as "covered by imported
 * list" (#56), with its own filter. Its panel lists those sources, each with
 * "Use as News Page URL": the address is saved and pushed like an edit, and
 * that source is linked to the company. Disabled with the editor.
 *
 * A company deleted in Bigin (#52) stays, marked, under its own filter; the
 * other filters hide it. Its News Page URL can't be edited.
 *
 * Every company form carries the list's state (`state`) as hidden inputs, so
 * saving lands back on the same list (console/crm/actions).
 */

const IN_USE_LABEL: Record<AddressInUse, string> = { news_page: NEWS_PAGE_LABEL, website: "Website stand-in", none: "none" };

/** A stored ISO timestamp as "YYYY-MM-DD HH:MM" (UTC, as stored). */
const isoMinute = (iso: string) => iso.slice(0, 16).replace("T", " ");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The last-synced line: what the run read and changed, leaving out the zeros. */
export function describeCompanyRun(run: CompanySyncRun): string {
  const parts = [plural(run.read, "company", "companies") + " read"];
  if (run.added) parts.push(`${run.added} new`);
  if (run.updated) parts.push(`${run.updated} changed`);
  if (run.deleted) parts.push(`${run.deleted} deleted in Bigin`);
  if (run.restored) parts.push(`${run.restored} back in Bigin`);
  const s = run.sources;
  if (!s) parts.push("story sources not updated (story crawler off)");
  else {
    const changed = [
      s.added && `${s.added} added`, s.linked && `${s.linked} linked`, s.unlinked && `${s.unlinked} unlinked`,
      s.paused && `${s.paused} paused`, s.skipped.length && `${s.skipped.length} skipped`,
    ].filter(Boolean);
    parts.push(`story sources: ${changed.length ? changed.join(", ") : "no change"}`);
  }
  return parts.join(" · ") + (run.complete ? "" : ". Bigin stopped part-way, so nothing was marked deleted, unlinked or paused.");
}

export function CompaniesBox({
  live, list, state, run, sourcesRun, flash, error, href, keep, open, members, canEditCompanies,
}: {
  live: boolean;
  list: { rows: CompanyListRow[]; count: number; page: number; pages: number } | null;
  /** the list's search, filter, page and Bigin id narrowing (`?cid=`, from a Story Sources link) */
  state: CompanyListState;
  run: CompanySyncRun | null;
  /** the last time Bigin's addresses updated the story sources */
  sourcesRun: BiginSourcesRun | null;
  flash: string | undefined;
  error: string | undefined;
  /** a /console/crm link keeping the contacts box's state, ending #companies */
  href: (over: Record<string, string | number | undefined>) => string;
  /** the contacts box's state, carried through this box's search form */
  keep: Record<string, string | undefined>;
  /** the company open in the panel (`?company=`), if any */
  open: OpenCompany | null;
  /** members the override can choose from (not archived) */
  members: { id: string; name: string }[];
  /** whether the Bigin token may write companies (lib/crm-companies/news-page) */
  canEditCompanies: boolean;
}) {
  const fieldNote = run && describeFieldRead(run);
  const q = state.cq ?? "";
  const filter = state.cfilter ?? "all";
  const only = state.cid;
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
      {flash === "member_set" && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Member saved. The company&apos;s story source is tagged with them from now on.</p>}
      {flash === "member_cleared" && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Member choice cleared. The company is back on the automatic match.</p>}
      {flash === "news_page_saved" && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">News Page URL saved, and Bigin has it.</p>}
      {flash === "news_page_pending" && (
        <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">
          News Page URL saved. Bigin hasn&apos;t accepted it yet, so it shows as push pending and is retried automatically.
        </p>
      )}
      {flash === "imported_used" && (
        <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Imported address saved as the News Page URL, and Bigin has it. The imported source is now this company&apos;s.</p>
      )}
      {flash === "imported_used_pending" && (
        <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">
          Imported address saved as the News Page URL, and the imported source is now this company&apos;s. Bigin hasn&apos;t accepted it yet, so it shows as push pending and is retried automatically.
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
            {run ? <>Last synced {isoMinute(run.at)}: {describeCompanyRun(run)}</> : "Not synced yet. Sync companies to bring in every company from Bigin."}
          </p>
          {fieldNote && <p className="mt-1 text-xs text-graphite">{fieldNote}</p>}
          <p className="mt-1 text-xs text-graphite">Change a company&apos;s details in Bigin, then sync. Only its News Page URL and member are changed here: open a company by its name.</p>
          {only && (
            <p className="mt-2 text-xs text-graphite">
              Showing one company, from Story Sources. <Link href={href({ cid: undefined, cpage: undefined })} className="underline hover:text-ink">Show all companies</Link>
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <nav aria-label="Filter companies" className="flex flex-wrap gap-1">
              {COMPANY_FILTERS.map((f) => (
                <Link
                  key={f}
                  href={href({ cfilter: f === "all" ? undefined : f, cpage: undefined, cid: undefined })}
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

          {/* One panel above the table, as Contacts has: a member <select> in
              every row would put every member's name into every row's text. */}
          {open && <CompanyPanel company={open} members={members} canEditNewsPage={canEditCompanies} state={state} closeHref={href({ company: undefined })} />}

          <div className="mt-3 max-h-80 overflow-y-auto">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-graphite">
                    <th scope="col" className="py-1">Company</th><th scope="col">Website</th><th scope="col">{NEWS_PAGE_LABEL}</th>
                    <th scope="col">In use</th><th scope="col">Contacts</th><th scope="col">Member</th><th scope="col">Story source</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((c) => (
                    <tr key={c.id} className="border-t align-top">
                      <td className="py-1.5">
                        <Link href={href({ company: c.id })} aria-current={open?.id === c.id ? "true" : undefined} className="hover:underline">
                          {c.name || <span className="text-graphite">(no name)</span>}
                        </Link>
                        {c.deletedInBiginAt && <span className="block text-xs text-danger">Deleted in Bigin {isoMinute(c.deletedInBiginAt)}</span>}
                      </td>
                      <td className="max-w-48 break-all text-xs text-graphite">{c.website ?? "—"}</td>
                      <td className="max-w-48 break-all text-xs text-graphite">
                        {c.newsPageUrl ?? "—"}
                        {c.pushPending && <span className="block whitespace-nowrap text-danger">push pending</span>}
                      </td>
                      <td className={`text-xs ${c.inUse === "none" ? "text-danger" : c.inUse === "website" ? "text-graphite" : "text-success"}`}>{c.covered.length ? <span className="text-success">Covered by imported list</span> : IN_USE_LABEL[c.inUse]}</td>
                      <td className="text-xs text-graphite">{c.contacts}</td>
                      <td className="text-xs text-graphite">
                        {c.member?.name ?? "—"}
                        {c.member && <span className="block">{c.memberChosen ? "chosen by hand" : "matched automatically"}</span>}
                      </td>
                      <td className="text-xs">
                        {c.sourceId
                          ? <Link href={`/console/sources?view=sources&cid=${encodeURIComponent(c.biginId)}`} className="text-graphite underline hover:text-ink">On Story Sources</Link>
                          : <span className="text-graphite">—</span>}
                      </td>
                    </tr>
                  ))}
                  {list.rows.length === 0 && (
                    <tr><td colSpan={7} className="py-2 text-sm text-graphite">{run || q || filter !== "all" || only ? "No companies match." : "No companies stored yet."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination page={list.page} pages={list.pages} hrefFor={(p) => href({ cpage: p })} />
        </>
      )}
      <BiginSourcesPanel live={live && !!list} run={sourcesRun} />
    </section>
  );
}

/**
 * The one company panel (`?company=`). Read-only Bigin fields (#54) under
 * Bigin's own labels, and the member override (#53): saving a member wins
 * over the automatic match on every sync; "Use automatic match" clears the
 * choice. Both re-tag the company's story source straight away. The News
 * Page URL (#55) is its own block too: saved here and in Bigin, and the
 * company's story source moves to it straight away.
 */
function CompanyPanel({ company, members, canEditNewsPage, state, closeHref }: {
  company: OpenCompany;
  members: { id: string; name: string }[];
  canEditNewsPage: boolean;
  state: CompanyListState;
  closeHref: string;
}) {
  return (
    <section aria-labelledby="company-panel-heading" className="mt-4 rounded border border-graphite/30 bg-graphite/5 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="company-panel-heading" className="font-bold text-ink">{company.name || "(no name)"}</h3>
        <Link href={closeHref} className="text-xs text-graphite hover:text-ink">Close</Link>
      </div>
      <p className="text-xs text-graphite">Bigin id {company.biginId} · as of the sync at {isoMinute(company.lastSyncedAt)}</p>
      <CompanyNewsPageEditor company={company} canWrite={canEditNewsPage} state={state} />
      {company.covered.length > 0 && <CoveredByImported company={company} canEdit={canEditNewsPage} state={state} />}
      <CompanyMemberEditor company={company} members={members} state={state} />
      <CompanyFields company={company} />
    </section>
  );
}

/** A company form's hidden inputs: the company, and the list's state to come back to. */
function CompanyFormInputs({ company, state }: { company: OpenCompany; state: CompanyListState }) {
  return (
    <>
      <input type="hidden" name="company" value={company.id} />
      {companyListParams(state).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
    </>
  );
}

/**
 * The News Page URL (#55): the one company field edited here. An empty field
 * means the Website stands in. Disabled with "edit in Bigin for now" while
 * the Bigin token can't write companies, and for a company deleted in Bigin
 * (#52), which has no record there to write to.
 */
function CompanyNewsPageEditor({ company, canWrite, state }: { company: OpenCompany; canWrite: boolean; state: CompanyListState }) {
  const deleted = !!company.deletedInBiginAt;
  const canEdit = canWrite && !deleted;
  return (
    <form action={saveCompanyNewsPage} className="mt-3">
      <CompanyFormInputs company={company} state={state} />
      <h4 className="text-xs font-bold uppercase tracking-wide text-graphite">
        <label htmlFor="crm-company-news-page">{NEWS_PAGE_LABEL}</label>
      </h4>
      <p className="mt-1 text-xs text-graphite">Website: {company.website ?? "none"} (change it in Bigin)</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          id="crm-company-news-page"
          name="news_page_url"
          inputMode="url"
          defaultValue={company.newsPageUrl ?? ""}
          placeholder={company.website ? `empty: ${company.website} is watched instead` : "https://example.com/news"}
          disabled={!canEdit}
          aria-describedby="crm-company-news-page-help"
          className="min-w-0 flex-1 rounded border bg-white px-3 py-1.5 disabled:bg-paper disabled:text-graphite"
        />
        <SubmitButton disabled={!canEdit} className="rounded bg-ink px-4 py-1.5 text-white disabled:opacity-50" pendingLabel="Saving…">
          Save News Page URL
        </SubmitButton>
      </div>
      <p id="crm-company-news-page-help" className="mt-1 text-xs text-graphite">
        {deleted
          ? "This company was deleted in Bigin, so its News Page URL can't be changed. Restore it in Bigin and sync to edit it again."
          : canEdit
            ? "Saved here and in Bigin. Leave it empty to watch the company's Website instead."
            : "Bigin doesn't let the app change companies yet, so edit in Bigin for now."}
      </p>
      {company.pushPending && (
        <p className="mt-1 text-xs text-graphite">
          <span className="text-danger">Push pending.</span>{" "}
          Saved here, but Bigin hasn&apos;t accepted it yet. It&apos;s retried automatically, and a sync from Bigin won&apos;t undo it meanwhile.
        </p>
      )}
    </form>
  );
}

/**
 * "Covered by imported list" (#56): the imported sources on the company's
 * Website domain that no company is linked to — every one, for the admin to
 * pick. Nothing is linked until one is chosen here.
 */
function CoveredByImported({ company, canEdit, state }: { company: OpenCompany; canEdit: boolean; state: CompanyListState }) {
  return (
    <div className="mt-3">
      <h4 className="text-xs font-bold uppercase tracking-wide text-graphite">Covered by imported list</h4>
      <p className="mt-1 text-xs text-graphite">
        {company.covered.length === 1 ? "An imported source is" : `${company.covered.length} imported sources are`} on this company&apos;s
        domain, so it&apos;s probably watched already. Use one as its News Page URL to link it to the company: it&apos;s saved here and in Bigin.
      </p>
      <ul className="mt-2 space-y-1">
        {company.covered.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 break-all">
              {s.label && <span className="text-ink">{s.label} · </span>}
              <span className="text-graphite">{s.url}</span>
            </span>
            <form action={adoptImportedNewsPage}>
              <CompanyFormInputs company={company} state={state} />
              <input type="hidden" name="source" value={s.id} />
              <SubmitButton disabled={!canEdit} className="rounded border px-3 py-1 text-xs disabled:opacity-50" pendingLabel="Saving…">
                Use as News Page URL
              </SubmitButton>
            </form>
          </li>
        ))}
      </ul>
      {!canEdit && <p className="mt-1 text-xs text-graphite">Bigin doesn&apos;t let the app change companies yet, so edit in Bigin for now.</p>}
    </div>
  );
}

function CompanyMemberEditor({ company, members, state }: { company: OpenCompany; members: { id: string; name: string }[]; state: CompanyListState }) {
  const chosen = company.memberChosen ? company.member : null;
  return (
    <div className="mt-3">
      <h4 className="text-xs font-bold uppercase tracking-wide text-graphite">Member</h4>
      <p className="mt-1 text-xs text-graphite">
        {company.member
          ? <><strong className="text-ink">{company.member.name}</strong>, {company.memberChosen ? "chosen by hand" : "matched automatically"}.</>
          : "No member: none matched automatically (no linked contact or website match, or more than one)."}
        {" "}Drafts from this company&apos;s story source are tagged with this member. Kept in the app only; Bigin has no member field.
      </p>
      <form action={setCompanyMember} className="mt-2 flex flex-wrap items-center gap-2">
        <CompanyFormInputs company={company} state={state} />
        <label htmlFor="crm-company-member" className="sr-only">Member</label>
        <select id="crm-company-member" name="member_id" defaultValue={chosen?.id ?? ""} className="max-w-full rounded border px-3 py-1.5">
          <option value="">— automatic match —</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <SubmitButton className="rounded bg-ink px-4 py-1.5 text-white" pendingLabel="Saving…">Save member</SubmitButton>
      </form>
      {chosen && (
        <form action={setCompanyMember} className="mt-2">
          <CompanyFormInputs company={company} state={state} />
          <input type="hidden" name="member_id" value="" />
          <SubmitButton className="rounded border px-3 py-1.5 text-xs" pendingLabel="Clearing…">Use automatic match</SubmitButton>
        </form>
      )}
    </div>
  );
}

/** Every field Bigin holds for the company (#54), under Bigin's labels. Read-only: change them in Bigin, then sync. */
function CompanyFields({ company }: { company: OpenCompany }) {
  return (
    <div className="mt-4">
      <h4 className="text-xs font-bold uppercase tracking-wide text-graphite">In Bigin</h4>
      {company.rows.length ? (
        <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(10rem,auto)_1fr]">
          {company.rows.map((r) => (
            <div key={r.apiName} className="contents">
              <dt className="text-xs text-graphite">{r.label}</dt>
              <dd className="break-words">{r.value ?? <span className="text-graphite">—</span>}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-1 text-xs text-graphite">No fields stored yet. Sync companies to bring them in.</p>
      )}
    </div>
  );
}

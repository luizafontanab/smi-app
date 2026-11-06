import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { SubmitButton } from "@/components/SubmitButton";
import type { CompanySyncRun } from "@/lib/crm-companies/sync";
import { COMPANY_FILTERS, COMPANY_FILTER_LABEL, type AddressInUse, type CompanyFilter, type CompanyListRow, type CompanyMemberDetail } from "@/lib/crm-companies/list";
import { setCompanyMember, syncCompaniesNow } from "./actions";

/**
 * CRM's Companies box (issue #50): a read-only mirror of every CRM company in
 * Bigin, members and non-members, address or not. Its own "Sync companies"
 * button and last-synced line, separate from the contacts sync above.
 *
 * The detail editor above the table (`?company=`) sets the member override
 * (#53): the member chosen by hand wins over the automatic match.
 *
 * Later tickets add to it: the Bigin sources panel moved from Story sources
 * (#51), every Bigin field (#54) and the News Page URL (#55) in the same
 * editor, and "covered by imported list" (#56).
 *
 * A company deleted in Bigin (#52) stays, marked, under its own filter; the
 * other filters hide it.
 */

const IN_USE_LABEL: Record<AddressInUse, string> = { news_page: "News Page URL", website: "Website stand-in", none: "none" };

const fmt = (iso: string) => iso.slice(0, 16).replace("T", " ");
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
  live, list, q, filter, run, flash, error, href, keep, editing, members,
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
  /** the company open in the editor (`?company=`), if any */
  editing: CompanyMemberDetail | null;
  /** members the override can choose from (not archived) */
  members: { id: string; name: string }[];
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
      {flash === "member_set" && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Member saved. The company&apos;s story source is tagged with them from now on.</p>}
      {flash === "member_cleared" && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Member choice cleared. The company is back on the automatic match.</p>}
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
          <p className="mt-1 text-xs text-graphite">Change a company&apos;s details in Bigin, then sync. Only its member is chosen here (Edit).</p>

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

          {/* One editor above the table, as Contacts has: a member <select> in
              every row would put every member's name into every row's text. */}
          {editing && <CompanyEditor company={editing} members={members} cancelHref={href({ company: undefined })} />}

          <div className="mt-3 max-h-80 overflow-y-auto">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-graphite">
                    <th scope="col" className="py-1">Company</th><th scope="col">Website</th><th scope="col">News Page URL</th>
                    <th scope="col">In use</th><th scope="col">Contacts</th><th scope="col">Member</th><th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((c) => (
                    <tr key={c.id} className="border-t align-top">
                      <td className="py-1.5">
                        {c.name || <span className="text-graphite">(no name)</span>}
                        {c.deletedInBiginAt && <span className="block text-xs text-danger">Deleted in Bigin {fmt(c.deletedInBiginAt)}</span>}
                      </td>
                      <td className="max-w-48 break-all text-xs text-graphite">{c.website ?? "—"}</td>
                      <td className="max-w-48 break-all text-xs text-graphite">{c.newsPageUrl ?? "—"}</td>
                      <td className={`text-xs ${c.inUse === "none" ? "text-danger" : c.inUse === "website" ? "text-graphite" : "text-success"}`}>{IN_USE_LABEL[c.inUse]}</td>
                      <td className="text-xs text-graphite">{c.contacts}</td>
                      <td className="text-xs text-graphite">
                        {c.member?.name ?? "—"}
                        {c.member && <span className="block">{c.memberChosen ? "chosen by hand" : "matched automatically"}</span>}
                      </td>
                      <td className="text-right">
                        <Link href={href({ company: c.id })} className="text-xs text-graphite hover:text-ink" aria-label={`Edit ${c.name || "company"}`}>Edit</Link>
                      </td>
                    </tr>
                  ))}
                  {list.rows.length === 0 && (
                    <tr><td colSpan={7} className="py-2 text-sm text-graphite">{run || q || filter !== "all" ? "No companies match." : "No companies stored yet."}</td></tr>
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
 * The company editor (#53: the member override). Saving a member wins over
 * the automatic match on every sync; "Use automatic match" clears the choice.
 * Both re-tag the company's story source straight away.
 */
function CompanyEditor({ company, members, cancelHref }: { company: CompanyMemberDetail; members: { id: string; name: string }[]; cancelHref: string }) {
  const chosen = company.memberChosen ? company.member : null;
  return (
    <div className="mt-4 rounded border border-graphite/30 bg-graphite/5 p-3 text-sm">
      <p className="text-xs uppercase tracking-wide text-graphite">Editing {company.name || "(no name)"}</p>
      <p className="mt-1 text-xs text-graphite">
        {company.member
          ? <>Member: <strong className="text-ink">{company.member.name}</strong>, {company.memberChosen ? "chosen by hand" : "matched automatically"}.</>
          : "No member: none matched automatically (no linked contact or website match, or more than one)."}
        {" "}Drafts from this company&apos;s story source are tagged with this member. Kept in the app only; Bigin has no member field.
      </p>
      <form action={setCompanyMember} className="mt-2 flex flex-wrap items-center gap-2">
        <input type="hidden" name="company" value={company.id} />
        <label htmlFor="crm-company-member" className="sr-only">Member</label>
        <select id="crm-company-member" name="member_id" defaultValue={chosen?.id ?? ""} className="max-w-full rounded border px-3 py-1.5">
          <option value="">— automatic match —</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <SubmitButton className="rounded bg-ink px-4 py-1.5 text-white" pendingLabel="Saving…">Save member</SubmitButton>
        <Link href={cancelHref} className="text-xs text-graphite hover:text-ink">Cancel</Link>
      </form>
      {chosen && (
        <form action={setCompanyMember} className="mt-2">
          <input type="hidden" name="company" value={company.id} />
          <input type="hidden" name="member_id" value="" />
          <SubmitButton className="rounded border px-3 py-1.5 text-xs" pendingLabel="Clearing…">Use automatic match</SubmitButton>
        </form>
      )}
    </div>
  );
}

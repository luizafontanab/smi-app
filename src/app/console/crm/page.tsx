import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { newsletterChoiceOf } from "@/lib/contacts";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { pagedList } from "../paged-list";
import { UUID_RE } from "@/lib/validate";
import { memberActivityTimeline } from "@/lib/activity";
import { ilikeTerm } from "@/lib/queries";
import { Pagination } from "@/components/Pagination";
import { BiginCompanyPicker } from "@/components/console/BiginCompanyPicker";
import { firstImportDone, getCrmSync, readLastRun, type LastRun } from "@/lib/adapters/crm";
import { addContact, previewBiginPull, runBiginSync, saveContact, searchBiginCompanies } from "../actions";
import { firstImportPreviewFresh } from "./first-import";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

export default async function CrmAdminPage(props: PageProps<"/console/crm">) {
  await requireConsole();
  const sp = await props.searchParams;
  const db = serviceDb();

  const q = typeof sp.q === "string" ? sp.q : "";
  const term = ilikeTerm(q);
  const requestedPage = Math.max(1, Number(sp.page) || 1);
  const contactId = typeof sp.contact === "string" ? sp.contact : null;

  // Rebuilt per attempt: pagedList re-runs it as the last page when ?page= is
  // past the end, rather than letting PostgREST's 416 throw.
  const contactsQuery = (from: number, to: number) => {
    let query = db
      .from("contacts")
      .select("id, email, name, company, member_id, subscribed, unsubscribed_at, member:members(name), last_synced_at, bigin_id, bigin_company_name, crm_dirty_at", { count: "exact" })
      .order("created_at", { ascending: false });
    if (term) query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%,company.ilike.%${term}%`);
    return query.range(from, to);
  };

  const crm = getCrmSync();
  const [members, { data: contacts, count, page }, editing, imported, lastRun] = await Promise.all([
    must(db.from("members").select("id, name").order("name"), "console/crm members"),
    pagedList(contactsQuery, requestedPage, PAGE_SIZE, "console/crm contacts"),
    // ?contact= is raw user input against a uuid column — a junk value would
    // reach Postgres as 22P02 and, now that must() throws, take the whole page
    // down. Treat an unparseable id as "no contact selected", as before.
    contactId && UUID_RE.test(contactId)
      ? must(db.from("contacts").select("id, email, name, company, member_id, subscribed, unsubscribed_at, bigin_company_id, bigin_company_name").eq("id", contactId).maybeSingle(), "console/crm contact")
      : Promise.resolve(null),
    crm.live ? firstImportDone() : Promise.resolve(false),
    readLastRun(),
  ]);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const activity = editing?.member_id ? await memberActivityTimeline(editing.member_id, 10) : [];

  const qs = (over: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { q, page: undefined, ...over };
    Object.entries(merged).forEach(([k, v]) => v !== undefined && v !== "" && params.set(k, String(v)));
    const s = params.toString();
    return s ? `/console/crm?${s}` : "/console/crm";
  };

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-ink">CRM</h1>

      {typeof sp.saved === "string" && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      {sp.synced === "1" && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Synced with Bigin.</p>}

      <BiginPanel live={crm.live} imported={imported} lastRun={lastRun} />

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-ink">Contacts (Bigin mirror — {count ?? 0} total)</h2>
          <form className="flex gap-2 text-sm" role="search">
            <label htmlFor="crm-search" className="sr-only">Search contacts</label>
            <input id="crm-search" type="search" name="q" defaultValue={q} placeholder="Search name, email, company…" className="rounded border px-3 py-1.5" />
            <button className="rounded border px-3 py-1.5">Search</button>
          </form>
        </div>
        <form action={addContact} className="mt-3 flex flex-wrap gap-2 text-sm">
          <label htmlFor="crm-add-email" className="sr-only">Email</label>
          <input id="crm-add-email" name="email" type="email" required placeholder="email" className="rounded border px-3 py-1.5" />
          <label htmlFor="crm-add-name" className="sr-only">Name</label>
          <input id="crm-add-name" name="name" placeholder="name" className="rounded border px-3 py-1.5" />
          <label htmlFor="crm-add-company" className="sr-only">Company</label>
          <input id="crm-add-company" name="company" placeholder="company" className="rounded border px-3 py-1.5" />
          <button className="rounded bg-ink px-4 py-1.5 text-white">Add (writes through to Bigin)</button>
        </form>

        {/* One editor above the table rather than one per row: a member <select>
            inside every row would put every member's name into every row's text. */}
        {editing && (
          <form action={saveContact} className="mt-4 grid gap-2 rounded border border-graphite/30 bg-graphite/5 p-3 text-sm sm:grid-cols-2">
            <input type="hidden" name="id" value={editing.id} />
            <p className="sm:col-span-2 text-xs uppercase tracking-wide text-graphite">Editing {editing.email}</p>
            <label htmlFor="crm-edit-name" className="sr-only">Name</label>
            <input id="crm-edit-name" name="name" defaultValue={editing.name ?? ""} placeholder="name" className="rounded border px-3 py-1.5" />
            <label htmlFor="crm-edit-email" className="sr-only">Email</label>
            <input id="crm-edit-email" name="email" type="email" required defaultValue={editing.email} placeholder="email" className="rounded border px-3 py-1.5" />
            <label htmlFor="crm-edit-company" className="sr-only">Company</label>
            <input id="crm-edit-company" name="company" defaultValue={editing.company ?? ""} placeholder="company" className="rounded border px-3 py-1.5" />
            <select name="member_id" defaultValue={editing.member_id ?? ""} className="max-w-full rounded border px-3 py-1.5">
              <option value="">— not a member —</option>
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select name="newsletter" defaultValue={newsletterChoiceOf(editing)} className="max-w-full rounded border px-3 py-1.5">
              <option value="subscribed">subscribed</option>
              <option value="not_subscribed">not subscribed</option>
              <option value="unsubscribed">unsubscribed</option>
            </select>
            {editing.unsubscribed_at && (
              <label className="flex items-center gap-2 text-xs text-graphite sm:col-span-2">
                <input type="checkbox" name="re_opt_in" />
                They have asked to go back on the list — unsubscribes are permanent without this.
              </label>
            )}
            <BiginCompanyPicker
              initial={editing.bigin_company_id ? { id: editing.bigin_company_id, name: editing.bigin_company_name ?? "" } : null}
              search={searchBiginCompanies}
              disabled={!crm.live}
            />
            <div className="flex items-center gap-3 sm:col-span-2">
              <button className="rounded bg-ink px-4 py-1.5 text-white">Save contact</button>
              <Link href={qs({ page })} className="text-xs text-graphite hover:text-ink">Cancel</Link>
            </div>
          </form>
        )}
        {editing?.member_id && (
          <div className="mt-3 rounded border border-graphite/20 bg-white p-3 text-sm">
            <h3 className="text-xs font-bold uppercase tracking-wide text-graphite">Site activity</h3>
            <ul className="mt-2 space-y-1.5">
              {activity.map((a, i) => (
                <li key={i} className="flex gap-3 border-t pt-1.5 text-sm">
                  <span className="w-24 shrink-0 text-xs text-graphite">{a.when?.slice(0, 10)}</span>
                  <span>{a.what}</span>
                </li>
              ))}
              {activity.length === 0 && <p className="text-sm text-graphite">No activity yet.</p>}
            </ul>
          </div>
        )}
        <div className="mt-3 max-h-80 overflow-y-auto">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead><tr className="text-left text-xs uppercase text-graphite"><th scope="col" className="py-1">Contact</th><th scope="col">Company</th><th scope="col">Newsletter</th><th scope="col">Bigin</th><th scope="col">Synced</th><th scope="col" /></tr></thead>
            <tbody>
              {(contacts ?? []).map((c) => (
                <tr key={c.id} className="border-t align-top">
                  <td className="py-1.5">{c.name ?? "—"} <span className="text-xs text-graphite">{c.email}</span></td>
                  <td className="text-graphite">{c.member?.name ?? c.company ?? "—"}</td>
                  <td>
                    {c.unsubscribed_at
                      ? <span className="text-xs text-danger">unsubscribed {c.unsubscribed_at.slice(0, 10)} (permanent)</span>
                      : c.subscribed ? <span className="text-xs text-success">subscribed</span> : <span className="text-xs text-graphite">no</span>}
                  </td>
                  <td className="text-xs">
                    {c.crm_dirty_at
                      ? <span className="text-danger">push pending</span>
                      : c.bigin_id ? <span className="text-success">in Bigin</span> : <span className="text-graphite">not in Bigin</span>}
                    {c.bigin_company_name && <span className="block text-graphite">{c.bigin_company_name}</span>}
                  </td>
                  <td className="text-xs text-graphite">{c.last_synced_at?.slice(0, 16).replace("T", " ") ?? "never"}</td>
                  <td className="text-right">
                    <Link href={qs({ page, contact: c.id })} className="text-xs text-graphite hover:text-ink">Edit</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
        <Pagination page={page} pages={pages} hrefFor={(p) => qs({ page: p })} />
      </section>
    </div>
  );
}

const fmt = (iso: string) => iso.slice(0, 16).replace("T", " ");

/** One line of counts, leaving out the zeros. */
function describeRun(run: LastRun): string {
  const p = run.pulled;
  // "would add 3" for a preview, "added 3" once it has happened
  const verb = (present: string, past: string) => (run.preview ? `would ${present}` : past);
  const parts = p
    ? [
      p.inserted && `${verb("add", "added")} ${p.inserted}`,
      p.updated && `${verb("update", "updated")} ${p.updated}`,
      p.linked && `${verb("link", "linked")} ${p.linked} existing`,
      p.optedOut && `${p.optedOut} opted out in Bigin`,
      p.unchanged && `${p.unchanged} unchanged`,
      p.skippedNoEmail && `${p.skippedNoEmail} skipped (no email)`,
      p.duplicates && `${p.duplicates} duplicate${p.duplicates === 1 ? "" : "s"} skipped`,
    ].filter(Boolean)
    : ["pull skipped — first import not run yet"];
  if (!run.preview && (run.pushed || run.pushFailed)) parts.push(`${run.pushed} pending push${run.pushed === 1 ? "" : "es"} sent${run.pushFailed ? `, ${run.pushFailed} failed` : ""}`);
  if (!run.preview && run.watch !== "ok" && run.watch !== "skipped") parts.push(`live updates: ${run.watch}`);
  return parts.length ? parts.join(" · ") : "nothing to change";
}

/**
 * Bigin connection state. The first import is deliberately a person's job:
 * it brings in every Bigin contact not opted out there as a newsletter
 * subscriber, so it is previewed, then run, from here — never by the nightly job.
 */
function BiginPanel({ live, imported, lastRun }: { live: boolean; imported: boolean; lastRun: LastRun | null }) {
  if (!live) {
    return (
      <section className="mt-4 rounded-xl bg-white p-5 text-sm shadow-sm">
        <h2 className="font-bold text-ink">Bigin</h2>
        <p className="mt-1 text-graphite">Not connected. Contacts are kept here only until the Bigin keys are set (HUMAN-TODO §7).</p>
      </section>
    );
  }
  return (
    <section className="mt-4 rounded-xl bg-white p-5 text-sm shadow-sm">
      <h2 className="font-bold text-ink">Bigin</h2>
      {imported ? (
        <p className="mt-1 text-graphite">
          Connected. Changes here go to Bigin straight away; changes in Bigin come back on each sync.
        </p>
      ) : (
        <p className="mt-1 text-graphite">
          Connected, but Bigin&apos;s contacts haven&apos;t been imported yet. Importing adds every Bigin contact
          with an email, <strong className="text-ink">subscribed to the newsletter unless they opted out in Bigin</strong> —
          so the next issue goes to them. Preview first to see the numbers.
        </p>
      )}
      {lastRun && (
        <p className="mt-2 text-xs text-graphite">
          {lastRun.preview ? "Preview" : "Last sync"} {fmt(lastRun.at)}: {describeRun(lastRun)}
        </p>
      )}
      {!imported && lastRun?.preview && !firstImportPreviewFresh(lastRun) && (
        <p className="mt-1 text-xs text-graphite">That preview is over an hour old — preview again to run the first import.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <form action={previewBiginPull}>
          <button className="rounded border px-4 py-1.5">{imported ? "Preview changes" : "Preview import"}</button>
        </form>
        {/* runBiginSync enforces the same rule — this just doesn't offer what it would refuse. */}
        {(imported || firstImportPreviewFresh(lastRun)) && (
          <form action={runBiginSync}>
            <button className="rounded bg-ink px-4 py-1.5 text-white">{imported ? "Sync with Bigin now" : "Run first import"}</button>
          </form>
        )}
      </div>
    </section>
  );
}

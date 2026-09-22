import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { newsletterChoiceOf } from "@/lib/contacts";
import { serviceDb } from "@/lib/db/server";
import { must, mustList } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { memberActivityTimeline } from "@/lib/activity";
import { ilikeTerm } from "@/lib/queries";
import { Pagination } from "@/components/Pagination";
import { addContact, saveContact } from "../actions";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

export default async function CrmAdminPage(props: PageProps<"/console/crm">) {
  await requireConsole();
  const sp = await props.searchParams;
  const db = serviceDb();

  const q = typeof sp.q === "string" ? sp.q : "";
  const term = ilikeTerm(q);
  const page = Math.max(1, Number(sp.page) || 1);
  const contactId = typeof sp.contact === "string" ? sp.contact : null;

  let contactsQuery = db
    .from("contacts")
    .select("id, email, name, company, member_id, subscribed, unsubscribed_at, member:members(name), last_synced_at", { count: "exact" })
    .order("created_at", { ascending: false });
  if (term) contactsQuery = contactsQuery.or(`name.ilike.%${term}%,email.ilike.%${term}%,company.ilike.%${term}%`);
  contactsQuery = contactsQuery.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const [members, { data: contacts, count }, editing] = await Promise.all([
    must(db.from("members").select("id, name").order("name"), "console/crm members"),
    mustList(contactsQuery, "console/crm contacts"),
    // ?contact= is raw user input against a uuid column — a junk value would
    // reach Postgres as 22P02 and, now that must() throws, take the whole page
    // down. Treat an unparseable id as "no contact selected", as before.
    contactId && UUID_RE.test(contactId)
      ? must(db.from("contacts").select("id, email, name, company, member_id, subscribed, unsubscribed_at").eq("id", contactId).maybeSingle(), "console/crm contact")
      : Promise.resolve(null),
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
            <div className="flex items-center gap-3 sm:col-span-2">
              <button className="rounded bg-ink px-4 py-1.5 text-white">Save contact</button>
              <Link href="/console/crm" className="text-xs text-graphite hover:text-ink">Cancel</Link>
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
          <table className="w-full text-sm min-w-[560px]">
            <thead><tr className="text-left text-xs uppercase text-graphite"><th scope="col" className="py-1">Contact</th><th scope="col">Company</th><th scope="col">Newsletter</th><th scope="col">Synced</th><th scope="col" /></tr></thead>
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
                  <td className="text-xs text-graphite">{c.last_synced_at?.slice(0, 16).replace("T", " ") ?? "never"}</td>
                  <td className="text-right">
                    <Link href={`?contact=${c.id}`} className="text-xs text-graphite hover:text-graphite">Edit</Link>
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

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { newsletterChoiceOf } from "@/lib/contacts";
import { serviceDb } from "@/lib/db/server";
import { addContact, saveContact, setMemberStatus } from "../actions";

export const dynamic = "force-dynamic";

export default async function MembersAdminPage(props: PageProps<"/console/members">) {
  await requireConsole();
  const sp = await props.searchParams;
  // the activity timeline moved to the member's own page — keep old links working
  if (typeof sp.member === "string") redirect(`/console/members/${sp.member}`);
  const q = typeof sp.q === "string" ? sp.q.toLowerCase() : "";
  const db = serviceDb();

  const [{ data: members }, { data: contacts }] = await Promise.all([
    db.from("members").select("id, name, status, joined_at, billing_mode, paid_at, comped_until, draft_submitted_at, category:categories(name)").order("name"),
    db.from("contacts").select("id, email, name, company, member_id, subscribed, unsubscribed_at, member:members(name), last_synced_at").order("created_at", { ascending: false }).limit(200),
  ]);

  const filtered = q
    ? (members ?? []).filter((m) => m.name.toLowerCase().includes(q))
    : (members ?? []);

  const editing = typeof sp.contact === "string"
    ? (contacts ?? []).find((c) => c.id === sp.contact)
    : null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-ink">Members &amp; CRM</h1>
        <Link href="/console/members/new" className="rounded bg-ink px-4 py-2 text-sm text-white">+ New member</Link>
      </div>

      <form className="mt-4"><input name="q" defaultValue={q} placeholder="Search members…" className="w-72 rounded border bg-white px-3 py-2 text-sm" /></form>

      {typeof sp.saved === "string" && <p className="mt-3 rounded bg-green-50 p-2 text-sm text-green-700">Saved.</p>}
      {typeof sp.error === "string" && <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-600">{sp.error}</p>}

      <div className="mt-4">
        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Members ({filtered.length})</h2>
          <div className="mt-2 max-h-[28rem] overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="py-1.5">
                      <Link href={`/console/members/${m.id}`} className="font-medium hover:text-graphite">{m.name}</Link>
                      <p className="text-xs text-gray-400">
                        {m.category?.name} · joined {m.joined_at} · {m.billing_mode} ·{" "}
                        <a href={`/console/pages?type=member_profile&entity=${m.id}`} className="underline hover:text-graphite">page layout</a>
                      </p>
                    </td>
                    <td className="text-right">
                      <span className="flex items-center justify-end gap-2">
                        {m.status === "draft" && (
                          <>
                            <span className={`rounded px-2 py-0.5 text-xs ${m.paid_at || m.comped_until ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}>
                              {m.paid_at ? "paid ✓" : m.comped_until ? `comped → ${m.comped_until}` : "unpaid"}
                            </span>
                            <span className={`rounded px-2 py-0.5 text-xs ${m.draft_submitted_at ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}>
                              {m.draft_submitted_at ? "page ✓" : "no page"}
                            </span>
                          </>
                        )}
                        <span className={`rounded px-2 py-0.5 text-xs ${
                          m.status === "active" ? "bg-green-100 text-green-700" :
                          m.status === "grace" ? "bg-brand/20 text-brand" :
                          m.status === "lapsed" ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-500"}`}>
                          {m.status}
                        </span>
                        {m.status !== "active" && (
                          m.status === "draft" && !m.paid_at && !m.comped_until ? (
                            <span className="text-xs text-gray-400">awaiting payment</span>
                          ) : m.status === "draft" && !m.draft_submitted_at ? (
                            <span className="text-xs text-gray-400">awaiting page</span>
                          ) : (
                            <form action={setMemberStatus}>
                              <input type="hidden" name="id" value={m.id} />
                              <input type="hidden" name="status" value="active" />
                              <button className="rounded bg-green-600 px-2 py-0.5 text-xs text-white">Activate</button>
                            </form>
                          )
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section id="contacts" className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-ink">Contacts (Bigin mirror — {(contacts ?? []).length} recent)</h2>
        </div>
        <form action={addContact} className="mt-3 flex flex-wrap gap-2 text-sm">
          <input name="email" type="email" required placeholder="email" className="rounded border px-3 py-1.5" />
          <input name="name" placeholder="name" className="rounded border px-3 py-1.5" />
          <input name="company" placeholder="company" className="rounded border px-3 py-1.5" />
          <button className="rounded bg-ink px-4 py-1.5 text-white">Add (writes through to Bigin)</button>
        </form>

        {/* One editor above the table rather than one per row: a member <select>
            inside every row would put every member's name into every row's text. */}
        {editing && (
          <form action={saveContact} className="mt-4 grid gap-2 rounded border border-graphite/30 bg-graphite/5 p-3 text-sm sm:grid-cols-2">
            <input type="hidden" name="id" value={editing.id} />
            <label htmlFor="name" className="sm:col-span-2 text-xs uppercase tracking-wide text-gray-400">Editing {editing.email}</label>
            <input id="name" name="name" defaultValue={editing.name ?? ""} placeholder="name" className="rounded border px-3 py-1.5" />
            <input name="email" type="email" required defaultValue={editing.email} placeholder="email" className="rounded border px-3 py-1.5" />
            <input name="company" defaultValue={editing.company ?? ""} placeholder="company" className="rounded border px-3 py-1.5" />
            <select name="member_id" defaultValue={editing.member_id ?? ""} className="rounded border px-3 py-1.5">
              <option value="">— not a member —</option>
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select name="newsletter" defaultValue={newsletterChoiceOf(editing)} className="rounded border px-3 py-1.5">
              <option value="subscribed">subscribed</option>
              <option value="not_subscribed">not subscribed</option>
              <option value="unsubscribed">unsubscribed</option>
            </select>
            {editing.unsubscribed_at && (
              <label className="flex items-center gap-2 text-xs text-gray-500 sm:col-span-2">
                <input type="checkbox" name="re_opt_in" />
                They have asked to go back on the list — unsubscribes are permanent without this.
              </label>
            )}
            <div className="flex items-center gap-3 sm:col-span-2">
              <button className="rounded bg-ink px-4 py-1.5 text-white">Save contact</button>
              <Link href={`/console/members${q ? `?q=${q}` : ""}#contacts`} className="text-xs text-gray-400 hover:text-ink">Cancel</Link>
            </div>
          </form>
        )}
        <div className="mt-3 max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-gray-400"><th className="py-1">Contact</th><th>Company</th><th>Newsletter</th><th>Synced</th><th /></tr></thead>
            <tbody>
              {(contacts ?? []).map((c) => (
                <tr key={c.id} className="border-t align-top">
                  <td className="py-1.5">{c.name ?? "—"} <span className="text-xs text-gray-400">{c.email}</span></td>
                  <td className="text-gray-500">{c.member?.name ?? c.company ?? "—"}</td>
                  <td>
                    {c.unsubscribed_at
                      ? <span className="text-xs text-red-500">unsubscribed {c.unsubscribed_at.slice(0, 10)} (permanent)</span>
                      : c.subscribed ? <span className="text-xs text-green-600">subscribed</span> : <span className="text-xs text-gray-400">no</span>}
                  </td>
                  <td className="text-xs text-gray-400">{c.last_synced_at?.slice(0, 16).replace("T", " ") ?? "never"}</td>
                  <td className="text-right">
                    <Link href={`?contact=${c.id}${q ? `&q=${q}` : ""}#contacts`} className="text-xs text-gray-400 hover:text-graphite">Edit</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

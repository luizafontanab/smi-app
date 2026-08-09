import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { addContact, setMemberStatus } from "../actions";

export const dynamic = "force-dynamic";

export default async function MembersAdminPage(props: PageProps<"/console/members">) {
  await requireConsole();
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.toLowerCase() : "";
  const focusId = typeof sp.member === "string" ? sp.member : null;
  const db = serviceDb();

  const [{ data: members }, { data: contacts }] = await Promise.all([
    db.from("members").select("id, name, status, joined_at, billing_mode, category:categories(name)").order("name"),
    db.from("contacts").select("id, email, name, company, subscribed, unsubscribed_at, member:members(name), last_synced_at").order("created_at", { ascending: false }).limit(200),
  ]);

  const filtered = q
    ? (members ?? []).filter((m) => m.name.toLowerCase().includes(q))
    : (members ?? []);

  // per-client activity timeline for the focused member
  const focus = focusId ? (members ?? []).find((m) => m.id === focusId) : null;
  let timeline: { when: string; what: string }[] = [];
  if (focus) {
    const [stories, placements, invoices, notifications] = await Promise.all([
      db.from("stories").select("title, published_at").eq("member_id", focus.id).eq("status", "published").order("published_at", { ascending: false }).limit(10),
      db.from("placements").select("kind, starts_on").eq("member_id", focus.id).order("starts_on", { ascending: false }).limit(5),
      db.from("invoices").select("number, issued_on, status").eq("member_id", focus.id).order("issued_on", { ascending: false }).limit(5),
      db.from("notifications").select("kind, created_at").eq("member_id", focus.id).order("created_at", { ascending: false }).limit(5),
    ]);
    timeline = [
      ...(stories.data ?? []).map((s) => ({ when: s.published_at ?? "", what: `Story published: ${s.title}` })),
      ...(placements.data ?? []).map((p) => ({ when: p.starts_on, what: `Placement: ${p.kind.replace("_", " ")}` })),
      ...(invoices.data ?? []).map((i) => ({ when: i.issued_on, what: `Invoice ${i.number} (${i.status})` })),
      ...(notifications.data ?? []).map((n) => ({ when: n.created_at, what: `Notified: ${n.kind}` })),
    ].sort((a, b) => (a.when < b.when ? 1 : -1)).slice(0, 15);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-navy">Members &amp; CRM</h1>

      <form className="mt-4"><input name="q" defaultValue={q} placeholder="Search members…" className="w-72 rounded border bg-white px-3 py-2 text-sm" /></form>

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-navy">Members ({filtered.length})</h2>
          <div className="mt-2 max-h-[28rem] overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="py-1.5">
                      <a href={`?member=${m.id}${q ? `&q=${q}` : ""}`} className="font-medium hover:text-steel">{m.name}</a>
                      <p className="text-xs text-gray-400">{m.category?.name} · joined {m.joined_at} · {m.billing_mode}</p>
                    </td>
                    <td className="text-right">
                      <span className="flex items-center justify-end gap-2">
                        <span className={`rounded px-2 py-0.5 text-xs ${
                          m.status === "active" ? "bg-green-100 text-green-700" :
                          m.status === "grace" ? "bg-amber/20 text-amber" :
                          m.status === "lapsed" ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-500"}`}>
                          {m.status}
                        </span>
                        {m.status !== "active" && (
                          <form action={setMemberStatus}>
                            <input type="hidden" name="id" value={m.id} />
                            <input type="hidden" name="status" value="active" />
                            <button className="rounded bg-green-600 px-2 py-0.5 text-xs text-white">Activate</button>
                          </form>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl bg-white p-5 shadow-sm">
          {focus ? (
            <>
              <h2 className="font-bold text-navy">Activity — {focus.name}</h2>
              <ul className="mt-2 space-y-1.5 text-sm">
                {timeline.map((t, i) => (
                  <li key={i} className="flex gap-3 border-t pt-1.5">
                    <span className="w-24 shrink-0 text-xs text-gray-400">{t.when?.slice(0, 10)}</span>
                    <span>{t.what}</span>
                  </li>
                ))}
                {timeline.length === 0 && <p className="text-sm text-gray-400">No activity yet.</p>}
              </ul>
            </>
          ) : (
            <p className="text-sm text-gray-400">Select a member to see their activity timeline — the renewal-call view.</p>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-navy">Contacts (Bigin mirror — {(contacts ?? []).length} recent)</h2>
        </div>
        <form action={addContact} className="mt-3 flex flex-wrap gap-2 text-sm">
          <input name="email" type="email" required placeholder="email" className="rounded border px-3 py-1.5" />
          <input name="name" placeholder="name" className="rounded border px-3 py-1.5" />
          <input name="company" placeholder="company" className="rounded border px-3 py-1.5" />
          <button className="rounded bg-navy px-4 py-1.5 text-white">Add (writes through to Bigin)</button>
        </form>
        <div className="mt-3 max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-gray-400"><th className="py-1">Contact</th><th>Company</th><th>Newsletter</th><th>Synced</th></tr></thead>
            <tbody>
              {(contacts ?? []).map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="py-1.5">{c.name ?? "—"} <span className="text-xs text-gray-400">{c.email}</span></td>
                  <td className="text-gray-500">{c.member?.name ?? c.company ?? "—"}</td>
                  <td>
                    {c.unsubscribed_at
                      ? <span className="text-xs text-red-500">unsubscribed {c.unsubscribed_at.slice(0, 10)} (permanent)</span>
                      : c.subscribed ? <span className="text-xs text-green-600">subscribed</span> : <span className="text-xs text-gray-400">no</span>}
                  </td>
                  <td className="text-xs text-gray-400">{c.last_synced_at?.slice(0, 16).replace("T", " ") ?? "never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

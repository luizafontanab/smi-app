import Link from "next/link";
import { redirect } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { MEMBER_STATUSES } from "@/lib/membership";
import { setMemberStatus } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_FILTERS = ["all", ...MEMBER_STATUSES] as const;

export default async function MembersAdminPage(props: PageProps<"/console/members">) {
  await requireConsole();
  const sp = await props.searchParams;
  // the activity timeline moved to the member's own page — keep old links working
  if (typeof sp.member === "string") redirect(`/console/members/${sp.member}`);
  const q = typeof sp.q === "string" ? sp.q.toLowerCase() : "";
  const status = STATUS_FILTERS.includes(sp.status as typeof STATUS_FILTERS[number]) ? (sp.status as typeof STATUS_FILTERS[number]) : "all";
  const db = serviceDb();

  const { data: members } = await db.from("members").select("id, name, status, joined_at, billing_mode, paid_at, comped_until, draft_submitted_at, category:categories(name)").order("name");

  const filtered = (members ?? [])
    .filter((m) => status === "all" || m.status === status)
    .filter((m) => !q || m.name.toLowerCase().includes(q));

  const statusHref = (s: string) => `/console/members?status=${s}${q ? `&q=${q}` : ""}`;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-ink">Members</h1>
        <Link href="/console/members/new" className="rounded bg-ink px-4 py-2 text-sm text-white">+ New member</Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <form>
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <input name="q" defaultValue={q} placeholder="Search members…" className="w-72 rounded border bg-white px-3 py-2 text-sm" />
        </form>
        <div className="flex gap-1 text-sm">
          {STATUS_FILTERS.map((s) => (
            <Link
              key={s}
              href={statusHref(s)}
              className={`rounded px-2.5 py-1.5 ${s === status ? "bg-ink font-semibold text-white" : "bg-white text-gray-500 hover:text-ink"}`}
            >
              {s === "all" ? "All" : s}
            </Link>
          ))}
        </div>
      </div>

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
    </div>
  );
}

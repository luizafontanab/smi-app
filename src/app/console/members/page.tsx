import Link from "next/link";
import { redirect } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { MEMBER_STATUSES } from "@/lib/membership";
import { ilikeTerm } from "@/lib/queries";
import { Pagination } from "@/components/Pagination";
import { setMemberStatus } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_FILTERS = ["all", ...MEMBER_STATUSES] as const;
const PAGE_SIZE = 50;

export default async function MembersAdminPage(props: PageProps<"/console/members">) {
  await requireConsole();
  const sp = await props.searchParams;
  // the activity timeline moved to the member's own page — keep old links working
  if (typeof sp.member === "string") redirect(`/console/members/${sp.member}`);
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = STATUS_FILTERS.includes(sp.status as typeof STATUS_FILTERS[number]) ? (sp.status as typeof STATUS_FILTERS[number]) : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const db = serviceDb();

  // Search and filter server-side: this used to pull every member (with a
  // category join) on each load and substring-match in JS — the search box was
  // a client-side illusion over a full table pull. Same ilikeTerm + range
  // pattern as /console/crm.
  let membersQuery = db
    .from("members")
    .select("id, name, status, joined_at, billing_mode, paid_at, comped_until, draft_submitted_at, category:categories(name)", { count: "exact" })
    .order("name");
  if (status !== "all") membersQuery = membersQuery.eq("status", status);
  const term = ilikeTerm(q);
  if (term) membersQuery = membersQuery.or(`name.ilike.%${term}%,description.ilike.%${term}%,contact_email.ilike.%${term}%`);
  const { data: filtered, count } = await membersQuery.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const statusHref = (s: string) => `/console/members?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-ink">Members</h1>
        <Link href="/console/members/new" className="rounded bg-ink px-4 py-2 text-sm text-white">+ New member</Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <form>
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <input name="q" defaultValue={q} placeholder="Search members…" aria-label="Search members" className="w-72 rounded border bg-white px-3 py-2 text-sm" />
        </form>
        <div className="flex gap-1 text-sm">
          {STATUS_FILTERS.map((s) => (
            <Link
              key={s}
              href={statusHref(s)}
              className={`rounded px-2.5 py-1.5 ${s === status ? "bg-ink font-semibold text-white" : "bg-white text-graphite hover:text-ink"}`}
            >
              {s === "all" ? "All" : s}
            </Link>
          ))}
        </div>
      </div>

      {typeof sp.saved === "string" && <p role="status" className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <div className="mt-4">
        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Members ({count ?? 0})</h2>
          <div className="mt-2 max-h-[28rem] overflow-y-auto">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-xs uppercase text-graphite">
                  <th scope="col" className="py-1">Member</th>
                  <th scope="col" className="text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {(filtered ?? []).map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="py-1.5">
                      <Link href={`/console/members/${m.id}`} className="font-medium hover:text-graphite">{m.name}</Link>
                      <p className="text-xs text-graphite">
                        {m.category?.name} · joined {m.joined_at} · {m.billing_mode} ·{" "}
                        <a href={`/console/pages?type=member_profile&entity=${m.id}`} className="underline hover:text-graphite">page layout</a>
                      </p>
                    </td>
                    <td className="text-right">
                      <span className="flex items-center justify-end gap-2">
                        {m.status === "draft" && (
                          <>
                            <span className={`rounded px-2 py-0.5 text-xs ${m.paid_at || m.comped_until ? "bg-success/10 text-success" : "bg-shade text-ink/70"}`}>
                              {m.paid_at ? "paid ✓" : m.comped_until ? `comped → ${m.comped_until}` : "unpaid"}
                            </span>
                            <span className={`rounded px-2 py-0.5 text-xs ${m.draft_submitted_at ? "bg-success/10 text-success" : "bg-shade text-ink/70"}`}>
                              {m.draft_submitted_at ? "page ✓" : "no page"}
                            </span>
                          </>
                        )}
                        <span className={`rounded px-2 py-0.5 text-xs ${
                          m.status === "active" ? "bg-success/10 text-success" :
                          m.status === "grace" ? "bg-brand/20 text-brand" :
                          m.status === "lapsed" ? "bg-danger/10 text-danger" : "bg-shade text-ink/70"}`}>
                          {m.status}
                        </span>
                        {m.status !== "active" && (
                          m.status === "draft" && !m.paid_at && !m.comped_until ? (
                            <span className="text-xs text-graphite">awaiting payment</span>
                          ) : m.status === "draft" && !m.draft_submitted_at ? (
                            <span className="text-xs text-graphite">awaiting page</span>
                          ) : (
                            <form action={setMemberStatus}>
                              <input type="hidden" name="id" value={m.id} />
                              <input type="hidden" name="status" value="active" />
                              <button className="rounded bg-success px-2 py-0.5 text-xs text-white">Activate</button>
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
          </div>
          <Pagination page={page} pages={pages} hrefFor={(p) => `${statusHref(status)}${p > 1 ? `&page=${p}` : ""}`} />
        </section>
      </div>
    </div>
  );
}

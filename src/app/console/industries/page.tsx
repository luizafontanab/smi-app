import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { allRows } from "@/lib/db/all-rows";

export const dynamic = "force-dynamic";
export const metadata = { title: "Industries" };

export default async function IndustriesPage(props: PageProps<"/console/industries">) {
  await requireConsole();
  const sp = await props.searchParams;
  const db = serviceDb();

  // A member is in any number of industries (member_industries) and has one
  // primary (members.industry_id); content carries its own. Both member counts
  // are shown — either one blocks a delete.
  const [inds, links, primaries] = await Promise.all([
    must(db.from("industries").select("id, name, slug").order("sort_order"), "console/industries list"),
    allRows((from, to) =>
      must(
        db.from("member_industries").select("industry_id").order("member_id").order("industry_id").range(from, to),
        "console/industries member counts",
      ).then((data) => ({ data })),
    ),
    must(db.from("members").select("industry_id").not("industry_id", "is", null), "console/industries primary counts"),
  ]);

  const tally = (rows: { industry_id: number | null }[]) => {
    const out = new Map<number, number>();
    for (const row of rows) if (row.industry_id != null) out.set(row.industry_id, (out.get(row.industry_id) ?? 0) + 1);
    return out;
  };
  const counts = tally(links);
  const primaryCounts = tally(primaries ?? []);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">Industries</h1>
        <Link href="/console/industries/new" className="rounded bg-ink px-4 py-2 text-sm text-white">
          New industry
        </Link>
      </div>
      <p className="mt-2 text-sm text-graphite">
        The industry strip and <code className="text-xs">/industry/…</code> pages. A member can be in several, with one
        primary; a story, video or event has one.{" "}
        <Link href="/console/categories" className="underline hover:text-ink">News categories</Link> are a separate list.
      </p>

      {sp.saved && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Industry saved.</p>}
      {sp.deleted && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Industry deleted.</p>}

      <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-sm">
        {(inds ?? []).length === 0 && <p className="p-5 text-sm text-graphite">No industries yet.</p>}
        <ul className="divide-y">
          {(inds ?? []).map((i) => {
            const count = counts.get(i.id) ?? 0;
            const primary = primaryCounts.get(i.id) ?? 0;
            return (
              <li key={i.id} className="flex flex-wrap items-baseline gap-x-3 px-5 py-3">
                <Link href={`/console/industries/${i.id}`} className="font-medium text-ink hover:text-graphite">
                  {i.name}
                </Link>
                <code className="text-xs text-graphite">{i.slug}</code>
                <span className="ml-auto text-xs text-graphite">
                  {count} member{count === 1 ? "" : "s"} · {primary} primary
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

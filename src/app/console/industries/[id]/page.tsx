import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must, mustList } from "@/lib/db/must";
import { deleteIndustry, saveIndustry } from "../../actions";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function IndustryEditor(props: PageProps<"/console/industries/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  const isNew = id === "new";
  const db = serviceDb();

  // industries.id is a serial — a non-numeric path segment would reach Postgres
  // as an invalid integer (22P02), which must() turns into a throw. Keep it a 404.
  const industryId = Number(id);
  if (!isNew && !Number.isInteger(industryId)) notFound();

  const industry = isNew
    ? null
    : await must(db.from("industries").select("id, name, slug, sort_order").eq("id", industryId).maybeSingle(), "console/industries editor");
  if (!isNew && !industry) notFound();

  // Five tables reference an industry and every FK defaults to RESTRICT, so
  // any one of them blocks a delete. Count them all rather than reporting the
  // member count and letting the others surprise you. `members` here is the
  // industry's members via member_industries; `primaries` those for whom it is
  // also members.industry_id.
  const [members, primaries, stories, videos, events] = isNew
    ? [0, 0, 0, 0, 0]
    : await Promise.all([
        mustList(
          db.from("member_industries").select("member_id", { count: "exact", head: true }).eq("industry_id", industry!.id),
          "console/industries usage: member_industries",
        ).then((r) => r.count ?? 0),
        ...(["members", "stories", "videos", "events"] as const).map(async (t) =>
          (await mustList(
            db.from(t).select("id", { count: "exact", head: true }).eq("industry_id", industry!.id),
            `console/industries usage: ${t}`,
          )).count ?? 0,
        ),
      ]);
  const usage = [
    [members, `member${members === 1 ? "" : "s"}`],
    [primaries, "as primary"],
    [stories, `stor${stories === 1 ? "y" : "ies"}`],
    [videos, `video${videos === 1 ? "" : "s"}`],
    [events, `event${events === 1 ? "" : "s"}`],
  ].filter(([n]) => (n as number) > 0) as [number, string][];

  return (
    <div className="mx-auto max-w-lg">
      <Link href="/console/industries" className="text-sm text-graphite hover:text-ink">← Industries</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{isNew ? "New industry" : `Edit “${industry!.name}”`}</h1>
      {sp.error && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <form action={saveIndustry} className="mt-4 space-y-4 rounded-xl bg-white p-5 shadow-sm">
        <UnsavedChangesGuard />
        <input type="hidden" name="id" value={isNew ? "" : industry!.id} />
        <div>
          <label htmlFor="name" className="text-sm font-medium">Name</label>
          <input id="name" name="name" defaultValue={industry?.name ?? ""} required className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label htmlFor="slug" className="text-sm font-medium">Slug</label>
          <input id="slug" name="slug" defaultValue={industry?.slug ?? ""} placeholder="from the name" className="mt-1 w-full rounded border px-3 py-2" />
          <p className="mt-1 text-xs text-graphite">
            Leave blank to derive it from the name. Changing it changes the public{" "}
            <code className="text-xs">/industry/…</code> URL.
          </p>
        </div>
        <div>
          <label htmlFor="sort_order" className="text-sm font-medium">Position</label>
          <input
            id="sort_order"
            name="sort_order"
            type="number"
            defaultValue={industry?.sort_order ?? 0}
            className="mt-1 w-24 rounded border px-3 py-2"
          />
          <p className="mt-1 text-xs text-graphite">Order in the industry strip. Lower shows first.</p>
        </div>
        <SubmitButton className="rounded bg-ink px-5 py-2.5 text-white" pendingLabel="Saving…">Save</SubmitButton>
      </form>

      {!isNew && (
        <form action={deleteIndustry} className="mt-4 rounded-xl border border-danger/30 bg-white p-5 shadow-sm">
          <input type="hidden" name="id" value={industry!.id} />
          <h2 className="font-bold text-ink">Delete this industry</h2>
          <p className="mt-1 text-xs text-graphite">
            {usage.length > 0
              ? `${usage.map(([n, label]) => `${n} ${label}`).join(", ")} still use this industry — deleting will fail until they're reassigned.`
              : "Nothing uses this industry."}
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" name="confirm" value="1" required />
            Yes, delete this industry
          </label>
          <SubmitButton className="mt-3 rounded border border-danger/30 px-4 py-2 text-sm text-danger" pendingLabel="Deleting…">Delete</SubmitButton>
        </form>
      )}
    </div>
  );
}

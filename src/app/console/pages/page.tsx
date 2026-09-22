import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { getLayout } from "@/lib/blocks/layouts";
import type { PageType } from "@/lib/blocks/schema";
import { resetLayout, saveLayout } from "../actions";
import { LayoutEditor } from "./LayoutEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Page Layouts" };

const TABS: { type: PageType; label: string }[] = [
  { type: "story", label: "Story pages" },
  { type: "member_profile", label: "Member pages" },
  { type: "featured_machine", label: "Featured Machine" },
  { type: "static_page", label: "Content pages" },
];

export default async function PageLayoutsPage(props: PageProps<"/console/pages">) {
  await requireConsole();
  const sp = await props.searchParams;
  const type = (TABS.some((t) => t.type === sp.type) ? sp.type : "story") as PageType;
  const entityParam = typeof sp.entity === "string" && sp.entity ? sp.entity : undefined;
  // ?entity= is raw user input used as a uuid in every query below. getLayout()
  // already drops a non-uuid value (lib/blocks/layouts.ts) — do the same here so
  // a junk param stays "no entity selected" instead of reaching Postgres as
  // 22P02 and, now that must() throws, taking the page down.
  const entity = entityParam && UUID_RE.test(entityParam) ? entityParam : undefined;
  const db = serviceDb();

  const [layout, overrideRow, entityLabel] = await Promise.all([
    getLayout(type, entity),
    entity
      ? must(db.from("page_layouts").select("id").eq("page_type", type).eq("entity_id", entity).maybeSingle(), "console/pages override row")
      : Promise.resolve(null),
    (async () => {
      if (!entity) return null;
      if (type === "story") {
        const row = await must(db.from("stories").select("title").eq("id", entity).maybeSingle(), "console/pages story label");
        return row?.title ?? null;
      }
      if (type === "member_profile") {
        const row = await must(db.from("members").select("name").eq("id", entity).maybeSingle(), "console/pages member label");
        return row?.name ?? null;
      }
      if (type === "static_page") {
        // keyed on the surrogate uuid, not the slug — see 20260824000002
        const row = await must(db.from("static_pages").select("title").eq("id", entity).maybeSingle(), "console/pages static page label");
        return row?.title ?? null;
      }
      return null;
    })(),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold text-ink">Page Layouts</h1>
      <p className="mt-1 text-sm text-graphite">
        Drag blocks to arrange the page. Advert blocks are rotating slots — every advertiser gets equal
        rotation, so a layout can never favour anyone.
      </p>

      <div className="mt-4 flex gap-1 border-b text-sm">
        {TABS.map((t) => (
          <Link
            key={t.type}
            href={`/console/pages?type=${t.type}`}
            className={`rounded-t px-4 py-2 ${t.type === type && !entity ? "border border-b-0 bg-white font-semibold text-ink" : "text-graphite hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {entity && (
        <p className="mt-3 rounded bg-graphite/10 p-2 text-sm">
          Editing the layout for <b>{entityLabel ?? entity}</b> only{overrideRow ? " (override active)" : " (currently using the default)"} ·{" "}
          <Link href={`/console/pages?type=${type}`} className="text-graphite underline">edit the default instead</Link>
        </p>
      )}
      {typeof sp.saved === "string" && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Layout saved.</p>}
      {typeof sp.error === "string" && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <form action={saveLayout} className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <input type="hidden" name="page_type" value={type} />
        {entity && <input type="hidden" name="entity_id" value={entity} />}
        <LayoutEditor key={`${type}:${entity ?? "default"}`} pageType={type} initial={layout} />
      </form>

      <form action={resetLayout} className="mt-3">
        <input type="hidden" name="page_type" value={type} />
        {entity && <input type="hidden" name="entity_id" value={entity} />}
        <button className="text-sm text-graphite underline hover:text-danger">
          {entity ? "Remove this page's override (use the default)" : "Reset to the built-in default"}
        </button>
      </form>
    </div>
  );
}

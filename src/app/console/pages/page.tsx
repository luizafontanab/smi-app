import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
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
  const entity = typeof sp.entity === "string" && sp.entity ? sp.entity : undefined;
  const db = serviceDb();

  const [layout, { data: overrideRow }, entityLabel] = await Promise.all([
    getLayout(type, entity),
    entity
      ? db.from("page_layouts").select("id").eq("page_type", type).eq("entity_id", entity).maybeSingle()
      : Promise.resolve({ data: null }),
    (async () => {
      if (!entity) return null;
      if (type === "story") {
        const { data } = await db.from("stories").select("title").eq("id", entity).single();
        return data?.title ?? null;
      }
      if (type === "member_profile") {
        const { data } = await db.from("members").select("name").eq("id", entity).single();
        return data?.name ?? null;
      }
      if (type === "static_page") {
        // keyed on the surrogate uuid, not the slug — see 20260824000002
        const { data } = await db.from("static_pages").select("title").eq("id", entity).maybeSingle();
        return data?.title ?? null;
      }
      return null;
    })(),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold text-ink">Page Layouts</h1>
      <p className="mt-1 text-sm text-gray-500">
        Drag blocks to arrange the page. Advert blocks are rotating slots — every advertiser gets equal
        rotation, so a layout can never favour anyone.
      </p>

      <div className="mt-4 flex gap-1 border-b text-sm">
        {TABS.map((t) => (
          <Link
            key={t.type}
            href={`/console/pages?type=${t.type}`}
            className={`rounded-t px-4 py-2 ${t.type === type && !entity ? "border border-b-0 bg-white font-semibold text-ink" : "text-gray-500 hover:text-ink"}`}
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
      {typeof sp.saved === "string" && <p className="mt-3 rounded bg-green-50 p-2 text-sm text-green-700">Layout saved.</p>}
      {typeof sp.error === "string" && <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-600">{sp.error}</p>}

      <form action={saveLayout} className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <input type="hidden" name="page_type" value={type} />
        {entity && <input type="hidden" name="entity_id" value={entity} />}
        <LayoutEditor key={`${type}:${entity ?? "default"}`} pageType={type} initial={layout} />
      </form>

      <form action={resetLayout} className="mt-3">
        <input type="hidden" name="page_type" value={type} />
        {entity && <input type="hidden" name="entity_id" value={entity} />}
        <button className="text-sm text-gray-500 underline hover:text-red-500">
          {entity ? "Remove this page's override (use the default)" : "Reset to the built-in default"}
        </button>
      </form>
    </div>
  );
}

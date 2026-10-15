import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { getLayout } from "@/lib/blocks/layouts";
import type { PageType } from "@/lib/blocks/schema";
import { cookies } from "next/headers";
import { defaultVariant, isVariant, VARIANT_COOKIE } from "@/lib/variant";
import { THEME_SWITCHER_ENABLED } from "@/lib/theme-switcher-flag";
import { clearMyVariantOverride, resetLayout, saveHomeSections, saveLayout, saveSiteVariant } from "../actions";
import { HOME_SECTION_LABELS, LOCKED_VISIBLE } from "@/lib/home-sections";
import { homeSectionsSetting } from "@/lib/queries";
import { LayoutEditor } from "./LayoutEditor";
import { SubmitButton } from "@/components/SubmitButton";

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

  const [siteDefault, cookieStore, sections] = await Promise.all([defaultVariant(), cookies(), homeSectionsSetting()]);
  const myChoice = cookieStore.get(VARIANT_COOKIE)?.value;
  const myOverride = isVariant(myChoice) && myChoice !== siteDefault ? myChoice : null;
  const VARIANT_LABEL = { forge: "Forge", grid: "Grid" } as const;
  // With the switcher off, the card only surfaces as a way back to grid: a
  // database whose row still says forge, or a browser holding an old preview
  // cookie, would otherwise be stuck there with no control in sight.
  const showDesignCard = THEME_SWITCHER_ENABLED || siteDefault !== "grid" || myOverride !== null;

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

      {/* A28 / GAPS A8.2: the design every visitor gets. The floating switcher
          only ever changed the admin's own browser. */}
      {showDesignCard && (
      <section aria-labelledby="site-design" className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 id="site-design" className="font-bold text-ink">Homepage design</h2>
        <p className="mt-1 text-sm text-graphite">
          Which of the two designs every visitor sees. Changes apply to the next page anyone loads — no redeploy.
        </p>
        {sp.saved === "variant" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Every visitor now gets {VARIANT_LABEL[siteDefault]}.</p>}
        {sp.saved === "override" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">This browser now follows the site-wide design.</p>}
        <form action={saveSiteVariant} className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          {(["forge", "grid"] as const).map((v) => (
            <label key={v} className="flex items-center gap-1.5">
              <input type="radio" name="variant" value={v} defaultChecked={siteDefault === v} />
              {VARIANT_LABEL[v]}{siteDefault === v && <span className="text-graphite"> (live now)</span>}
            </label>
          ))}
          <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-3 py-1.5 font-semibold text-white disabled:opacity-50">Save for every visitor</SubmitButton>
        </form>
        {myOverride && (
          <form action={clearMyVariantOverride} className="mt-3 rounded bg-graphite/10 p-2 text-sm">
            This browser is previewing <b>{VARIANT_LABEL[myOverride]}</b> through the design switcher, so it won&apos;t show
            the site-wide choice.{" "}
            <button className="font-semibold underline">Show me what visitors see</button>
          </form>
        )}
      </section>
      )}

      {/* A13 / GAPS A1.7: the grid homepage's sections below the fold. */}
      <section id="home-sections" aria-labelledby="home-sections-title" className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 id="home-sections-title" className="font-bold text-ink">Homepage sections (Grid design)</h2>
        <p className="mt-1 text-sm text-graphite">
          The order of the sections below the top of the Grid homepage, and which show. The top of the page and the
          three advert banners stay where they are — a banner always sits after the first section and after the last.
          Sections with paid placements can move but can&apos;t be hidden. The Forge design is not affected.
        </p>
        {sp.saved === "sections" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Homepage sections saved.</p>}
        <form action={saveHomeSections} className="mt-3 text-sm">
          <input type="hidden" name="order" value={sections.order.join(",")} />
          <ol className="divide-y rounded border">
            {sections.order.map((id, i) => {
              const locked = LOCKED_VISIBLE.has(id);
              return (
                <li key={id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="w-5 text-graphite">{i + 1}.</span>
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    {/* Paid sections post nothing to hide them with; the action enforces it too. */}
                    <input type="checkbox" name={`show_${id}`} defaultChecked={!sections.hidden.includes(id)} disabled={locked} />
                    <span>{HOME_SECTION_LABELS[id]}</span>
                    {locked && <span className="text-xs text-graphite">(paid placement — always shown)</span>}
                  </label>
                  <span className="flex gap-1">
                    <button name="move" value={`${id}:up`} disabled={i === 0} aria-label={`Move ${HOME_SECTION_LABELS[id]} up`} className="rounded border px-2 py-0.5 disabled:opacity-30">↑</button>
                    <button name="move" value={`${id}:down`} disabled={i === sections.order.length - 1} aria-label={`Move ${HOME_SECTION_LABELS[id]} down`} className="rounded border px-2 py-0.5 disabled:opacity-30">↓</button>
                  </span>
                </li>
              );
            })}
          </ol>
          <SubmitButton pendingLabel="Saving…" className="mt-3 rounded bg-ink px-3 py-1.5 font-semibold text-white disabled:opacity-50">Save sections</SubmitButton>
        </form>
      </section>

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
      {sp.saved === "1" && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Layout saved.</p>}
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

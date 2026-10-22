import Link from "next/link";
import { adPreview, bookingPhase, soldOn } from "@/lib/adverts";
import { bannerInventory } from "@/lib/banner-inventory";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must, mustList } from "@/lib/db/must";
import { AdPreviewToggle } from "@/components/console/AdPreviewToggle";
import { Badge, Stat } from "@/components/console/ui";
import { PHASE_LABELS } from "@/components/console/advert-formats";
import { saveBooking } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Bookings, and only bookings: who is running, when, and the paid placements
 * that sit alongside them.
 *
 * How many banner spots we sell is set on /console/adverts/banners; this page
 * only shows today's count against it. A run's price is set here, on the
 * booking itself (fix-list 77 — there is no rate card).
 */

const PHASE_FILTERS = ["all", "live", "upcoming", "awaiting", "awaiting_payment", "changes_needed", "draft", "ended"] as const;
const PHASE_FILTER_LABELS: Record<string, string> = { all: "All", ...PHASE_LABELS };
/** Work first, dead rows last. Both tables used to open on the oldest expired run. */
const PHASE_ORDER: Record<string, number> = { live: 0, awaiting: 1, awaiting_payment: 2, changes_needed: 3, upcoming: 4, draft: 5, ended: 6 };

const PLACEMENT_FILTERS = ["all", "current", "upcoming", "past"] as const;
const PLACEMENT_ORDER: Record<string, number> = { current: 0, upcoming: 1, past: 2 };

/** Where each placement kind is edited (fix-list 76). Featured machines are Site Config's. */
const PLACEMENT_EDIT: Record<string, string> = {
  featured_member: "/console/adverts/featured-member",
  takeover: "/console/adverts/takeover",
};

/** Placements carry no status column — the term alone decides where they sit. */
function placementPhase(p: { starts_on: string; ends_on: string }, today: string): "current" | "upcoming" | "past" {
  if (p.starts_on > today) return "upcoming";
  return p.ends_on < today ? "past" : "current";
}

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function AdvertsPage(props: PageProps<"/console/adverts">) {
  await requireConsole();
  const sp = await props.searchParams;
  const db = serviceDb();
  // eslint-disable-next-line react-hooks/purity -- server component, per-request render is the point
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const weekOut = new Date(now + 7 * 864e5).toISOString().slice(0, 10);
  const monthAgo = new Date(now - 30 * 864e5).toISOString();

  const phaseParam = one(sp.phase);
  const phaseFilter = PHASE_FILTERS.includes(phaseParam as (typeof PHASE_FILTERS)[number]) ? phaseParam! : "all";
  const placementParam = one(sp.placements);
  const placementFilter = PLACEMENT_FILTERS.includes(placementParam as (typeof PLACEMENT_FILTERS)[number]) ? placementParam! : "all";

  // Filter links keep whichever filter the reader is not currently changing.
  const filterHref = (key: "phase" | "placements", value: string) => {
    const params = new URLSearchParams();
    const phase = key === "phase" ? value : phaseFilter;
    const placements = key === "placements" ? value : placementFilter;
    if (phase !== "all") params.set("phase", phase);
    if (placements !== "all") params.set("placements", placements);
    const qs = params.toString();
    return `/console/adverts${qs ? `?${qs}` : ""}${key === "placements" ? "#placements" : ""}`;
  };

  const [adverts, bookings, placements, { count: openInterest }, { count: impressions30 }, previewOn, bannerSpots] = await Promise.all([
    must(db.from("adverts").select("id, name, format").order("created_at", { ascending: false }).limit(500), "console/adverts list"),
    must(db.from("advert_bookings").select("id, advert_id, status, starts_on, ends_on, advert:adverts(name, format)").order("ends_on", { ascending: false }).limit(500), "console/adverts bookings"),
    must(db.from("placements").select("id, kind, grid_position, starts_on, ends_on, awaiting_payment, member:members(name), machine:featured_machines(name)").order("ends_on", { ascending: false }).limit(500), "console/adverts placements"),
    // head:true — only the count comes back, so these two go through mustList.
    mustList(db.from("visibility_requests").select("id", { count: "exact", head: true }).eq("status", "requested"), "console/adverts open interest"),
    // The metric the page calls the headline one, finally readable here: the
    // same ad_impression rows /api/seen writes and the member's own dashboard
    // reads (src/app/dashboard/stats/page.tsx), across every advertiser.
    mustList(
      db.from("analytics_events").select("id", { count: "exact", head: true }).eq("kind", "ad_impression").gte("occurred_at", monthAgo),
      "console/adverts impressions",
    ),
    adPreview(),
    bannerInventory(today, "console/adverts"),
  ]);
  const bannersSold = soldOn(bannerSpots.bookings, today);

  const live = (bookings ?? []).filter((b) => bookingPhase(b, today) === "live");
  // Tallied per format rather than two hard-coded counters, so a format added to
  // the check constraint shows up here without another edit.
  const byFormat = live.reduce<Record<string, number>>((acc, b) => {
    const f = b.advert?.format;
    if (f) acc[f] = (acc[f] ?? 0) + 1;
    return acc;
  }, {});
  const liveFormats = Object.entries(byFormat).sort((a, b) => b[1] - a[1]);

  // Phase is computed, not stored, so the ordering has to happen here rather
  // than in the query. Within a phase: soonest to expire first for anything
  // still running, most recently finished first for anything that isn't.
  const bookingRows = (bookings ?? [])
    .map((b) => ({ ...b, phase: bookingPhase(b, today) }))
    .filter((b) => phaseFilter === "all" || b.phase === phaseFilter)
    .sort((a, b) =>
      PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] ||
      (a.phase === "ended" ? b.ends_on.localeCompare(a.ends_on) : a.ends_on.localeCompare(b.ends_on)));

  const placementRows = (placements ?? [])
    .map((p) => ({ ...p, phase: placementPhase(p, today) }))
    .filter((p) => placementFilter === "all" || p.phase === placementFilter)
    .sort((a, b) =>
      PLACEMENT_ORDER[a.phase] - PLACEMENT_ORDER[b.phase] ||
      (a.phase === "past" ? b.ends_on.localeCompare(a.ends_on) : a.ends_on.localeCompare(b.ends_on)));

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-ink">Advert bookings</h1>
      <p className="mt-1 text-sm text-graphite">
        Rotation is random-uniform — no advertiser can buy position. Impressions are the headline metric.
        How many banner spots we sell is on{" "}
        <Link href="/console/adverts/banners" className="underline">Banners</Link>.
      </p>

      {typeof sp.saved === "string" && <p role="status" className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.deleted === "string" && <p role="status" className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Draft deleted.</p>}
      {/* saveBooking sends the overlap rejection back here. Without this the
          booking form looked like a silent no-op. */}
      {typeof sp.error === "string" && <p role="alert" className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Live bookings"
          value={String(live.length)}
          sub={liveFormats.length ? liveFormats.map(([f, n]) => `${n} ${f.replace(/_/g, " ")}`).join(" · ") : "nothing booked"}
        />
        <Stat label="Impressions" value={(impressions30 ?? 0).toLocaleString("en-GB")} sub="last 30 days, all advertisers" />
        <Stat
          label="Banner spots"
          value={`${bannersSold} of ${bannerSpots.spots}`}
          sub={bannersSold > bannerSpots.spots
            ? <span className="font-semibold text-danger">over by {bannersSold - bannerSpots.spots} today</span>
            : <Link href="/console/adverts/banners" className="underline">sold today · months ahead</Link>}
        />
        <Stat
          label="Interest"
          value={String(openInterest ?? 0)}
          sub={<Link href="/console/adverts/interest" className="underline">members waiting to hear back</Link>}
        />
      </div>

      <div className="mt-4"><AdPreviewToggle initialOn={previewOn} /></div>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold text-ink">Bookings</h2>
          <div className="flex flex-wrap gap-1 text-xs">
            {PHASE_FILTERS.map((f) => (
              <Link
                key={f}
                href={filterHref("phase", f)}
                aria-current={f === phaseFilter ? "page" : undefined}
                className={`rounded px-2 py-1 ${f === phaseFilter ? "bg-ink font-semibold text-white" : "text-graphite hover:text-ink"}`}
              >
                {PHASE_FILTER_LABELS[f]}
              </Link>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto mt-2">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-left text-xs uppercase text-graphite"><th scope="col" className="py-1">Advert</th><th scope="col">Format</th><th scope="col">Start</th><th scope="col">End</th><th scope="col" /><th scope="col" /></tr></thead>
          <tbody>
            {bookingRows.map((b) => {
              // Phase, not raw dates: a draft or sent-back booking whose dates
              // happen to span today shows nothing publicly, and must not be
              // labelled "live" here either.
              const expiring = b.phase === "live" && b.ends_on <= weekOut;
              return (
                <tr key={b.id} className="border-t">
                  <td className="py-2">
                    <Link href={`/console/adverts/${b.id}`} className="hover:underline">{b.advert?.name}</Link>
                  </td>
                  <td className="text-graphite">{b.advert?.format}</td>
                  <td>{b.starts_on}</td>
                  <td className={expiring ? "font-semibold text-brand-text" : ""}>{b.ends_on}{expiring && " ⚠"}</td>
                  <td>
                    {b.phase === "live"
                      ? <Badge tone="green">live</Badge>
                      : b.phase === "awaiting"
                      ? <Badge tone="brand">awaiting approval</Badge>
                      : b.phase === "awaiting_payment"
                      ? <Badge tone="brand">awaiting payment</Badge>
                      : PHASE_LABELS[b.phase]}
                  </td>
                  <td className="text-right">
                    <Link href={`/console/adverts/${b.id}`} className="text-xs text-graphite hover:underline">open</Link>
                  </td>
                </tr>
              );
            })}
            {!bookingRows.length && (
              <tr><td colSpan={6} className="py-4 text-center text-graphite">
                {phaseFilter === "all" ? "No bookings yet." : `No ${PHASE_LABELS[phaseFilter]} bookings.`}
              </td></tr>
            )}
          </tbody>
        </table>
        </div>
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">New booking</h2>
        <form action={saveBooking} className="mt-2 flex flex-wrap items-end gap-3 text-sm">
          <label className="block max-w-full">Advert
            <select name="advert_id" className="mt-1 block max-w-full rounded border px-3 py-2">
              {(adverts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.format})</option>)}
            </select>
          </label>
          {/* The price lives on the run itself (fix-list 77); blank means Jas
              invoices by hand. */}
          <label className="block">Price (£)
            <input name="price_pounds" inputMode="decimal" placeholder="optional" className="mt-1 block w-28 rounded border px-3 py-2" />
          </label>
          <label className="block">Start<input type="date" name="starts_on" required className="mt-1 block rounded border px-3 py-2" /></label>
          <label className="block">End<input type="date" name="ends_on" required className="mt-1 block rounded border px-3 py-2" /></label>
          <label className="block grow">Notes<input name="notes" className="mt-1 block w-full rounded border px-3 py-2" placeholder="PO ref…" /></label>
          <button className="rounded bg-ink px-4 py-2 text-white">Book</button>
        </form>
        <p className="mt-2 text-xs text-graphite">
          Booking it here approves it — it goes live on its start date. Artwork is swappable mid-run from{" "}
          <Link href="/console/adverts/artwork" className="underline">Artwork</Link>; the dates stay put.
        </p>
      </section>

      <section id="placements" className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold text-ink">Paid placements (hold their spot for the paid period)</h2>
          <div className="flex flex-wrap gap-1 text-xs">
            {PLACEMENT_FILTERS.map((f) => (
              <Link
                key={f}
                href={filterHref("placements", f)}
                aria-current={f === placementFilter ? "page" : undefined}
                className={`rounded px-2 py-1 ${f === placementFilter ? "bg-ink font-semibold text-white" : "text-graphite hover:text-ink"}`}
              >
                {f === "all" ? "All" : f}
              </Link>
            ))}
          </div>
        </div>
        {/* Also in the section nav now — kept here because this is the table
            they add a row to. */}
        <p className="mt-1 flex flex-wrap gap-3 text-xs">
          <Link href="/console/adverts/takeover" className="text-graphite hover:underline">Book a homepage takeover →</Link>
          <Link href="/console/adverts/featured-member" className="text-graphite hover:underline">Book Featured Member →</Link>
          <Link href="/console/adverts/bundles" className="text-graphite hover:underline">Bundles →</Link>
        </p>
        <div className="overflow-x-auto mt-2">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-left text-xs uppercase text-graphite"><th scope="col" className="py-1">Kind</th><th scope="col">Who / what</th><th scope="col">Position</th><th scope="col">From</th><th scope="col">To</th><th scope="col" /></tr></thead>
          <tbody>
            {placementRows.map((p) => {
              const edit = PLACEMENT_EDIT[p.kind];
              return (
                <tr key={p.id} className="border-t">
                  <td className="py-2">
                    {p.kind.replace("_", " ")}
                    {p.awaiting_payment && <span className="ml-1.5 text-xs font-semibold text-brand-text">awaiting payment</span>}
                  </td>
                  <td>{p.machine?.name ?? p.member?.name}</td>
                  <td>{p.grid_position ?? "—"}</td>
                  <td>{p.starts_on}</td>
                  <td>{p.ends_on}</td>
                  <td className="text-right">
                    {edit && <Link href={`${edit}/${p.id}`} className="text-xs text-graphite hover:underline">edit</Link>}
                  </td>
                </tr>
              );
            })}
            {!placementRows.length && (
              <tr><td colSpan={6} className="py-4 text-center text-graphite">
                {placementFilter === "all" ? "No paid placements yet." : `No ${placementFilter} placements.`}
              </td></tr>
            )}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}

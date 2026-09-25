import Image from "next/image";
import Link from "next/link";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { getLayout } from "@/lib/blocks/layouts";
import { adSlotKeys } from "@/lib/blocks/schema";
import { mediaUrl } from "@/lib/db/server";
import { isMemberLinkable } from "@/lib/member-visibility";
import { activePlacements, publishedStories } from "@/lib/queries";
import { BlockRenderer } from "@/components/blocks/BlockRenderer";
import { RichText } from "@/components/RichText";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Featured Machine",
  description: "The SMI featured machine — a closer look at one machine working in the UK sheet metal trade.",
  alternates: { canonical: "/featured-machine" },
};

export default async function FeaturedMachinePage() {
  const [placements, layout, ctx] = await Promise.all([activePlacements(), getLayout("featured_machine"), requestContext()]);
  const [banners, { stories: latest }, logos, showPlaceholders] = await Promise.all([
    liveAdverts("banner"),
    layout.blocks.some((b) => b.type === "latest_news") ? publishedStories({ limit: 4 }) : Promise.resolve({ stories: [] }),
    layout.blocks.some((b) => b.type === "supplier_logos") ? liveAdverts("supplier_logo") : Promise.resolve([]),
    showAdPlaceholders(),
  ]);
  const slots = dealSlots(banners, adSlotKeys("featured_machine", layout));

  // impressions come from the browser once seen — see AdCreative / /api/seen
  record([{ kind: "page_view", path: "/featured-machine", ...ctx }]);

  const machines = placements.filter((p) => p.kind === "featured_machine" && p.machine?.status === "published");

  const machineMain = (
    <>
      <h1 className="mt-6 text-2xl font-bold text-ink">Featured Machine</h1>
      {machines.length === 0 && <p className="mt-6 text-graphite">No featured machine this month.</p>}
      {/* seller: the shared rule (lib/member-visibility.ts), applied a second
          time on purpose. activePlacements already nulls a member who fails it
          — this is serviceDb, so nothing in the database does — and that is the
          filter the page actually depends on; keeping the call here means a
          future projection change cannot quietly turn the credit back on. */}
      {machines.map(({ machine }) => machine && (
        <article key={machine.id} className="mt-6 overflow-hidden rounded-xl bg-white shadow-sm">
          {machine.image_path && (
            <div className="relative h-80 bg-graphite/10">
              <Image src={mediaUrl(machine.image_path)!} alt="" fill sizes="100vw" className="object-cover" unoptimized />
            </div>
          )}
          <div className="p-6">
            <p className="text-xs uppercase tracking-widest text-brand-text">Machine of the month</p>
            <h2 className="mt-1 text-2xl font-bold text-ink">{machine.name}</h2>
            {isMemberLinkable(machine.member) && (
              <p className="mt-1 text-sm text-graphite">
                Offered by <Link href={`/member/${machine.member.slug}`} className="text-graphite underline">{machine.member.name}</Link>
              </p>
            )}
            <RichText html={machine.description} className="mt-4 text-ink" />
            <div className="mt-6 flex flex-wrap gap-3">
              {machine.external_url && (
                <a href={machine.external_url} target="_blank" rel="noopener" className="rounded bg-ink px-5 py-2.5 text-white">
                  Full details on the seller&apos;s site →
                </a>
              )}
              {isMemberLinkable(machine.member) && (
                <Link href={`/member/${machine.member.slug}`} className="rounded border px-5 py-2.5">Seller&apos;s SMI page</Link>
              )}
            </div>
          </div>
        </article>
      ))}
    </>
  );

  return (
    <div className="mx-auto max-w-4xl px-4">
      <BlockRenderer
        pageType="featured_machine"
        layout={layout}
        slots={slots}
        latestStories={latest}
        supplierLogos={logos}
        showPlaceholders={showPlaceholders}
        path="/featured-machine"
        anchors={{ machine_main: machineMain }}
      />
      <div className="my-10" />
    </div>
  );
}

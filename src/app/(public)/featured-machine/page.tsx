import Image from "next/image";
import Link from "next/link";
import { record, requestContext } from "@/lib/analytics";
import { mediaUrl } from "@/lib/db/server";
import { activePlacements } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Featured Machine" };

export default async function FeaturedMachinePage() {
  const [placements, ctx] = await Promise.all([activePlacements(), requestContext()]);
  record([{ kind: "page_view", path: "/featured-machine", ...ctx }]);
  const machines = placements.filter((p) => p.kind === "featured_machine" && p.machine);

  return (
    <div className="mx-auto max-w-4xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-navy">Featured Machine</h1>
      {machines.length === 0 && <p className="mt-6 text-gray-500">No featured machine this month.</p>}
      {machines.map(({ machine }) => machine && (
        <article key={machine.id} className="mt-6 overflow-hidden rounded-xl bg-white shadow-sm">
          {machine.image_path && (
            <div className="relative h-80 bg-steel/10">
              <Image src={mediaUrl(machine.image_path)!} alt="" fill sizes="100vw" className="object-cover" unoptimized />
            </div>
          )}
          <div className="p-6">
            <p className="text-xs uppercase tracking-widest text-amber">Machine of the month</p>
            <h2 className="mt-1 text-2xl font-bold text-navy">{machine.name}</h2>
            {machine.member && (
              <p className="mt-1 text-sm text-gray-500">
                Offered by <Link href={`/members/${machine.member.slug}`} className="text-steel underline">{machine.member.name}</Link>
              </p>
            )}
            <p className="mt-4 text-gray-700">{machine.description}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              {machine.external_url && (
                <a href={machine.external_url} target="_blank" rel="noopener" className="rounded bg-navy px-5 py-2.5 text-white">
                  Full details on the seller&apos;s site →
                </a>
              )}
              {machine.member && (
                <Link href={`/members/${machine.member.slug}`} className="rounded border px-5 py-2.5">Seller&apos;s SMI page</Link>
              )}
            </div>
          </div>
        </article>
      ))}
      <div className="my-10" />
    </div>
  );
}

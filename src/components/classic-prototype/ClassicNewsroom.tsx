import Image from "next/image";
import Link from "next/link";
import { mediaUrl } from "@/lib/db/server";
import { focusStyle } from "@/lib/focus";
import type { StoryCard } from "@/lib/queries";

/*
 * PROTOTYPE (issue #59, variant A). The live homepage's "Newsroom": one big
 * image tile with a bottom gradient, three stacked small tiles beside it, each
 * with an orange #1–#4 badge hanging off its corner. Badge text is ink, not
 * the live site's white (2.49:1).
 */
const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

function Badge({ n }: { n: number }) {
  return <span className="absolute -left-2 -top-2 z-10 grid h-10 w-10 place-items-center rounded-[5px] bg-brand text-lg text-ink">#{n}</span>;
}

export function ClassicNewsroom({ stories }: { stories: StoryCard[] }) {
  const [lead, ...small] = stories.slice(0, 4);
  if (!lead) return null;
  const leadImg = mediaUrl(lead.cover_path);
  return (
    <div>
      <h2 className="mb-6 inline-flex items-center gap-3 text-[2rem] font-normal">
        <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-full bg-brand text-ink">📣</span>
        Newsroom
      </h2>
      <div className="grid gap-6 lg:grid-cols-[65fr_35fr]">
        <Link href={`/news/${lead.slug}`} className="group relative block min-h-[500px] overflow-visible">
          <Badge n={1} />
          <div className="absolute inset-0 overflow-hidden rounded-[5px] bg-graphite/20">
            {leadImg && <Image src={leadImg} alt="" fill sizes="(max-width: 1024px) 100vw, 60vw" style={focusStyle(lead.cover_focus)} className="object-cover" unoptimized />}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent p-6 pt-24 text-white">
              <h3 className="text-2xl uppercase leading-tight group-hover:underline sm:text-3xl">{lead.title}</h3>
              <p className="mt-2 text-sm uppercase text-white/85">{date(lead.published_at)}</p>
              <span className="mt-4 inline-block rounded-[5px] bg-[#3100ff] px-5 py-2 text-white group-hover:bg-brand group-hover:text-ink">Read</span>
            </div>
          </div>
        </Link>
        <div className="grid gap-6">
          {small.map((s, i) => {
            const img = mediaUrl(s.cover_path);
            return (
              <Link key={s.id} href={`/news/${s.slug}`} className="group relative grid grid-cols-[35%_1fr] gap-4 rounded-[5px] bg-white p-3 shadow-[0_5px_25px_rgb(0_0_0/0.08)]">
                <Badge n={i + 2} />
                <div className="relative min-h-28 overflow-hidden rounded-[5px] bg-graphite/20">
                  {img && <Image src={img} alt="" fill sizes="200px" style={focusStyle(s.cover_focus)} className="object-cover" unoptimized />}
                </div>
                <div className="flex flex-col">
                  <h3 className="line-clamp-3 text-lg uppercase leading-snug group-hover:underline">{s.title}</h3>
                  <p className="mt-1 text-sm uppercase text-[#666]">{date(s.published_at)}</p>
                  <span className="mt-auto pt-2 text-[#3100ff] group-hover:text-[#1d0099]">Read →</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

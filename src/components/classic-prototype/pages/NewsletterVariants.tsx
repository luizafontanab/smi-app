import Image from "next/image";
import Link from "next/link";
import { mediaUrl } from "@/lib/db/server";
import { focusStyle } from "@/lib/focus";
import { diaryDate, DIARY_HEADING, DIRECTORY_HEADING, type IssueBlock } from "@/lib/newsletter-layout";
import { Banner, BlueButton, DiscHeading, LiveCard, Panel } from "./bits";

/*
 * PROTOTYPE (issue #63). Two structural takes on /newsletters/[slug] in
 * Classic. The live site has no on-site issue page (issues are mailchi.mp
 * links); its /newsletters/ page is a banner, a latest-issue feature row and
 * a plain list of month links.
 *
 *   A2 "Live Newsletters page shape": banner, the lead story as the feature
 *      row, the rest as a 3-up card grid in a white panel, then the
 *      "Previous Newsletters" list of blue links.
 *   A3 "Article shape": the issue read like a story page. One narrow white
 *      panel, uppercase title, standfirst, then the items as a numbered
 *      #1–#n list (the Newsroom badge), diary and directory as sections.
 *
 * Adverts keep their place in the issue order (issueBlocks) in both. Local
 * seed issues carry none, so they were not seen in the prototype.
 */
export type IssueCard = { key: string; href: string; title: string; summary: string | null; image: string | null; focus: unknown; kicker: string | null; cta: string };
type Ad = { id: string; format: string | null; name: string | null; headline?: string | null; body?: string | null; desktop_path: string | null; mobile_path: string | null };

type Props = {
  issue: { number: number; subject: string; intro: string | null; sent_at: string | null };
  blocks: IssueBlock<IssueCard, Ad>[];
  sponsor: Ad | null;
  sponsorImage: string | null;
  extras: { events: { slug: string; title: string; location: string | null; starts_on: string; ends_on: string | null }[]; directory: { slug: string; name: string }[] };
  previous: { number: number; subject: string; web_slug: string | null; sent_at: string | null }[];
};

const month = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Europe/London" }) : "";

function AdBlock({ ad }: { ad: Ad }) {
  const image = mediaUrl(ad.mobile_path) ?? mediaUrl(ad.desktop_path);
  if (!image) return null;
  return (
    <div>
      <p className="text-sm uppercase text-[#666]">Advertisement</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- prototype */}
      <a href={`/visit/${ad.id}?src=newsletter`} className="mt-1 block"><img src={image} alt={ad.name ?? "Advertisement"} className="w-full rounded-[5px]" /></a>
    </div>
  );
}

function Sponsor({ sponsor, sponsorImage, dark }: { sponsor: Ad | null; sponsorImage: string | null; dark?: boolean }) {
  if (!sponsor || !sponsorImage) return null;
  return (
    <p className={`mt-3 flex items-center gap-3 text-sm uppercase ${dark ? "text-white/80" : "text-[#666]"}`}>
      In association with
      {/* eslint-disable-next-line @next/next/no-img-element -- prototype */}
      <a href={`/visit/${sponsor.id}?src=newsletter`}><img src={sponsorImage} alt={sponsor.name ?? "Sponsor"} className="h-8 w-auto" /></a>
    </p>
  );
}

function Extras({ extras }: { extras: Props["extras"] }) {
  return (
    <>
      {extras.events.length > 0 && (
        <section>
          <DiscHeading icon="📅" size="text-2xl">{DIARY_HEADING}</DiscHeading>
          <ul className="mt-4 divide-y divide-[#e2e2e2]">
            {extras.events.map((e) => (
              <li key={e.slug} className="py-3">
                <p className="text-sm uppercase text-[#666]">{diaryDate(e.starts_on, e.ends_on)}</p>
                <Link href={`/event/${e.slug}`} className="text-lg text-[#3100ff] hover:text-[#1d0099]">{e.title}</Link>
                {e.location && <p className="text-sm text-[#666]">{e.location}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {extras.directory.length > 0 && (
        <section>
          <DiscHeading icon="👥" size="text-2xl">{DIRECTORY_HEADING}</DiscHeading>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            {extras.directory.map((m) => <li key={m.slug}><Link href={`/member/${m.slug}`} className="text-[#3100ff] hover:text-[#1d0099]">{m.name}</Link></li>)}
          </ul>
        </section>
      )}
    </>
  );
}

export function NewsletterLiveShape({ issue, blocks, sponsor, sponsorImage, extras, previous }: Props) {
  const lead = blocks.find((b) => b.kind === "lead")?.item;
  return (
    <div>
      <Banner image={lead?.image ?? null} focus={lead?.focus} eyebrow={`SMI Monthly · Issue ${issue.number} · ${month(issue.sent_at)}`} title={issue.subject}>
        <Sponsor sponsor={sponsor} sponsorImage={sponsorImage} dark />
      </Banner>
      <div className="mx-auto max-w-6xl px-4 py-12">
        {lead && (
          <Link href={lead.href} className="group grid items-center gap-8 md:grid-cols-2">
            <div className="relative aspect-[5/4] overflow-hidden rounded-[5px] bg-graphite/15">
              {lead.image && <Image src={lead.image} alt="" fill sizes="50vw" style={focusStyle(lead.focus)} className="object-cover" unoptimized />}
            </div>
            <div>
              <p className="text-sm uppercase text-[#666]">Top story</p>
              <h2 className="mt-2 text-[2rem] font-normal leading-tight text-[#3100ff] group-hover:text-[#1d0099]">{lead.title}</h2>
              {issue.intro && <p className="mt-4 text-lg">{issue.intro}</p>}
              {lead.summary && <p className="mt-3 uppercase text-[#444]">{lead.summary}</p>}
            </div>
          </Link>
        )}

        <Panel className="mt-12">
          <h2 className="text-[2rem] font-normal">In this issue</h2>
          <div className="mt-8 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {blocks.map((b, i) => {
              if (b.kind === "row") return b.items.map((c) => <LiveCard key={c.key} href={c.href} title={c.title} image={c.image} focus={c.focus} kicker={c.kicker} meta={[c.cta]} />);
              if (b.kind === "ad") return <div key={`ad-${i}`} className="col-span-full"><AdBlock ad={b.ad} /></div>;
              return null;
            })}
          </div>
        </Panel>

        {(extras.events.length > 0 || extras.directory.length > 0) && (
          <Panel className="mt-8 grid gap-10 md:grid-cols-2"><Extras extras={extras} /></Panel>
        )}

        <section className="mx-auto mt-14 max-w-3xl">
          <h2 className="text-[2rem] font-normal">Previous Newsletters</h2>
          <ul className="mt-4 space-y-4">
            {previous.map((p) => (
              <li key={p.number}><Link href={`/newsletters/${p.web_slug}`} className="text-lg text-[#3100ff] hover:text-[#1d0099]">{month(p.sent_at)}: {p.subject}</Link></li>
            ))}
          </ul>
          <div className="mt-8"><BlueButton href="/newsletters">All newsletters</BlueButton></div>
        </section>
      </div>
    </div>
  );
}

export function NewsletterArticleShape({ issue, blocks, sponsor, sponsorImage, extras }: Props) {
  const numbers = new Map(blocks.flatMap((b) => (b.kind === "lead" ? [b.item] : b.kind === "row" ? b.items : [])).map((c, i) => [c.key, i + 1]));
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Link href="/newsletters" className="text-[#3100ff] hover:text-[#1d0099]">‹ Back to Newsletters</Link>
      <Panel className="mt-4 md:px-12">
        <p className="text-sm uppercase text-[#666]">SMI Monthly · Issue {issue.number} · {month(issue.sent_at)}</p>
        <h1 className="mt-2 text-[clamp(2rem,1.2rem+2.7vw,3.25rem)] font-normal uppercase leading-[1.1]">{issue.subject}</h1>
        <Sponsor sponsor={sponsor} sponsorImage={sponsorImage} />
        {issue.intro && <p className="mt-6 text-xl leading-relaxed">{issue.intro}</p>}

        <ol className="mt-10 space-y-8">
          {blocks.map((b, i) => {
            if (b.kind === "heading") return null;
            if (b.kind === "ad") return <li key={`ad-${i}`} className="list-none"><AdBlock ad={b.ad} /></li>;
            const items = b.kind === "lead" ? [b.item] : b.items;
            return items.map((c) => {
              const n = numbers.get(c.key);
              return (
                <li key={c.key} className="list-none">
                  <Link href={c.href} className="group relative grid gap-5 sm:grid-cols-[35%_1fr]">
                    <span className="absolute -left-2 -top-2 z-10 grid h-10 w-10 place-items-center rounded-[5px] bg-brand text-lg text-ink">#{n}</span>
                    <div className="relative aspect-[3/2] overflow-hidden rounded-[5px] bg-graphite/15">
                      {c.image && <Image src={c.image} alt="" fill sizes="300px" style={focusStyle(c.focus)} className="object-cover" unoptimized />}
                    </div>
                    <div>
                      {c.kicker && <p className="text-sm uppercase text-[#666]">{c.kicker}</p>}
                      <h2 className="text-xl uppercase leading-snug group-hover:underline">{c.title}</h2>
                      {c.summary && <p className="mt-2 line-clamp-3 text-[#444]">{c.summary}</p>}
                      <span className="mt-2 inline-block text-[#3100ff] group-hover:text-[#1d0099]">{c.cta} ›</span>
                    </div>
                  </Link>
                </li>
              );
            });
          })}
        </ol>

        {(extras.events.length > 0 || extras.directory.length > 0) && <div className="mt-12 space-y-10 border-t-2 border-[#e2e2e2] pt-10"><Extras extras={extras} /></div>}
      </Panel>
    </div>
  );
}

import Image from "next/image";
import Link from "next/link";
import { mediaUrl } from "@/lib/db/server";
import { focusStyle } from "@/lib/focus";
import { diaryDate, DIARY_HEADING, DIRECTORY_HEADING, issueBlocks, splitMastheadSponsor, STORY_SECTION_HEADING } from "@/lib/newsletter-layout";
import type { issueExtras } from "@/lib/newsletter-extras";
import type { newsletterBySlug } from "@/lib/queries";

/** A sent issue as /newsletters/[slug] loads it. */
export type NewsletterIssue = NonNullable<Awaited<ReturnType<typeof newsletterBySlug>>>;
/** The issue's events diary and supplier directory (lib/newsletter-extras). */
export type NewsletterIssueExtras = Awaited<ReturnType<typeof issueExtras>>;

/** One story, video or sponsored-story card of an issue, as the web copy draws it. */
export type IssueCardData = { key: string; href: string; title: string; summary: string | null; image: string | null; focus: unknown; kicker: string | null; cta: string };

/**
 * What an issue page draws, read from the loaded issue: its story and video
 * cards in send order, the masthead sponsor (with its artwork) and the adverts
 * left to place between rows. Shared by every design option's issue view so
 * they read an issue the same way.
 */
export function issueContent(issue: NewsletterIssue) {
  // A story or video withdrawn since the send is hidden by RLS and comes back null; it is skipped.
  const cards = issue.items.flatMap(({ story, video, position }): IssueCardData[] => {
    if (story) return [{ key: `s${position}`, href: `/news/${story.slug}`, title: story.title, summary: story.excerpt, image: mediaUrl(story.cover_path), focus: story.cover_focus, kicker: null, cta: "Read article" }];
    if (video) return [{ key: `v${position}`, href: `/video/${video.slug}`, title: video.title, summary: null, image: mediaUrl(video.thumbnail_path), focus: null, kicker: "Video", cta: "Watch video" }];
    return [];
  });
  const placed = issue.ads.flatMap((slot) => (slot.advert ? [{ ...slot.advert, after_item: slot.after_item }] : []));
  const { sponsor, banners } = splitMastheadSponsor(placed);
  const sponsorImage = sponsor ? mediaUrl(sponsor.desktop_path) ?? mediaUrl(sponsor.mobile_path) : null;
  return { cards, sponsor, sponsorImage, banners };
}

function IssueCard({ card, lead = false }: { card: IssueCardData; lead?: boolean }) {
  return (
    <Link href={card.href} data-part="newsletter-card" className="group block">
      {card.image && (
        <div data-part="card-image" className={`relative overflow-hidden rounded ${lead ? "aspect-[2/1]" : "aspect-[264/176]"}`}>
          <Image src={card.image} alt={card.title} fill sizes={lead ? "(max-width: 768px) 100vw, 720px" : "(max-width: 640px) 100vw, 360px"} style={focusStyle(card.focus)} className="object-cover" unoptimized />
        </div>
      )}
      {card.kicker && <p data-part="card-meta" className="mt-2 text-xs uppercase tracking-wide text-graphite">{card.kicker}</p>}
      <p data-part="card-title" className={`mt-2 font-bold uppercase leading-snug group-hover:underline ${lead ? "text-xl" : "text-base"}`}>{card.title}</p>
      {card.summary && <p data-part="card-excerpt" className="mt-1 text-sm text-graphite">{card.summary}</p>}
      <p data-part="card-cta" className="mt-2 text-sm font-bold text-brand-text">{card.cta} →</p>
    </Link>
  );
}

/**
 * The web copy of a sent issue, laid out like the email (lib/newsletter-layout):
 * masthead sponsor, lead story, two-up cards, and adverts between the rows,
 * each routed through /visit with src=newsletter like the emailed links.
 *
 * Current's /newsletters/[slug] body. The route loads the issue, records the
 * view and renders this through the design-option hook point
 * (src/components/design-option.ts).
 */
export function NewsletterIssueView({ issue, extras }: { issue: NewsletterIssue; extras: NewsletterIssueExtras }) {
  const { cards, sponsor, sponsorImage, banners } = issueContent(issue);

  return (
    <div data-part="newsletter-issue" className="mx-auto max-w-3xl px-4">
      {sponsor && sponsorImage && (
        <div data-part="newsletter-sponsor" className="mt-6 flex items-center justify-end gap-3 rounded-t-xl border-b bg-white px-6 py-3">
          <span className="text-xs uppercase tracking-wide text-graphite">In association with</span>
          {/* eslint-disable-next-line @next/next/no-img-element -- sponsor artwork comes in any aspect ratio */}
          <a href={`/visit/${sponsor.id}?src=newsletter`}><img src={sponsorImage} alt={sponsor.name ?? "Sponsor"} className="h-10 w-auto" /></a>
        </div>
      )}
      <header data-part="page-head" className={`${sponsor && sponsorImage ? "" : "mt-6 rounded-t-xl"} bg-ink p-6 text-white`}>
        <p data-part="newsletter-issue-line" className="text-xs uppercase tracking-widest text-brand">SMI Monthly · Issue {issue.number}</p>
        <h1 data-part="page-title" className="mt-1 text-2xl font-bold">{issue.subject}</h1>
        {issue.intro && <p data-part="page-intro" className="mt-2 text-white/80">{issue.intro}</p>}
      </header>
      <div data-part="panel" className="space-y-6 rounded-b-xl bg-white p-6 shadow-sm">
        {issueBlocks(cards, banners).map((block, i) => {
          switch (block.kind) {
            case "lead":
              return <IssueCard key={block.item.key} card={block.item} lead />;
            case "heading":
              return <h2 key="heading" data-part="section-title" className="border-t-4 border-brand pt-4 text-sm font-bold uppercase tracking-widest">{STORY_SECTION_HEADING}</h2>;
            case "row":
              return (
                <div key={block.items[0].key} data-part="card-grid" className={block.items.length === 2 ? "grid gap-6 sm:grid-cols-2" : ""}>
                  {block.items.map((card) => <IssueCard key={card.key} card={card} lead={block.items.length === 1} />)}
                </div>
              );
            case "ad": {
              if (block.ad.format === "sponsored_story") {
                return (
                  <div key={`ad-${block.ad.id}-${i}`} data-part="newsletter-sponsored-story" className="rounded bg-shade p-4">
                    <IssueCard
                      card={{ key: block.ad.id, href: `/visit/${block.ad.id}?src=newsletter`, title: block.ad.headline ?? block.ad.name ?? "", summary: block.ad.body, image: mediaUrl(block.ad.desktop_path) ?? mediaUrl(block.ad.mobile_path), focus: null, kicker: "Sponsored", cta: "Read more" }}
                      lead
                    />
                  </div>
                );
              }
              const image = mediaUrl(block.ad.mobile_path) ?? mediaUrl(block.ad.desktop_path);
              if (!image) return null;
              return (
                <div key={`ad-${block.ad.id}-${i}`} data-part="newsletter-ad">
                  <p data-part="ad-label" className="text-xs uppercase tracking-wide text-graphite">Sponsored</p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- advert artwork is shown at its own size, as in the email */}
                  <a href={`/visit/${block.ad.id}?src=newsletter`} className="mt-1 block"><img src={image} alt={block.ad.name ?? "Sponsored"} className="w-full rounded" /></a>
                </div>
              );
            }
          }
        })}
        {extras.events.length > 0 && (
          <section data-part="newsletter-diary">
            <h2 data-part="section-title" className="border-t-4 border-brand pt-4 text-sm font-bold uppercase tracking-widest">{DIARY_HEADING}</h2>
            <ul className="mt-2 divide-y">
              {extras.events.map((event) => (
                <li key={event.slug} className="py-2">
                  <p data-part="card-meta" className="text-xs font-bold uppercase text-graphite">{diaryDate(event.starts_on, event.ends_on)}</p>
                  <Link href={`/event/${event.slug}`} data-part="card-title" className="font-bold hover:underline">{event.title}</Link>
                  {event.location && <p data-part="card-meta" className="text-sm text-graphite">{event.location}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {extras.directory.length > 0 && (
          <section data-part="newsletter-directory">
            <h2 data-part="section-title" className="border-t-4 border-brand pt-4 text-sm font-bold uppercase tracking-widest">{DIRECTORY_HEADING}</h2>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {extras.directory.map((member) => (
                <li key={member.slug}><Link href={`/member/${member.slug}`} className="font-bold hover:underline">{member.name}</Link></li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <div className="my-10" />
    </div>
  );
}

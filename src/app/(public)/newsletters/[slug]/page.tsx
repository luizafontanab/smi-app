import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { record, requestContext } from "@/lib/analytics";
import { mediaUrl } from "@/lib/db/server";
import { focusStyle } from "@/lib/focus";
import { diaryDate, DIARY_HEADING, DIRECTORY_HEADING, issueBlocks, splitMastheadSponsor, STORY_SECTION_HEADING } from "@/lib/newsletter-layout";
import { issueExtras } from "@/lib/newsletter-extras";
import { newsletterBySlug, sentNewsletters } from "@/lib/queries";
// PROTOTYPE (issue #63) — throwaway branch prototype-classic only.
import { pageVariant } from "@/components/classic-prototype/variant";
import { NewsletterArticleShape, NewsletterLiveShape } from "@/components/classic-prototype/pages/NewsletterVariants";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/newsletters/[slug]">) {
  const { slug } = await props.params;
  const issue = await newsletterBySlug(slug).catch(() => null);
  const title = issue ? `SMI Monthly · Issue ${issue.number} — ${issue.subject}` : "Newsletter";
  const description = issue?.intro ?? undefined;
  return {
    title,
    description,
    alternates: { canonical: `/newsletters/${slug}` },
    openGraph: { url: `/newsletters/${slug}`, title, description },
  };
}

type Card = { key: string; href: string; title: string; summary: string | null; image: string | null; focus: unknown; kicker: string | null; cta: string };

function IssueCard({ card, lead = false }: { card: Card; lead?: boolean }) {
  return (
    <Link href={card.href} className="group block">
      {card.image && (
        <div className={`relative overflow-hidden rounded ${lead ? "aspect-[2/1]" : "aspect-[264/176]"}`}>
          <Image src={card.image} alt={card.title} fill sizes={lead ? "(max-width: 768px) 100vw, 720px" : "(max-width: 640px) 100vw, 360px"} style={focusStyle(card.focus)} className="object-cover" unoptimized />
        </div>
      )}
      {card.kicker && <p className="mt-2 text-xs uppercase tracking-wide text-graphite">{card.kicker}</p>}
      <p className={`mt-2 font-bold uppercase leading-snug group-hover:underline ${lead ? "text-xl" : "text-base"}`}>{card.title}</p>
      {card.summary && <p className="mt-1 text-sm text-graphite">{card.summary}</p>}
      <p className="mt-2 text-sm font-bold text-brand-text">{card.cta} →</p>
    </Link>
  );
}

/**
 * The web copy of a sent issue, laid out like the email (lib/newsletter-layout):
 * masthead sponsor, lead story, two-up cards, and adverts between the rows,
 * each routed through /visit with src=newsletter like the emailed links.
 */
export default async function NewsletterIssuePage(props: PageProps<"/newsletters/[slug]">) {
  const { slug } = await props.params;
  const [issue, ctx] = await Promise.all([newsletterBySlug(slug), requestContext()]);
  if (!issue) notFound();
  const extras = await issueExtras(issue.id, issue.scheduled_at ?? issue.sent_at);
  record([{ kind: "page_view", path: `/newsletters/${slug}`, ...ctx }]);

  // A story or video withdrawn since the send is hidden by RLS and comes back null; it is skipped.
  const cards = issue.items.flatMap(({ story, video, position }): Card[] => {
    if (story) return [{ key: `s${position}`, href: `/news/${story.slug}`, title: story.title, summary: story.excerpt, image: mediaUrl(story.cover_path), focus: story.cover_focus, kicker: null, cta: "Read article" }];
    if (video) return [{ key: `v${position}`, href: `/video/${video.slug}`, title: video.title, summary: null, image: mediaUrl(video.thumbnail_path), focus: null, kicker: "Video", cta: "Watch video" }];
    return [];
  });
  const placed = issue.ads.flatMap((slot) => (slot.advert ? [{ ...slot.advert, after_item: slot.after_item }] : []));
  const { sponsor, banners } = splitMastheadSponsor(placed);
  const sponsorImage = sponsor ? mediaUrl(sponsor.desktop_path) ?? mediaUrl(sponsor.mobile_path) : null;

  const pv = await pageVariant();
  if (pv === "A2" || pv === "A3") {
    const props = { issue, blocks: issueBlocks(cards, banners), sponsor, sponsorImage, extras, previous: (await sentNewsletters()).filter((p) => p.number !== issue.number).slice(0, 12) };
    return pv === "A2" ? <NewsletterLiveShape {...props} /> : <NewsletterArticleShape {...props} />;
  }

  return (
    <div className="mx-auto max-w-3xl px-4">
      {sponsor && sponsorImage && (
        <div className="mt-6 flex items-center justify-end gap-3 rounded-t-xl border-b bg-white px-6 py-3">
          <span className="text-xs uppercase tracking-wide text-graphite">In association with</span>
          {/* eslint-disable-next-line @next/next/no-img-element -- sponsor artwork comes in any aspect ratio */}
          <a href={`/visit/${sponsor.id}?src=newsletter`}><img src={sponsorImage} alt={sponsor.name ?? "Sponsor"} className="h-10 w-auto" /></a>
        </div>
      )}
      <header className={`${sponsor && sponsorImage ? "" : "mt-6 rounded-t-xl"} bg-ink p-6 text-white`}>
        <p className="text-xs uppercase tracking-widest text-brand">SMI Monthly · Issue {issue.number}</p>
        <h1 className="mt-1 text-2xl font-bold">{issue.subject}</h1>
        {issue.intro && <p className="mt-2 text-white/80">{issue.intro}</p>}
      </header>
      <div className="space-y-6 rounded-b-xl bg-white p-6 shadow-sm">
        {issueBlocks(cards, banners).map((block, i) => {
          switch (block.kind) {
            case "lead":
              return <IssueCard key={block.item.key} card={block.item} lead />;
            case "heading":
              return <h2 key="heading" className="border-t-4 border-brand pt-4 text-sm font-bold uppercase tracking-widest">{STORY_SECTION_HEADING}</h2>;
            case "row":
              return (
                <div key={block.items[0].key} className={block.items.length === 2 ? "grid gap-6 sm:grid-cols-2" : ""}>
                  {block.items.map((card) => <IssueCard key={card.key} card={card} lead={block.items.length === 1} />)}
                </div>
              );
            case "ad": {
              if (block.ad.format === "sponsored_story") {
                return (
                  <div key={`ad-${block.ad.id}-${i}`} className="rounded bg-shade p-4">
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
                <div key={`ad-${block.ad.id}-${i}`}>
                  <p className="text-xs uppercase tracking-wide text-graphite">Sponsored</p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- advert artwork is shown at its own size, as in the email */}
                  <a href={`/visit/${block.ad.id}?src=newsletter`} className="mt-1 block"><img src={image} alt={block.ad.name ?? "Sponsored"} className="w-full rounded" /></a>
                </div>
              );
            }
          }
        })}
        {extras.events.length > 0 && (
          <section>
            <h2 className="border-t-4 border-brand pt-4 text-sm font-bold uppercase tracking-widest">{DIARY_HEADING}</h2>
            <ul className="mt-2 divide-y">
              {extras.events.map((event) => (
                <li key={event.slug} className="py-2">
                  <p className="text-xs font-bold uppercase text-graphite">{diaryDate(event.starts_on, event.ends_on)}</p>
                  <Link href={`/event/${event.slug}`} className="font-bold hover:underline">{event.title}</Link>
                  {event.location && <p className="text-sm text-graphite">{event.location}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {extras.directory.length > 0 && (
          <section>
            <h2 className="border-t-4 border-brand pt-4 text-sm font-bold uppercase tracking-widest">{DIRECTORY_HEADING}</h2>
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

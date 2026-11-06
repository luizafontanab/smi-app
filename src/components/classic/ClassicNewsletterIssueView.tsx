import Image from "next/image";
import Link from "next/link";
import { mediaUrl } from "@/lib/db/server";
import { focusStyle } from "@/lib/focus";
import { diaryDate, DIARY_HEADING, DIRECTORY_HEADING, issueBlocks, splitMastheadSponsor, STORY_SECTION_HEADING } from "@/lib/newsletter-layout";
import type { NewsletterIssueView } from "@/components/newsletter/NewsletterIssueView";

type Card = { key: string; href: string; title: string; summary: string | null; image: string | null; focus: unknown; kicker: string | null; cta: string };

/** "November 2026", from the send date the diary also keys on. */
function issueMonth(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Europe/London" });
}

function IssueCard({ card }: { card: Card }) {
  return (
    <Link href={card.href} data-part="newsletter-card">
      <div data-part="card-image">
        {card.image && <Image src={card.image} alt="" fill sizes="(max-width: 640px) 100vw, 300px" style={focusStyle(card.focus)} unoptimized />}
      </div>
      <div data-part="card-body">
        {card.kicker && <p data-part="card-meta">{card.kicker}</p>}
        <p data-part="card-title">{card.title}</p>
        {card.summary && <p data-part="card-excerpt">{card.summary}</p>}
        <p data-part="card-cta">{card.cta} ›</p>
      </div>
    </Link>
  );
}

/**
 * Classic's newsletter issue page body, the "Article shape" (hook point
 * `NewsletterIssueView` in src/components/design-option.ts; spec #68, #77):
 * a back link, then one narrow white panel with the issue line, an uppercase
 * title, the intro as a standfirst and the issue's items as a numbered list.
 *
 * Same props as Current's NewsletterIssueView, and the same reading of them:
 * the cards, the masthead sponsor and the advert placement all come from
 * lib/newsletter-layout, so the list follows the email's block order and a
 * sold advert position keeps its place. Stories and videos are numbered #1–#n;
 * adverts sit between them unnumbered, as Current draws them (decisions 6 Nov,
 * 4): a sponsored story stays a story under a "Sponsored" label, a banner stays
 * a banner. The email's "Sheeting Hot News" heading keeps its place after the
 * lead too, as an unnumbered entry.
 *
 * The events diary and the supplier directory are disc-headed sections, drawn
 * only when they have entries. Layout and colour live in the #77 section of
 * classic.css, which reaches this markup through its data-part labels.
 */
export function ClassicNewsletterIssueView({ issue, extras }: React.ComponentProps<typeof NewsletterIssueView>) {
  // A story or video withdrawn since the send is hidden by RLS and comes back null; it is skipped.
  const cards = issue.items.flatMap(({ story, video, position }): Card[] => {
    if (story) return [{ key: `s${position}`, href: `/news/${story.slug}`, title: story.title, summary: story.excerpt, image: mediaUrl(story.cover_path), focus: story.cover_focus, kicker: null, cta: "Read article" }];
    if (video) return [{ key: `v${position}`, href: `/video/${video.slug}`, title: video.title, summary: null, image: mediaUrl(video.thumbnail_path), focus: null, kicker: "Video", cta: "Watch video" }];
    return [];
  });
  const placed = issue.ads.flatMap((slot) => (slot.advert ? [{ ...slot.advert, after_item: slot.after_item }] : []));
  const { sponsor, banners } = splitMastheadSponsor(placed);
  const sponsorImage = sponsor ? mediaUrl(sponsor.desktop_path) ?? mediaUrl(sponsor.mobile_path) : null;
  const month = issueMonth(issue.scheduled_at ?? issue.sent_at);

  let number = 0;
  const entries = issueBlocks(cards, banners).flatMap((block, i) => {
    switch (block.kind) {
      case "heading":
        return [
          <li key="heading" data-part="newsletter-items-heading">
            <h2 data-part="section-title">{STORY_SECTION_HEADING}</h2>
          </li>,
        ];
      case "lead":
      case "row":
        return (block.kind === "lead" ? [block.item] : block.items).map((card) => {
          number++;
          return (
            <li key={card.key} data-part="newsletter-item">
              <span data-part="newsletter-item-number">#{number}</span>
              <IssueCard card={card} />
            </li>
          );
        });
      case "ad": {
        const ad = block.ad;
        const href = `/visit/${ad.id}?src=newsletter`;
        if (ad.format === "sponsored_story") {
          return [
            <li key={`ad-${ad.id}-${i}`} data-part="newsletter-sponsored-story">
              <IssueCard card={{ key: ad.id, href, title: ad.headline ?? ad.name ?? "", summary: ad.body, image: mediaUrl(ad.desktop_path) ?? mediaUrl(ad.mobile_path), focus: null, kicker: "Sponsored", cta: "Read more" }} />
            </li>,
          ];
        }
        const image = mediaUrl(ad.mobile_path) ?? mediaUrl(ad.desktop_path);
        if (!image) return [];
        return [
          <li key={`ad-${ad.id}-${i}`} data-part="newsletter-ad">
            <p data-part="ad-label">Sponsored</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- advert artwork is shown at its own size, as in the email */}
            <a href={href}><img src={image} alt={ad.name ?? "Sponsored"} /></a>
          </li>,
        ];
      }
    }
  });

  return (
    <div data-part="newsletter-issue">
      <Link href="/newsletters" data-part="back-link">‹ Back to Newsletters</Link>
      <article data-part="panel">
        <header data-part="page-head">
          <p data-part="newsletter-issue-line">
            SMI Monthly · Issue {issue.number}
            {month && ` · ${month}`}
          </p>
          <h1 data-part="page-title">{issue.subject}</h1>
          {sponsor && sponsorImage && (
            <p data-part="newsletter-sponsor">
              In association with
              {/* eslint-disable-next-line @next/next/no-img-element -- sponsor artwork comes in any aspect ratio */}
              <a href={`/visit/${sponsor.id}?src=newsletter`}><img src={sponsorImage} alt={sponsor.name ?? "Sponsor"} /></a>
            </p>
          )}
          {issue.intro && <p data-part="page-intro">{issue.intro}</p>}
        </header>

        <ol data-part="newsletter-items" aria-label="In this issue">{entries}</ol>

        {extras.events.length > 0 && (
          <section data-part="newsletter-diary">
            <h2 data-part="section-title"><span data-part="section-disc" aria-hidden="true">📅</span>{DIARY_HEADING}</h2>
            <ul>
              {extras.events.map((event) => (
                <li key={event.slug}>
                  <p data-part="card-meta">{diaryDate(event.starts_on, event.ends_on)}</p>
                  <Link href={`/event/${event.slug}`} data-part="card-title">{event.title}</Link>
                  {event.location && <p data-part="card-meta">{event.location}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {extras.directory.length > 0 && (
          <section data-part="newsletter-directory">
            <h2 data-part="section-title"><span data-part="section-disc" aria-hidden="true">👥</span>{DIRECTORY_HEADING}</h2>
            <ul>
              {extras.directory.map((member) => (
                <li key={member.slug}><Link href={`/member/${member.slug}`}>{member.name}</Link></li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </div>
  );
}

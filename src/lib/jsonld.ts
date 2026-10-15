import { siteUrl } from "./site-url";
import { websiteUrl } from "./website-url";

/**
 * schema.org structured-data builders. Every public content page is fully
 * server-rendered but was machine-typed nowhere — search engines and AI
 * crawlers had to infer what a page *is*. These builders are pure (unit-
 * testable) and rendered through components/JsonLd.tsx.
 *
 * Values that are missing are omitted, never emitted as null/undefined —
 * validators treat explicit nulls as errors.
 */

const SITE_NAME = "Sheet Metal Industries";

type Ld = Record<string, unknown>;

/** Drop undefined/null/empty-string values so the emitted JSON stays valid. */
function compact(obj: Ld): Ld {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
}

function abs(path: string): string {
  return path.startsWith("http") ? path : `${siteUrl()}${path}`;
}

export function organizationLd(): Ld {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: siteUrl(),
    description:
      "The voice of the UK sheet metal, fabrication and welding trade: industry news, member companies, machinery and events.",
  };
}

export function webSiteLd(): Ld {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: siteUrl(),
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${siteUrl()}/search?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

export function newsArticleLd(story: {
  slug: string;
  title: string;
  excerpt?: string | null;
  published_at?: string | null;
  coverUrl?: string | null;
  memberName?: string | null;
}): Ld {
  return compact({
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: story.title,
    description: story.excerpt ?? undefined,
    datePublished: story.published_at ?? undefined,
    image: story.coverUrl ? [story.coverUrl] : undefined,
    mainEntityOfPage: abs(`/news/${story.slug}`),
    author: story.memberName
      ? { "@type": "Organization", name: story.memberName }
      : { "@type": "Organization", name: SITE_NAME },
    publisher: { "@type": "Organization", name: SITE_NAME, url: siteUrl() },
  });
}

export function eventLd(event: {
  slug: string;
  title: string;
  description?: string | null;
  starts_on: string;
  starts_time?: string | null;
  ends_on?: string | null;
  location?: string | null;
  link?: string | null;
  coverUrl?: string | null;
  memberName?: string | null;
}): Ld {
  return compact({
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    // date-only when no time is on record — schema.org accepts both.
    startDate: event.starts_time ? `${event.starts_on}T${event.starts_time}` : event.starts_on,
    endDate: event.ends_on ?? undefined,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: event.location
      ? { "@type": "Place", name: event.location, address: event.location }
      : undefined,
    description: event.description ? stripTags(event.description) : undefined,
    image: event.coverUrl ? [event.coverUrl] : undefined,
    url: abs(`/event/${event.slug}`),
    organizer: event.memberName ? { "@type": "Organization", name: event.memberName } : undefined,
  });
}

export function localBusinessLd(member: {
  slug: string;
  name: string;
  description?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  phone?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  socialUrls?: string[];
  industryName?: string | null;
}): Ld {
  return compact({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: member.name,
    description: member.description ? stripTags(member.description) : undefined,
    address: member.address ?? undefined,
    geo:
      member.lat != null && member.lng != null
        ? { "@type": "GeoCoordinates", latitude: member.lat, longitude: member.lng }
        : undefined,
    telephone: member.phone ?? undefined,
    // The SMI profile is the canonical page we control; the member's own site
    // and socials are sameAs references.
    url: abs(`/member/${member.slug}`),
    // The website as a real absolute URL (lib/website-url): a stored
    // "www.foo.co.uk" is not one, and junk is left out rather than published.
    sameAs: [websiteUrl(member.website), ...(member.socialUrls ?? [])].filter(Boolean).length
      ? [websiteUrl(member.website), ...(member.socialUrls ?? [])].filter(Boolean)
      : undefined,
    image: member.logoUrl ?? undefined,
    knowsAbout: member.industryName ?? undefined,
  });
}

export function videoLd(video: {
  slug: string;
  title: string;
  description?: string | null;
  published_at?: string | null;
  youtubeId?: string | null;
  url: string;
}): Ld {
  return compact({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: video.title,
    description: video.description ? stripTags(video.description) : video.title,
    uploadDate: video.published_at ?? undefined,
    thumbnailUrl: video.youtubeId ? `https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg` : undefined,
    embedUrl: video.youtubeId ? `https://www.youtube-nocookie.com/embed/${video.youtubeId}` : undefined,
    contentUrl: video.url,
    mainEntityOfPage: abs(`/video/${video.slug}`),
  });
}

export function breadcrumbLd(items: { name: string; path: string }[]): Ld {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: abs(item.path),
    })),
  };
}

/** Rich-text fields hold sanitised HTML; JSON-LD descriptions want plain text. */
export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

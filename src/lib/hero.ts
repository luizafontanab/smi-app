import { mediaUrl } from "./db/server";
import { DEFAULT_FOCUS, parseFocus, type Focus } from "./focus";
import { storyImage } from "./story-image";
import type { StoryCard } from "./queries";
import { excerptFromHtml } from "./sanitize";
import { youtubeId } from "./youtube";

export { youtubeId };

/**
 * Home hero composition.
 *
 * The hero is a stage (one big image) plus a rail of five cards. Card 0 is
 * ALWAYS the headline story — pinned-wins-else-latest, decided upstream by
 * headlineStory() — and the stage loads on it. Cards 1-4 alternate stories and
 * videos so the rail reads as a mix rather than a news list with videos bolted on.
 *
 * Everything a card needs is resolved here, on the server: absolute image URLs,
 * formatted dates, hrefs. HomeHero is a client component and receives only this
 * flattened shape, so it never touches the DB, mediaUrl(), or toLocaleDateString
 * (which would risk a hydration mismatch on a locale-shifted browser).
 */

export type HeroVideo = {
  id: string;
  title: string;
  url: string;
  thumbnail_path: string | null;
  member: { slug: string; name: string } | null;
};

type HeroBase = {
  /** Stable React key. Prefixed because a story and a video can share an id space. */
  key: string;
  title: string;
  /** Absolute URL, already resolved. Null renders the gear-glyph fallback. */
  image: string | null;
  /** Crop box for the image, already parsed. Videos use the centred default. */
  focus: Focus;
  /**
   * The image is the member's logo standing in for a story cover
   * (lib/story-image). The stage lays text over its picture behind a scrim,
   * which a logo can't take, so the stage shows it whole in a white panel
   * beside the copy (wide screens); the rail card shows it whole on white.
   */
  logo: boolean;
  eyebrow: string;
  /** "12 August 2026 · Acme Fabrications" — formatted server-side. */
  meta: string | null;
};

export type HeroItem =
  | (HeroBase & { kind: "story"; href: string; intro: string | null })
  | (HeroBase & { kind: "video"; href: string });

export type HeroBuild = {
  items: HeroItem[];
  /** Server-only: what the hero consumed, so the sections below can skip it. */
  storyIds: Set<string>;
  videoIds: Set<string>;
  /** Hero stories with no usable excerpt — fetch bodies for just these. */
  needIntro: string[];
};

export const HERO_SIZE = 5;

/** How much of the opening the stage shows. Three lines at the stage's measure. */
const INTRO_MAX = 200;

/** Position 0 is forced to the headline; 1-4 follow this. */
const PATTERN = ["story", "story", "video", "story", "video"] as const;

function dateGB(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
}

function storyItem(story: StoryCard, eyebrow: string): HeroItem {
  const pic = storyImage(story);
  return {
    kind: "story",
    key: `s:${story.id}`,
    title: story.title,
    image: mediaUrl(pic?.path),
    focus: parseFocus(pic?.focus),
    logo: pic?.logo ?? false,
    eyebrow,
    meta: [dateGB(story.published_at), story.member?.name].filter(Boolean).join(" · ") || null,
    href: `/news/${story.slug}`,
    // The excerpt when there is one; withIntros() fills the rest from the body.
    intro: story.excerpt?.trim() || null,
  };
}

function videoItem(video: HeroVideo): HeroItem {
  // thumbnail_path is the same still scraped to our own storage at a higher
  // resolution (386 of 387 seeded rows have one). ytimg is the fallback for
  // rows that don't — including everything from the synthetic seed.
  const yt = youtubeId(video.url);
  return {
    kind: "video",
    key: `v:${video.id}`,
    title: video.title,
    image: mediaUrl(video.thumbnail_path) ?? (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null),
    focus: DEFAULT_FOCUS,
    logo: false,
    eyebrow: "Video",
    meta: video.member?.name ?? null,
    href: video.url,
  };
}

export function buildHero(
  headline: StoryCard | null,
  stories: StoryCard[],
  videos: HeroVideo[],
  size = HERO_SIZE,
): HeroBuild {
  const storyQ = stories.filter((s) => s.id !== headline?.id);
  const videoQ = [...videos];
  const items: HeroItem[] = [];
  const storyIds = new Set<string>();
  const videoIds = new Set<string>();

  const takeStory = () => {
    const s = storyQ.shift();
    if (!s) return false;
    storyIds.add(s.id);
    items.push(storyItem(s, s.is_member_news ? "Member news" : "News"));
    return true;
  };
  const takeVideo = () => {
    const v = videoQ.shift();
    if (!v) return false;
    videoIds.add(v.id);
    items.push(videoItem(v));
    return true;
  };

  if (headline) {
    storyIds.add(headline.id);
    items.push(storyItem(headline, "Latest"));
  }

  // Each slot falls back to the other kind, so a site with no videos (or no
  // stories beyond the headline) still fills the rail instead of showing gaps.
  for (let i = items.length; i < size; i++) {
    const wantVideo = (PATTERN[i] ?? "story") === "video";
    const ok = wantVideo ? takeVideo() || takeStory() : takeStory() || takeVideo();
    if (!ok) break;
  }

  const needIntro = items
    .filter((i): i is Extract<HeroItem, { kind: "story" }> => i.kind === "story" && !i.intro)
    .map((i) => i.key.slice(2));

  return { items, storyIds, videoIds, needIntro };
}

/**
 * Second pass: fill the intro of any hero story that had no excerpt from the
 * opening of its body. Split from buildHero because the bodies can only be
 * fetched once we know which stories the hero picked.
 */
export function withIntros(items: HeroItem[], bodies: Map<string, string | null>): HeroItem[] {
  if (bodies.size === 0) return items;
  return items.map((item) => {
    if (item.kind !== "story" || item.intro) return item;
    const body = bodies.get(item.key.slice(2));
    // excerptFromHtml strips tags, decodes the WordPress entities the imported
    // bodies carry, and cuts on a word boundary — same helper the list views use.
    return body ? { ...item, intro: excerptFromHtml(body, INTRO_MAX) } : item;
  });
}

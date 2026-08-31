import { describe, expect, it } from "vitest";
import { buildHero, withIntros, youtubeId, type HeroVideo } from "@/lib/hero";
import type { StoryCard } from "@/lib/queries";

/**
 * buildHero decides what the home hero shows AND what the bands below it must
 * skip. Its failure mode is silent and very visible in a demo: the same story
 * in the hero and again two rows down. The id-set property test below is the
 * one that actually guards that.
 */

const story = (id: string, over: Partial<StoryCard> = {}): StoryCard => ({
  id,
  slug: `story-${id}`,
  title: `Story ${id}`,
  excerpt: "excerpt",
  cover_path: `stories/${id}/cover.jpg`,
  cover_focus: null,
  published_at: "2026-08-12T09:00:00Z",
  is_member_news: false,
  member: { slug: "acme", name: "Acme Fabrications", logo_path: null },
  ...over,
});

const video = (id: string, over: Partial<HeroVideo> = {}): HeroVideo => ({
  id,
  title: `Video ${id}`,
  url: `https://www.youtube.com/watch?v=vid${id}`,
  thumbnail_path: null,
  member: { slug: "acme", name: "Acme Fabrications" },
  ...over,
});

const stories = (n: number) => Array.from({ length: n }, (_, i) => story(`s${i}`));
const videos = (n: number) => Array.from({ length: n }, (_, i) => video(`v${i}`));

describe("youtubeId", () => {
  it("pulls the id out of a watch URL", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=abc-1_2")).toBe("abc-1_2");
    expect(youtubeId("https://www.youtube.com/watch?list=x&v=abc123")).toBe("abc123");
  });

  it("returns null for anything else", () => {
    expect(youtubeId("https://vimeo.com/12345")).toBeNull();
    expect(youtubeId("https://youtu.be/abc123")).toBeNull(); // short links aren't seeded
  });
});

describe("buildHero", () => {
  it("puts the headline first even when it is not the newest story", () => {
    // the pinned case: headlineStory() returns a story that isn't stories[0]
    const pinned = story("pinned");
    const build = buildHero(pinned, stories(6), videos(3));

    expect(build.items[0].title).toBe("Story pinned");
    expect(build.items[0].eyebrow).toBe("Latest");
    expect(build.items[0].href).toBe("/news/story-pinned");
  });

  it("does not repeat the headline when it is also in the story list", () => {
    const headline = story("s0");
    const build = buildHero(headline, stories(6), videos(3));

    expect(build.items.filter((i) => i.title === "Story s0")).toHaveLength(1);
  });

  it("builds five items mixing three stories and two videos", () => {
    const build = buildHero(story("head"), stories(6), videos(3));

    expect(build.items).toHaveLength(5);
    expect(build.items.map((i) => i.kind)).toEqual(["story", "story", "video", "story", "video"]);
    expect(new Set(build.items.map((i) => i.key)).size).toBe(5);
  });

  /**
   * The load-bearing property: page.tsx filters `rest` and `railVideos` with
   * these sets, so anything the hero shows must be in them and nothing else.
   */
  it("reports exactly the ids it consumed", () => {
    const build = buildHero(story("head"), stories(6), videos(3));

    const fromItems = build.items.map((i) => i.key);
    const fromSets = [
      ...[...build.storyIds].map((id) => `s:${id}`),
      ...[...build.videoIds].map((id) => `v:${id}`),
    ];
    expect(fromItems.slice().sort()).toEqual(fromSets.slice().sort());
  });

  it("fills with stories when there are no videos", () => {
    const build = buildHero(story("head"), stories(6), []);

    expect(build.items).toHaveLength(5);
    expect(build.items.every((i) => i.kind === "story")).toBe(true);
    expect(build.videoIds.size).toBe(0);
  });

  it("fills with videos when there are no other stories", () => {
    const build = buildHero(story("head"), [], videos(6));

    expect(build.items).toHaveLength(5);
    expect(build.items[0].kind).toBe("story"); // the headline still leads
    expect(build.items.slice(1).every((i) => i.kind === "video")).toBe(true);
  });

  it("starts from the story list when there is no headline", () => {
    const build = buildHero(null, stories(6), videos(3));

    expect(build.items).toHaveLength(5);
    expect(build.items[0].title).toBe("Story s0");
    expect(build.items[0].eyebrow).toBe("News"); // no headline means no "Latest"
  });

  it("returns nothing rather than throwing on an empty site", () => {
    const build = buildHero(null, [], []);

    expect(build.items).toEqual([]);
    expect(build.storyIds.size).toBe(0);
    expect(build.videoIds.size).toBe(0);
  });

  it("returns fewer than five items when the site is nearly empty", () => {
    const build = buildHero(story("head"), [story("s1")], []);
    expect(build.items).toHaveLength(2);
  });

  it("labels member news and formats the meta line", () => {
    const build = buildHero(null, [story("s0", { is_member_news: true })], []);

    expect(build.items[0].eyebrow).toBe("Member news");
    expect(build.items[0].meta).toBe("12 August 2026 · Acme Fabrications");
  });

  it("falls back to the YouTube still when a video has no stored thumbnail", () => {
    const build = buildHero(null, [], [video("v0")]);
    expect(build.items[0].image).toBe("https://i.ytimg.com/vi/vidv0/hqdefault.jpg");
  });

  it("prefers the stored thumbnail over the YouTube still", () => {
    const build = buildHero(null, [], [video("v0", { thumbnail_path: "videos/clip.jpg" })]);
    expect(build.items[0].image).toContain("/storage/v1/object/public/media/videos/clip.jpg");
  });

  it("links videos out to YouTube and stories into the site", () => {
    const build = buildHero(story("head"), [], [video("v0")]);

    expect(build.items[0].href).toBe("/news/story-head");
    expect(build.items[1].href).toBe("https://www.youtube.com/watch?v=vidv0");
  });
});

/**
 * Only ~10% of published stories carry an excerpt, so the stage's opening lines
 * usually come from the body. buildHero reports which stories still need one so
 * page.tsx can fetch just those bodies rather than carrying them on every card.
 */
describe("story intros", () => {
  it("uses the excerpt directly and asks for no body", () => {
    const build = buildHero(story("head", { excerpt: "A real excerpt." }), [], []);

    expect(build.needIntro).toEqual([]);
    expect(build.items[0]).toMatchObject({ kind: "story", intro: "A real excerpt." });
  });

  it("asks for a body only for the stories that lack an excerpt", () => {
    const build = buildHero(
      story("head", { excerpt: "Has one." }),
      [story("s1", { excerpt: null }), story("s2", { excerpt: "   " })],
      [],
    );

    // whitespace-only counts as missing, and videos are never asked for
    expect(build.needIntro).toEqual(["s1", "s2"]);
  });

  it("fills a missing intro from the start of the body", () => {
    const build = buildHero(story("head", { excerpt: null }), [], []);
    const items = withIntros(build.items, new Map([["head", "<p>Two talented engineering scholars have moved to the shop floor.</p>"]]));

    expect(items[0]).toMatchObject({ intro: "Two talented engineering scholars have moved to the shop floor." });
  });

  it("takes the standfirst when a body opens with a heading rather than a paragraph", () => {
    // real imported bodies do this — "first <p>" would skip the opening line
    const build = buildHero(story("head", { excerpt: null }), [], []);
    const items = withIntros(build.items, new Map([["head", '<h2 class="wp-block-heading"><strong>Hydram are excited to share news.</strong></h2>\n\n<p>The company have welcomed…</p>']]));

    expect((items[0] as { intro: string }).intro).toMatch(/^Hydram are excited to share news\./);
  });

  it("truncates on a word boundary and decodes the entities imported bodies carry", () => {
    const long = `<p>${"Sheet metal fabrication news from across the United Kingdom. ".repeat(8)}</p>`;
    const build = buildHero(story("head", { excerpt: null }), [], []);
    const items = withIntros(build.items, new Map([["head", long]]));
    const intro = (items[0] as { intro: string }).intro;

    expect(intro.length).toBeLessThanOrEqual(201); // 200 + the ellipsis
    expect(intro.endsWith("…")).toBe(true);
    expect(intro).not.toMatch(/\s…$/); // no dangling space before the ellipsis

    const amp = withIntros(buildHero(story("h2", { excerpt: null }), [], []).items, new Map([["h2", "<p>Steel &amp; sons &#8217;24</p>"]]));
    expect((amp[0] as { intro: string }).intro).toBe("Steel & sons ’24");
  });

  it("leaves the intro null when the story has neither excerpt nor body", () => {
    const build = buildHero(story("head", { excerpt: null }), [], []);

    expect(withIntros(build.items, new Map([["head", null]]))[0]).toMatchObject({ intro: null });
    expect(withIntros(build.items, new Map())[0]).toMatchObject({ intro: null });
  });

  it("never touches video items", () => {
    const build = buildHero(null, [], [video("v0")]);
    expect(withIntros(build.items, new Map([["v0", "<p>ignored</p>"]]))[0]).not.toHaveProperty("intro");
  });
});

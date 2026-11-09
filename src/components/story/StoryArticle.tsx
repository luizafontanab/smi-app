import Image from "next/image";
import Link from "next/link";
import { MemberBadge } from "@/components/MemberBadge";
import { MemberTiles } from "@/components/MemberTiles";
import { focusStyle } from "@/lib/focus";

/**
 * The published story's own markup, in pieces, shared by everything that has
 * to look like it: the public page (/news/[slug]), the draft preview route
 * (/preview/story/[id]), the console's inline "Member preview" card and the
 * member's Preview tab. Jas 13/10 items 10/15: the previews used to be
 * separate, simplified renders that drifted from the real page; now there is
 * one rendering of a story and the previews use it.
 *
 * Client-safe on purpose — no db client, no sanitiser. Callers pass resolved
 * URLs and an already-rendered body node: server callers hand in <StoryBody>
 * (which sanitises), the member's client preview hands in server-sanitised HTML.
 */

export type StoryArticleStory = {
  title: string;
  published_at: string | null;
  is_member_news: boolean | null;
  cover_focus: unknown;
};

export type StoryArticleMember = { name: string; slug: string; logoUrl: string | null };

export function StoryHeader({ story, categories }: { story: StoryArticleStory; categories: { slug: string; name: string }[] }) {
  return (
    <header data-part="story-header" className="mt-4">
      <div data-part="story-categories" className="flex flex-wrap items-center gap-1.5 text-xs">
        {story.is_member_news && <MemberBadge variant="inline" />}
        {categories.map((c) => (
          <Link key={c.slug} href={`/news?category=${c.slug}`} data-part="story-category" className="rounded-full bg-graphite/10 px-3 py-1 text-graphite hover:bg-graphite/20">{c.name}</Link>
        ))}
      </div>
      {/* Jas 13/10: one standard heading, always in capitals. CSS only, so the
          stored title keeps its case for search, link previews and newsletters. */}
      <h1 data-part="page-title" className="mt-3 text-3xl font-bold uppercase leading-tight tracking-[0.04em] text-ink">{story.title}</h1>
      <p data-part="story-meta" className="mt-2 text-sm text-graphite">
        Sheet Metal Industries
        {story.published_at && ` · ${new Date(story.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" })}`}
      </p>
    </header>
  );
}

export function StoryHero({ cover, focus, logo = false }: {
  cover: string | null;
  focus: unknown;
  /** `cover` is the member's logo standing in (lib/story-image): drawn whole, on white, in a shorter box. */
  logo?: boolean;
}) {
  if (!cover) return null;
  if (logo)
    return (
      <div data-testid="story-cover" data-part="story-cover" data-logo="" className="relative mt-4 h-40 overflow-hidden rounded-lg border border-line bg-white sm:h-48">
        <Image src={cover} alt="" fill sizes="(min-width: 1024px) 50vw, 100vw" className="object-contain p-6 sm:p-8" preload unoptimized />
      </div>
    );
  return (
    // Shorter below md: a 384px cover on a 390px-wide phone was taller than it
    // was wide and pushed the article off the first screen (#33 C1).
    <div data-testid="story-cover" data-part="story-cover" className="relative mt-4 h-60 overflow-hidden rounded-lg sm:h-80 md:h-96">
      {cover.startsWith("blob:") ? (
        // A cover the member has picked but not yet uploaded (the Preview tab):
        // a local object URL, which next/image has no business handling.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" style={focusStyle(focus)} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <Image src={cover} alt="" fill sizes="100vw" style={focusStyle(focus)} className="object-cover" preload unoptimized />
      )}
    </div>
  );
}

/**
 * The article and its member box. `share` is a node so the caller decides what
 * follows the body (SMI's social links). `members` are already gated by
 * isMemberLinkable upstream, primary first — this never decides who is linkable.
 *
 * `layout="page"` (the story page and the full preview, Jas 13/10 item 13: "it
 * looks very narrow on desktop"): from lg the article and a 300px sidebar of
 * member tiles sit side by side, so the page fills the screen without
 * stretching the text into unreadably long lines. The tiles come after the
 * article in the DOM, so on smaller screens they simply follow it. The sidebar
 * only sticks while it's short enough to fit a screen — a tall sticky column
 * can never be scrolled to its end. No members, no sidebar.
 *
 * `layout="inline"` (editor previews): one column, tiles under the body.
 */
export function StoryMain({ body, share, members, layout = "page" }: {
  body: React.ReactNode;
  share?: React.ReactNode;
  members: StoryArticleMember[];
  layout?: "page" | "inline";
}) {
  const article = (
    <article data-part="story-article" className="story-read">
      {body}
      {share}
    </article>
  );
  if (layout === "inline") {
    return (
      <>
        {article}
        {members.length > 0 && <div data-part="story-aside" className="mt-8"><MemberTiles members={members} layout="inline" /></div>}
      </>
    );
  }
  if (members.length === 0) return <div data-part="story-layout" className="story-layout">{article}</div>;
  return (
    <div data-part="story-layout" className="story-layout story-layout--aside lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
      {article}
      <div data-part="story-aside" className="mt-8 lg:mt-6">
        <div className={members.length <= 4 ? "lg:sticky lg:top-4" : undefined}>
          <MemberTiles members={members} layout="sidebar" />
        </div>
      </div>
    </div>
  );
}

/**
 * The three anchors BlockRenderer expects for a story layout, so the public
 * page and the preview route place them identically within the admin's layout.
 */
export function storyAnchors(parts: {
  story: StoryArticleStory;
  categories: { slug: string; name: string }[];
  cover: string | null;
  /** The cover is the member's logo standing in (lib/story-image). */
  coverIsLogo?: boolean;
  main: React.ReactNode;
}): Record<"story_header" | "story_hero" | "story_body", React.ReactNode> {
  return {
    story_header: <StoryHeader story={parts.story} categories={parts.categories} />,
    story_hero: <StoryHero cover={parts.cover} focus={parts.story.cover_focus} logo={parts.coverIsLogo} />,
    story_body: parts.main,
  };
}

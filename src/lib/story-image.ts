import type { CSSProperties } from "react";
import { focusStyle } from "./focus";
import { isMemberLinkable } from "./member-visibility";

/**
 * Which picture a story shows, everywhere one is shown: cards, the home hero,
 * the story page, the newsletter, social posts and link previews (Jas 28/10,
 * open items #6).
 *
 *   1. The member's logo, when an admin ticked "use the member's logo" (a poor
 *      photo) and the member has one.
 *   2. Otherwise the cover.
 *   3. No cover: the member's logo, as a last resort. Any story with a member
 *      gets it, SMI's own stories about a member included (Luiza 9 Nov).
 *   4. Neither: null, and each place keeps its own empty state.
 *
 * `member` is the story's own member (stories.member_id), not every member it
 * features. Its logo is used only when isMemberLinkable passes: a serviceDb
 * read (the newsletter email, previews, the console) gets archived and lapsed
 * members back, where a publicDb read has them nulled by RLS — so callers
 * reading through serviceDb must select `status` and `archived_at` with the
 * member, or an archived member's logo goes out.
 *
 * Paths, not URLs, so this stays free of the server-only db client; callers
 * pass `path` through mediaUrl.
 *
 * A logo isn't 16:9 artwork, so callers draw it contained on white
 * (storyImageFit) rather than cropped to fill the box. The cover's crop box
 * doesn't apply to it, hence focus null.
 */
export type StoryImageSource = {
  cover_path: string | null;
  cover_focus?: unknown;
  cover_use_logo?: boolean | null;
  member?: { logo_path?: string | null; status?: string | null; archived_at?: string | null } | null;
};

export type StoryImage = { path: string; focus: unknown; logo: boolean };

export function storyImage(story: StoryImageSource): StoryImage | null {
  const logoPath = isMemberLinkable(story.member) ? story.member.logo_path || null : null;
  if (story.cover_use_logo && logoPath) return { path: logoPath, focus: null, logo: true };
  if (story.cover_path) return { path: story.cover_path, focus: story.cover_focus ?? null, logo: false };
  if (logoPath) return { path: logoPath, focus: null, logo: true };
  return null;
}

/** Classes for a logo standing in for a cover inside a fill box: whole, centred, padded. */
export const LOGO_FIT = "object-contain p-[12%]";
/** The box behind it: white, so a logo drawn for a light background reads. */
export const LOGO_BOX = "bg-white";

/**
 * How a fill box draws a story picture: `box` for the wrapper's background,
 * `img` and `style` for the <Image>. A logo sits whole on white; a cover is
 * cropped to fill, at the admin's crop focus.
 *
 * `logoFit` overrides the logo padding where 12% of the width doesn't suit the
 * box (a short, wide one). `coverBox` is the wrapper's background behind a
 * cover or an empty state.
 */
export function storyImageFit(
  pic: Pick<StoryImage, "focus" | "logo"> | null | undefined,
  opts: { logoFit?: string; coverBox?: string } = {},
): { box: string; img: string; style: CSSProperties | undefined } {
  if (pic?.logo) return { box: LOGO_BOX, img: opts.logoFit ?? LOGO_FIT, style: undefined };
  return { box: opts.coverBox ?? "bg-graphite/10", img: "object-cover", style: focusStyle(pic?.focus) };
}

import { youtubeId } from "./youtube";

export type MemberVideo = { id: string; title: string; href: string | null };

/**
 * What a member page's video section plays (GAPS A8.5): the company video the
 * member set on their page first, then their published SMI videos, newest
 * first. De-duplicated by YouTube id — a member who submitted their company
 * video as a story video too must not see it twice — and anything that isn't a
 * readable YouTube link drops out rather than rendering an empty player.
 */
export function memberVideoList(
  companyVideoUrl: string | null | undefined,
  videos: readonly { slug: string; title: string; url: string }[],
): MemberVideo[] {
  const out: MemberVideo[] = [];
  const seen = new Set<string>();
  const add = (url: string | null | undefined, title: string, href: string | null) => {
    const id = url ? youtubeId(url) : null;
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, title, href });
  };
  add(companyVideoUrl, "Company video", null);
  for (const v of videos) add(v.url, v.title, `/video/${v.slug}`);
  return out;
}

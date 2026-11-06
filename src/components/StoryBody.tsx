import { Fragment } from "react";
import { withCompanyLines, type CompanyLink } from "@/lib/company-link";
import { sanitizeRichText } from "@/lib/sanitize";

/**
 * An article body the author split with advert breaks, rendered as
 * segment / break / segment. Segments arrive pre-split (splitAtAdBreaks) so the
 * page can derive its slot keys from the same result rather than splitting twice.
 *
 * Each segment is sanitised once more — not belt-and-braces, it repairs the split:
 * a marker inside a blockquote leaves one segment with an unclosed tag and the
 * next with an orphan closer, and sanitize-html closes and drops them respectively.
 *
 * It must be sanitizeRichText and NOT RichText/renderableHtml: those still
 * paragraph-wrap a segment with no recognisable tag anywhere in it (a bare
 * orphan text node, left behind where the sanitiser stripped a <figure> or
 * <h4>), which changes its structure — sanitizeRichText leaves it exactly as
 * the split produced it.
 *
 * Each segment gets its own .story-body wrapper so the breaks sit outside it —
 * otherwise `.story-body img` would restyle the advert artwork.
 */
export function StoryBody({ segments: given, breaks, className, companyLinks = [] }: {
  segments: string[];
  /** One node per gap; a gap with no node collapses (nothing booked, no placeholder). */
  breaks: React.ReactNode[];
  className?: string;
  /** Each featured member's name + website link, closing the story (lib/company-link). */
  companyLinks?: readonly CompanyLink[];
}) {
  // an empty body still closes with the members' lines
  const segments = given.length || !companyLinks.length ? given : [""];
  return (
    <>
      {segments.map((segment, i) => (
        <Fragment key={i}>
          <div
            data-part="story-body"
            className={`story-body ${i === 0 ? className ?? "" : ""}`.trim()}
            // the closing company line (lib/company-link) — styled apart, and
            // added for each featured member the author's own line doesn't already cover. Only the
            // last segment can hold it.
            dangerouslySetInnerHTML={{
              __html: i === segments.length - 1 ? withCompanyLines(sanitizeRichText(segment), companyLinks) : sanitizeRichText(segment),
            }}
          />
          {i < segments.length - 1 && breaks[i]}
        </Fragment>
      ))}
    </>
  );
}

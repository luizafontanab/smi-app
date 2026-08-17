import { Fragment } from "react";
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
 * It must be sanitizeRichText and NOT RichText/renderableHtml: those paragraph-wrap
 * anything not starting with "<", which HTML-ESCAPES it. A segment can legitimately
 * open on a bare text node (imported bodies are full of them, left behind where the
 * sanitiser stripped a <figure> or <h4>), and that would publish visible markup.
 *
 * Each segment gets its own .story-body wrapper so the breaks sit outside it —
 * otherwise `.story-body img` would restyle the advert artwork.
 */
export function StoryBody({ segments, breaks, className }: {
  segments: string[];
  /** One node per gap; a gap with no node collapses (nothing booked, no placeholder). */
  breaks: React.ReactNode[];
  className?: string;
}) {
  return (
    <>
      {segments.map((segment, i) => (
        <Fragment key={i}>
          <div
            className={`story-body ${i === 0 ? className ?? "" : ""}`.trim()}
            dangerouslySetInnerHTML={{ __html: sanitizeRichText(segment) }}
          />
          {i < segments.length - 1 && breaks[i]}
        </Fragment>
      ))}
    </>
  );
}

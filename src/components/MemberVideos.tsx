"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { MemberVideo } from "@/lib/member-videos";

/**
 * A member page's videos (GAPS A8.5): one player, and a row of thumbnails to
 * choose what it plays.
 *
 * Deliberately not an auto-advancing carousel. Rotating embedded players would
 * pull the video out from under someone about to press play, and WCAG 2.2.2
 * would need a pause control on top. Changing video is always the reader's
 * choice, with the thumbnails or the previous/next buttons.
 *
 * Only the selected video loads a player, so ten videos cost one iframe, not
 * ten. The picker is titles rather than thumbnails: a member's video titles
 * say what each one is, and a row of near-identical machine-shop stills
 * wouldn't. (i.ytimg.com is allowed by the CSP since 28 Sep, so thumbnails
 * are an option if that changes.)
 */
export function MemberVideos({ videos }: { videos: MemberVideo[] }) {
  const [index, setIndex] = useState(0);
  const current = videos[index];
  if (!current) return null;
  const many = videos.length > 1;
  const go = (next: number) => setIndex((next + videos.length) % videos.length);

  return (
    <section data-part="member-videos" className="mt-10" aria-labelledby="member-videos">
      <h2 data-part="section-title" id="member-videos" className="mb-3 text-lg font-bold uppercase tracking-wide text-ink">
        {many ? "Videos" : current.title}
      </h2>
      <div data-part="panel" className="overflow-hidden rounded-xl bg-white shadow-sm">
        {/* The video's own still sits under the player (#33): until YouTube
            paints — or if it never does, on a slow or blocked connection —
            the box shows the video rather than a blank white rectangle. */}
        <div data-part="video-embed" className="relative aspect-video w-full bg-ink">
          <Image src={`https://i.ytimg.com/vi/${current.id}/hqdefault.jpg`} alt="" fill sizes="(max-width: 1152px) 100vw, 1152px" className="object-cover" unoptimized />
          <iframe
            key={current.id}
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${current.id}`}
            title={current.title}
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
        {many && (
          <div data-part="member-videos-nav" className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <button data-part="pagination-link" type="button" onClick={() => go(index - 1)} className="tap rounded border border-line px-3 py-1 hover:bg-graphite/10" aria-label="Previous video">←</button>
            <p className="min-w-0 truncate text-ink" aria-live="polite">
              {current.href ? <Link href={current.href} className="underline">{current.title}</Link> : current.title}
              <span className="text-graphite"> · {index + 1} of {videos.length}</span>
            </p>
            <button data-part="pagination-link" type="button" onClick={() => go(index + 1)} className="tap rounded border border-line px-3 py-1 hover:bg-graphite/10" aria-label="Next video">→</button>
          </div>
        )}
      </div>
      {many && (
        <ul data-part="filter-pills" className="mt-3 flex flex-wrap gap-2" aria-label="Choose a video">
          {videos.map((v, i) => (
            <li key={v.id}>
              <button data-part="filter-pill"
                type="button"
                onClick={() => setIndex(i)}
                aria-pressed={i === index}
                className={`max-w-xs truncate rounded-full border px-3 py-1 text-left text-sm ${i === index ? "border-ink bg-ink text-white" : "bg-white text-ink hover:border-ink"}`}
              >
                {/* not colour alone (WCAG 1.4.1): the playing one says so */}
                {i === index && <span className="font-semibold">Playing: </span>}
                {v.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

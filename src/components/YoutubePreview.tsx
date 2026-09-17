"use client";

import { useState } from "react";
import { RequiredMark } from "@/components/RequiredMark";
import { youtubeId } from "@/lib/youtube";

/**
 * URL input with a live embed preview, shared by the console video editor and
 * the member "Add a video" form. youtubeId() only matches `?v=` URLs (same
 * limitation the public /video pages already have) — a non-matching URL still
 * submits fine, it just shows the fallback note instead of an embed.
 */
export function YoutubePreview({ name, defaultValue = "" }: { name: string; defaultValue?: string }) {
  const [url, setUrl] = useState(defaultValue);
  const yt = youtubeId(url);
  return (
    <div>
      <label htmlFor={name} className="text-sm font-medium">YouTube URL<RequiredMark /></label>
      <input
        id={name}
        name={name}
        type="url"
        required
        defaultValue={defaultValue}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://www.youtube.com/watch?v=..."
        className="mt-1 w-full rounded border px-3 py-2"
      />
      {url && (
        yt ? (
          <div className="mt-2 aspect-video w-full max-w-sm overflow-hidden rounded-lg bg-ink">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${yt}`}
              title="Preview"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
              className="h-full w-full"
            />
          </div>
        ) : (
          <p className="mt-1 text-xs text-danger">
            Doesn&apos;t look like a YouTube watch URL — it&apos;ll save, but won&apos;t embed or get a thumbnail fallback.
          </p>
        )
      )}
    </div>
  );
}

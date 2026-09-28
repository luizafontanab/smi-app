"use client";

import { useState } from "react";
import { RequiredMark } from "@/components/RequiredMark";
import { youtubeId } from "@/lib/youtube";

/**
 * URL input with a live embed preview, shared by the console video editor and
 * the member "Add a video" form. A link youtubeId() can't read gets a warning
 * here and is refused by the save action — SMI takes YouTube links only
 * (USE-CASES gap 23). The warning is advance notice, not the enforcement.
 */
export function YoutubePreview({
  name,
  defaultValue = "",
  required = true,
  label = "YouTube URL",
}: {
  name: string;
  defaultValue?: string;
  /** False for an optional video (a Featured Machine's); a blank field is then fine. */
  required?: boolean;
  label?: string;
}) {
  const [url, setUrl] = useState(defaultValue);
  const yt = youtubeId(url);
  return (
    <div>
      <label htmlFor={name} className="text-sm font-medium">
        {label}
        {required ? <RequiredMark /> : <span className="font-normal text-graphite"> (optional)</span>}
      </label>
      <input
        id={name}
        name={name}
        type="url"
        required={required}
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
            Doesn&apos;t look like a YouTube link — only YouTube videos can be added, so this won&apos;t save.
          </p>
        )
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { MemberBacklink } from "@/components/MemberBacklink";
import { RichTextEditor } from "@/components/RichTextEditor";
import { YoutubePreview } from "@/components/YoutubePreview";
import { youtubeId } from "@/lib/youtube";

type Props = {
  action: (formData: FormData) => Promise<void>;
  uploadImage: (formData: FormData) => Promise<string | null>;
  member: { name: string; slug: string; logoUrl: string | null };
};

/**
 * Member video form with a true preview: embed + description + backlink shown
 * exactly as it will publish — same pattern as StoryForm.
 */
export function VideoForm({ action, uploadImage, member }: Props) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [title, setTitle] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  return (
    <form action={action} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
      <div className="flex gap-1 border-b pb-3 text-sm">
        <button type="button" onClick={() => setTab("write")} className={`rounded px-3 py-1.5 ${tab === "write" ? "bg-ink text-white" : "bg-gray-100"}`}>Write</button>
        <button type="button" onClick={() => setTab("preview")} className={`rounded px-3 py-1.5 ${tab === "preview" ? "bg-ink text-white" : "bg-gray-100"}`}>Preview</button>
      </div>

      {/* Both tabs stay mounted — hidden/plain inputs must remain in the form. */}
      <div className={tab === "write" ? "space-y-4" : "hidden"}>
        <div>
          <label htmlFor="title" className="text-sm font-medium">Title</label>
          <input id="title" name="title" required value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <YoutubePreview name="url" />
        <div>
          <span className="block text-sm font-medium">Description</span>
          <RichTextEditor name="description" ariaLabel="Description" uploadImage={uploadImage} minHeightClass="min-h-32" />
        </div>
        <div>
          <label htmlFor="thumbnail" className="text-sm font-medium">Thumbnail</label>
          <input id="thumbnail"
            type="file"
            name="thumbnail"
            accept="image/jpeg,image/png,image/webp"
            className="mt-1 w-full text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setThumbnailUrl((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return f ? URL.createObjectURL(f) : null;
              });
            }}
          />
          <p className="mt-1 text-xs text-gray-400">
            Falls back to the YouTube thumbnail if left blank. Landscape works best, JPG/PNG/WebP, max 8MB.
          </p>
        </div>
      </div>

      {tab === "preview" && <VideoPreview title={title} thumbnailUrl={thumbnailUrl} member={member} />}

      <button className="rounded bg-ink px-5 py-2.5 text-white">Submit for approval</button>
    </form>
  );
}

function VideoPreview({ title, thumbnailUrl, member }: { title: string; thumbnailUrl: string | null; member: Props["member"] }) {
  // Reads the sibling inputs the write tab keeps updated; preview only ever
  // shows the author their own markup, and the server sanitises on submit.
  const url = typeof document !== "undefined"
    ? (document.querySelector('input[name="url"]') as HTMLInputElement | null)?.value ?? ""
    : "";
  const description = typeof document !== "undefined"
    ? (document.querySelector('input[name="description"]') as HTMLInputElement | null)?.value ?? ""
    : "";
  const yt = youtubeId(url);
  return (
    <div data-testid="video-preview" className="rounded-lg border bg-paper p-5">
      <p className="text-xs uppercase tracking-widest text-gray-400">Preview — how your video will appear</p>
      <div className="mt-4 aspect-video w-full overflow-hidden rounded-lg bg-ink">
        {yt ? (
          <iframe src={`https://www.youtube-nocookie.com/embed/${yt}`} title={title} className="h-full w-full" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" />
        ) : thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>
      <h1 className="mt-4 text-3xl font-bold leading-tight text-ink">{title || "Untitled video"}</h1>
      <div className="story-body mt-4" dangerouslySetInnerHTML={{ __html: description }} />
      <MemberBacklink name={member.name} slug={member.slug} logoUrl={member.logoUrl} />
    </div>
  );
}

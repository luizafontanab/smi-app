"use client";

import { useState } from "react";
import { MemberBacklink } from "@/components/MemberBacklink";
import { RequiredMark } from "@/components/RequiredMark";
import { RichTextEditor } from "@/components/RichTextEditor";
import { YoutubePreview } from "@/components/YoutubePreview";
import { youtubeId } from "@/lib/youtube";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";

type Props = {
  action: (formData: FormData) => Promise<void>;
  uploadImage: (formData: FormData) => Promise<string | null>;
  member: { name: string; slug: string; logoUrl: string | null };
  /** Present only in edit mode — pre-fills the form and switches the copy/actions. */
  initial?: { id: string; title: string; url: string; description: string; thumbnailUrl: string | null };
  withdrawAction?: (formData: FormData) => Promise<void>;
};

/**
 * Member video form with a true preview: embed + description + backlink shown
 * exactly as it will publish — same pattern as StoryForm. Doubles as the edit
 * form for a pending/rejected submission when `initial` is given.
 */
export function VideoForm({ action, uploadImage, member, initial, withdrawAction }: Props) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(initial?.thumbnailUrl ?? null);

  return (
    <form action={action} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
      <UnsavedChangesGuard />
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div role="tablist" aria-label="Editor view" className="flex gap-1 border-b pb-3 text-sm">
        <button type="button" role="tab" id="write-tab" aria-selected={tab === "write"} aria-controls="write-panel" onClick={() => setTab("write")} className={`rounded px-3 py-1.5 ${tab === "write" ? "bg-ink font-semibold text-white" : "bg-shade"}`}>Write</button>
        <button type="button" role="tab" id="preview-tab" aria-selected={tab === "preview"} aria-controls="preview-panel" onClick={() => setTab("preview")} className={`rounded px-3 py-1.5 ${tab === "preview" ? "bg-ink font-semibold text-white" : "bg-shade"}`}>Preview</button>
      </div>

      {/* Both tabs stay mounted — hidden/plain inputs must remain in the form. */}
      <div id="write-panel" role="tabpanel" aria-labelledby="write-tab" className={tab === "write" ? "space-y-4" : "hidden"}>
        <div>
          <label htmlFor="title" className="text-sm font-medium">Title<RequiredMark /></label>
          <input id="title" name="title" required value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <YoutubePreview name="url" defaultValue={initial?.url} />
        <div>
          <span className="block text-sm font-medium">Description</span>
          <RichTextEditor name="description" ariaLabel="Description" uploadImage={uploadImage} minHeightClass="min-h-32" initialHtml={initial?.description} />
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
          <p className="mt-1 text-xs text-graphite">
            Falls back to the YouTube thumbnail if left blank. Landscape works best, JPG/PNG/WebP, max 8MB.
          </p>
        </div>
      </div>

      {tab === "preview" && (
        <div id="preview-panel" role="tabpanel" aria-labelledby="preview-tab">
          <VideoPreview title={title} thumbnailUrl={thumbnailUrl} member={member} />
        </div>
      )}

      <div className="flex items-center gap-3">
        <button className="rounded bg-ink px-5 py-2.5 text-white">{initial ? "Save & resubmit" : "Submit for approval"}</button>
        {initial && withdrawAction && (
          <button type="submit" formAction={withdrawAction} className="text-sm text-graphite underline hover:text-danger">
            Withdraw
          </button>
        )}
      </div>
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
      <p className="text-xs uppercase tracking-widest text-graphite">Preview — how your video will appear</p>
      <div className="mt-4 aspect-video w-full overflow-hidden rounded-lg bg-ink">
        {yt ? (
          <iframe src={`https://www.youtube-nocookie.com/embed/${yt}`} title={title} className="h-full w-full" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" />
        ) : thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>
      {/* Visual preview, not document structure — the page already has its h1. */}
      <p className="mt-4 text-3xl font-bold leading-tight text-ink">{title || "Untitled video"}</p>
      <div className="story-body mt-4" dangerouslySetInnerHTML={{ __html: description }} />
      <MemberBacklink name={member.name} slug={member.slug} logoUrl={member.logoUrl} />
    </div>
  );
}

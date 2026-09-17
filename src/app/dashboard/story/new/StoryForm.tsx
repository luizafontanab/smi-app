"use client";

import { useState } from "react";
import { CoverField } from "@/components/CoverField";
import { MemberBacklink } from "@/components/MemberBacklink";
import { RequiredMark } from "@/components/RequiredMark";
import { RichTextEditor } from "@/components/RichTextEditor";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";

type Props = {
  action: (formData: FormData) => Promise<void>;
  uploadImage: (formData: FormData) => Promise<string | null>;
  categories: { id: number; name: string }[];
  industries: { id: number; name: string }[];
  member: { name: string; slug: string; logoUrl: string | null };
  /** Present only in edit mode — pre-fills the form and switches the copy/actions. */
  initial?: { id: string; title: string; excerpt: string; body: string; coverUrl: string | null; categoryId: number | null; industryId: number | null };
  withdrawAction?: (formData: FormData) => Promise<void>;
  /** The member's own industry — the fallback whenever the story has none of its
   *  own, on a new submission and on editing one that pre-dates the field. */
  defaultIndustryId?: number | null;
};

/**
 * Member story form with a true preview: body + backlink + logo shown exactly
 * as they will publish (req §7 — branding used to appear only after publish).
 * Doubles as the edit form for a pending/rejected submission when `initial`
 * is given — same fields, pre-filled, posting to a resubmit action instead.
 */
export function StoryForm({ action, uploadImage, categories, industries, member, initial, withdrawAction, defaultIndustryId }: Props) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [coverUrl, setCoverUrl] = useState<string | null>(initial?.coverUrl ?? null);

  return (
    <form action={action} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
      <UnsavedChangesGuard />
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div role="tablist" aria-label="Editor view" className="flex gap-1 border-b pb-3 text-sm">
        <button type="button" role="tab" id="write-tab" aria-selected={tab === "write"} aria-controls="write-panel" onClick={() => setTab("write")} className={`rounded px-3 py-1.5 ${tab === "write" ? "bg-ink font-semibold text-white" : "bg-shade"}`}>Write</button>
        <button type="button" role="tab" id="preview-tab" aria-selected={tab === "preview"} aria-controls="preview-panel" onClick={() => setTab("preview")} className={`rounded px-3 py-1.5 ${tab === "preview" ? "bg-ink font-semibold text-white" : "bg-shade"}`}>Preview</button>
      </div>

      {/* Both tabs stay mounted — hidden inputs must remain in the form. */}
      <div id="write-panel" role="tabpanel" aria-labelledby="write-tab" className={tab === "write" ? "space-y-4" : "hidden"}>
        <div>
          <label htmlFor="title" className="text-sm font-medium">Title<RequiredMark /></label>
          <input id="title" name="title" required value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label htmlFor="excerpt" className="text-sm font-medium">Summary (1–2 sentences)</label>
          <textarea id="excerpt" name="excerpt" rows={2} defaultValue={initial?.excerpt} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <span className="block text-sm font-medium">Story</span>
          <RichTextEditor name="body" ariaLabel="Story" uploadImage={uploadImage} initialHtml={initial?.body} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="category" className="text-sm font-medium">Category</label>
            <select id="category" name="category" defaultValue={initial?.categoryId ?? ""} className="mt-1 w-full rounded border px-3 py-2">
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            {/* Defaults to the member's own industry on a new story, which is
                what migration 20260909000002 backfilled for existing rows. On
                an edit the saved value wins outright, including when it is
                none — otherwise a resubmit would silently undo a deliberate
                "— none —". Separate from Category above: that is the
                news-topic list. */}
            <label htmlFor="industry_id" className="text-sm font-medium">Industry</label>
            <select id="industry_id" name="industry_id" defaultValue={initial ? initial.industryId ?? "" : defaultIndustryId ?? ""} className="mt-1 w-full rounded border px-3 py-2">
              <option value="">— none —</option>
              {industries.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-graphite">Helps buyers find your story on the matching industry page.</p>
          </div>
        </div>
        {/* Full width, not a grid column: the crop picker is a fixed 320px box. */}
        <CoverField cover={initial?.coverUrl} required onPreview={setCoverUrl} />
      </div>

      {tab === "preview" && (
        <div id="preview-panel" role="tabpanel" aria-labelledby="preview-tab">
          <StoryPreview title={title} coverUrl={coverUrl} member={member} />
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

function StoryPreview({ title, coverUrl, member }: { title: string; coverUrl: string | null; member: Props["member"] }) {
  // Reads the sibling hidden input the editor keeps updated; preview only ever
  // shows the author their own markup, and the server sanitises on submit.
  const body = typeof document !== "undefined"
    ? (document.querySelector('input[name="body"]') as HTMLInputElement | null)?.value ?? ""
    : "";
  return (
    <div data-testid="story-preview" className="rounded-lg border bg-paper p-5">
      <p className="text-xs uppercase tracking-widest text-graphite">Preview — how your story will appear</p>
      {/* Visual preview, not document structure — the page already has its h1. */}
      <p className="mt-3 text-3xl font-bold leading-tight text-ink">{title || "Untitled story"}</p>
      {coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" className="mt-4 max-h-96 w-full rounded-lg object-cover" />
      )}
      <div className="story-body mt-6" dangerouslySetInnerHTML={{ __html: body }} />
      <MemberBacklink name={member.name} slug={member.slug} logoUrl={member.logoUrl} />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { CoverField } from "@/components/CoverField";
import { StoryHeader, StoryHero, StoryMain } from "@/components/story/StoryArticle";
import { StorySocialLinks } from "@/components/StorySocialLinks";
import { RequiredMark } from "@/components/RequiredMark";
import { RichTextEditor } from "@/components/RichTextEditor";
import { SubmitButton } from "@/components/SubmitButton";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import type { UploadResult } from "@/lib/upload-limits";

type Props = {
  action: (formData: FormData) => Promise<void>;
  uploadImage: (formData: FormData) => Promise<UploadResult>;
  categories: { id: number; name: string; slug?: string }[];
  /** Server action: the body HTML, sanitised exactly as the published page will be. */
  previewBody: (html: string) => Promise<string>;
  member: { name: string; slug: string; logoUrl: string | null };
  /** Present only in edit mode — pre-fills the form and switches the copy/actions. */
  initial?: {
    id: string; title: string; excerpt: string; body: string; coverUrl: string | null; categoryId: number | null;
    /** The story's updated_at when this page rendered — editStory refuses the save if the desk has changed it since. */
    version?: string;
  };
  /** The story is the member's own unsubmitted draft — offers Save draft / Delete instead of Withdraw. */
  isDraft?: boolean;
  withdrawAction?: (formData: FormData) => Promise<void>;
  deleteDraftAction?: (formData: FormData) => Promise<void>;
  /** The full-page "as published" preview, once the story has been saved at least once. */
  previewHref?: string;
};

/**
 * Member story form with a true preview: body + backlink + logo shown exactly
 * as they will publish (req §7 — branding used to appear only after publish).
 * Doubles as the edit form for a pending/rejected submission when `initial`
 * is given — same fields, pre-filled, posting to a resubmit action instead.
 */
export function StoryForm({ action, uploadImage, previewBody, categories, member, initial, isDraft = false, withdrawAction, deleteDraftAction, previewHref }: Props) {
  // Save draft is offered on a new story and on the member's own draft — never
  // on something already submitted, which can only be resubmitted or withdrawn.
  const canDraft = !initial || isDraft;
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [coverUrl, setCoverUrl] = useState<string | null>(initial?.coverUrl ?? null);
  const [categoryId, setCategoryId] = useState<number | null>(initial?.categoryId ?? categories[0]?.id ?? null);

  return (
    <form action={action} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
      <UnsavedChangesGuard />
      {initial && <input type="hidden" name="id" value={initial.id} />}
      {initial?.version && <input type="hidden" name="version" value={initial.version} />}
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
          <label htmlFor="excerpt" className="text-sm font-medium">Summary <span className="font-normal text-graphite">(optional, 1–2 sentences)</span></label>
          <textarea id="excerpt" name="excerpt" rows={2} defaultValue={initial?.excerpt} aria-describedby="excerpt-hint" className="mt-1 w-full rounded border px-3 py-2" />
          <p id="excerpt-hint" className="mt-1 text-xs text-graphite">Shown under the title on story cards and in newsletters, and as the description when the story is shared on social media or found in search. Left empty, the story&apos;s opening lines are used.</p>
        </div>
        <div>
          <span className="block text-sm font-medium">Story</span>
          <RichTextEditor name="body" ariaLabel="Story" uploadImage={uploadImage} initialHtml={initial?.body} />
        </div>
        {/* No Industry field: members never pick one — Jas tags it in the console. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="category" className="text-sm font-medium">Category</label>
            <select id="category" name="category" defaultValue={initial?.categoryId ?? ""} onChange={(e) => setCategoryId(Number(e.target.value) || null)} className="mt-1 w-full rounded border px-3 py-2">
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        {/* Full width, not a grid column: the crop picker is a fixed 320px box. */}
        <CoverField cover={initial?.coverUrl} required onPreview={setCoverUrl} />
      </div>

      {tab === "preview" && (
        <div id="preview-panel" role="tabpanel" aria-labelledby="preview-tab">
          <StoryPreview
            title={title}
            coverUrl={coverUrl}
            member={member}
            category={categories.find((c) => c.id === categoryId) ?? null}
            previewBody={previewBody}
            previewHref={previewHref}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Submitting…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">
          {initial && !isDraft ? "Save & resubmit" : "Submit for approval"}
        </SubmitButton>
        {canDraft && (
          // formNoValidate: a draft doesn't need its cover yet. The server
          // still insists on a title.
          <SubmitButton name="intent" value="draft" formNoValidate pendingLabel="Saving…" className="rounded border border-ink px-5 py-2.5 text-ink disabled:opacity-50">
            Save draft
          </SubmitButton>
        )}
        {previewHref && (
          <a href={previewHref} target="_blank" rel="noopener" className="text-sm font-medium text-ink underline">
            Preview as published ↗<span className="sr-only"> (opens in a new tab, shows the last saved version)</span>
          </a>
        )}
        {initial && !isDraft && withdrawAction && (
          <button type="submit" formAction={withdrawAction} className="text-sm text-graphite underline hover:text-danger">
            Withdraw
          </button>
        )}
        {initial && isDraft && deleteDraftAction && (
          <button
            type="submit"
            formAction={deleteDraftAction}
            formNoValidate
            onClick={(e) => { if (!window.confirm("Delete this draft? This can't be undone.")) e.preventDefault(); }}
            className="text-sm text-graphite underline hover:text-danger"
          >
            Delete draft
          </button>
        )}
      </div>
      {canDraft && (
        <p className="text-xs text-graphite">
          A draft is only visible to you. Nothing goes to the editor until you submit it.
        </p>
      )}
    </form>
  );
}

/**
 * The Preview tab: the story as it will publish, built from the published
 * page's own components (Jas 13/10 items 10/15 — this used to be a separate,
 * simplified render). The body goes through the server's sanitiser first, so
 * the preview shows exactly what survives into the published page.
 */
function StoryPreview({ title, coverUrl, member, category, previewBody, previewHref }: {
  title: string;
  coverUrl: string | null;
  member: Props["member"];
  category: Props["categories"][number] | null;
  previewBody: Props["previewBody"];
  previewHref?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // Reads the sibling hidden input the editor keeps updated.
    const raw = (document.querySelector('input[name="body"]') as HTMLInputElement | null)?.value ?? "";
    let live = true;
    previewBody(raw)
      .then((clean) => { if (live) setHtml(clean); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [previewBody]);

  return (
    <div data-testid="story-preview" className="rounded-lg border bg-paper px-5 pb-5">
      <p className="pt-4 text-xs uppercase tracking-widest text-graphite">Preview — how your story will appear</p>
      <StoryHeader
        story={{ title: title || "Untitled story", published_at: null, is_member_news: true, cover_focus: null }}
        categories={category ? [{ slug: category.slug ?? "", name: category.name }] : []}
      />
      <StoryHero cover={coverUrl} focus={null} />
      <StoryMain
        body={
          html === null ? (
            <p role="status" className="mt-6 text-sm text-graphite">{failed ? "The preview couldn't load — try switching tabs again." : "Loading preview…"}</p>
          ) : (
            <div className="story-body mt-6" dangerouslySetInnerHTML={{ __html: html }} />
          )
        }
        share={<StorySocialLinks posts={null} />}
        members={[member]}
        layout="inline"
      />
      {previewHref && (
        <p className="mt-4 text-sm">
          <a href={previewHref} target="_blank" rel="noopener" className="font-medium text-ink underline">
            See the full page as published ↗<span className="sr-only"> (opens in a new tab, shows the last saved version)</span>
          </a>
        </p>
      )}
    </div>
  );
}

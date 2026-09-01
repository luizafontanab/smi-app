"use client";

import { useState } from "react";
import { CoverField } from "@/components/CoverField";
import { MemberBacklink } from "@/components/MemberBacklink";
import { RichTextEditor } from "@/components/RichTextEditor";

type Props = {
  action: (formData: FormData) => Promise<void>;
  uploadImage: (formData: FormData) => Promise<string | null>;
  categories: { id: number; name: string }[];
  member: { name: string; slug: string; logoUrl: string | null };
  /** Present only in edit mode — pre-fills the form and switches the copy/actions. */
  initial?: { id: string; title: string; excerpt: string; body: string; coverUrl: string | null; categoryId: number | null };
  withdrawAction?: (formData: FormData) => Promise<void>;
};

/**
 * Member story form with a true preview: body + backlink + logo shown exactly
 * as they will publish (req §7 — branding used to appear only after publish).
 * Doubles as the edit form for a pending/rejected submission when `initial`
 * is given — same fields, pre-filled, posting to a resubmit action instead.
 */
export function StoryForm({ action, uploadImage, categories, member, initial, withdrawAction }: Props) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [coverUrl, setCoverUrl] = useState<string | null>(initial?.coverUrl ?? null);

  return (
    <form action={action} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="flex gap-1 border-b pb-3 text-sm">
        <button type="button" onClick={() => setTab("write")} className={`rounded px-3 py-1.5 ${tab === "write" ? "bg-ink text-white" : "bg-gray-100"}`}>Write</button>
        <button type="button" onClick={() => setTab("preview")} className={`rounded px-3 py-1.5 ${tab === "preview" ? "bg-ink text-white" : "bg-gray-100"}`}>Preview</button>
      </div>

      {/* Both tabs stay mounted — hidden inputs must remain in the form. */}
      <div className={tab === "write" ? "space-y-4" : "hidden"}>
        <div>
          <label htmlFor="title" className="text-sm font-medium">Title</label>
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
        <div className="sm:w-1/2 sm:pr-2">
          <label htmlFor="category" className="text-sm font-medium">Category</label>
          <select id="category" name="category" defaultValue={initial?.categoryId ?? ""} className="mt-1 w-full rounded border px-3 py-2">
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {/* Full width, not a grid column: the crop picker is a fixed 320px box. */}
        <CoverField onPreview={setCoverUrl} />
      </div>

      {tab === "preview" && <StoryPreview title={title} coverUrl={coverUrl} member={member} />}

      <div className="flex items-center gap-3">
        <button className="rounded bg-ink px-5 py-2.5 text-white">{initial ? "Save & resubmit" : "Submit for approval"}</button>
        {initial && withdrawAction && (
          <button type="submit" formAction={withdrawAction} className="text-sm text-gray-500 underline hover:text-red-600">
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
      <p className="text-xs uppercase tracking-widest text-gray-500">Preview — how your story will appear</p>
      <h1 className="mt-3 text-3xl font-bold leading-tight text-ink">{title || "Untitled story"}</h1>
      {coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" className="mt-4 max-h-96 w-full rounded-lg object-cover" />
      )}
      <div className="story-body mt-6" dangerouslySetInnerHTML={{ __html: body }} />
      <MemberBacklink name={member.name} slug={member.slug} logoUrl={member.logoUrl} />
    </div>
  );
}

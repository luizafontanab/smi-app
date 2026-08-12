"use client";

import { useState } from "react";
import { MemberBacklink } from "@/components/MemberBacklink";
import { RichTextEditor } from "@/components/RichTextEditor";

type Props = {
  action: (formData: FormData) => Promise<void>;
  uploadImage: (formData: FormData) => Promise<string | null>;
  categories: { id: number; name: string }[];
  member: { name: string; slug: string; logoUrl: string | null };
};

/**
 * Member story form with a true preview: body + backlink + logo shown exactly
 * as they will publish (req §7 — branding used to appear only after publish).
 */
export function StoryForm({ action, uploadImage, categories, member }: Props) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [title, setTitle] = useState("");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  return (
    <form action={action} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
      <div className="flex gap-1 border-b pb-3 text-sm">
        <button type="button" onClick={() => setTab("write")} className={`rounded px-3 py-1.5 ${tab === "write" ? "bg-navy text-white" : "bg-gray-100"}`}>Write</button>
        <button type="button" onClick={() => setTab("preview")} className={`rounded px-3 py-1.5 ${tab === "preview" ? "bg-navy text-white" : "bg-gray-100"}`}>Preview</button>
      </div>

      {/* Both tabs stay mounted — hidden inputs must remain in the form. */}
      <div className={tab === "write" ? "space-y-4" : "hidden"}>
        <div>
          <label className="text-sm font-medium">Title</label>
          <input name="title" required value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label className="text-sm font-medium">Summary (1–2 sentences)</label>
          <textarea name="excerpt" rows={2} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label className="text-sm font-medium">Story</label>
          <RichTextEditor name="body" uploadImage={uploadImage} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium">Category</label>
            <select name="category" className="mt-1 w-full rounded border px-3 py-2">
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Cover image</label>
            <input
              type="file"
              name="cover"
              accept="image/jpeg,image/png,image/webp"
              className="mt-1 w-full text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setCoverUrl((prev) => {
                  if (prev) URL.revokeObjectURL(prev);
                  return f ? URL.createObjectURL(f) : null;
                });
              }}
            />
            <p className="mt-1 text-xs text-gray-400">
              Landscape works best: at least 1200×675px (16:9), JPG/PNG, max 8MB. Keep faces and key detail near the centre.
            </p>
          </div>
        </div>
      </div>

      {tab === "preview" && <StoryPreview title={title} coverUrl={coverUrl} member={member} />}

      <button className="rounded bg-navy px-5 py-2.5 text-white">Submit for approval</button>
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
      <p className="text-xs uppercase tracking-widest text-gray-400">Preview — how your story will appear</p>
      <h1 className="mt-3 text-3xl font-bold leading-tight text-navy">{title || "Untitled story"}</h1>
      {coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" className="mt-4 max-h-96 w-full rounded-lg object-cover" />
      )}
      <div className="story-body mt-6" dangerouslySetInnerHTML={{ __html: body }} />
      <MemberBacklink name={member.name} slug={member.slug} logoUrl={member.logoUrl} />
    </div>
  );
}

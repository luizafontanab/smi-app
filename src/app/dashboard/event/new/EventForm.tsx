"use client";

import Link from "next/link";
import { useState } from "react";
import { RequiredMark } from "@/components/RequiredMark";
import { RichTextEditor } from "@/components/RichTextEditor";
import { EVENT_TYPES, EVENT_TYPE_LABELS } from "@/lib/event-types";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import type { UploadResult } from "@/lib/upload-limits";

type Props = {
  action: (formData: FormData) => Promise<void>;
  uploadImage: (formData: FormData) => Promise<UploadResult>;
  member: { name: string; slug: string };
  industries: { id: number; name: string }[];
  /** Present only in edit mode — pre-fills the form and switches the copy/actions. */
  initial?: {
    id: string; title: string; description: string; startsOn: string; startsTime: string | null;
    endsOn: string | null; location: string; link: string | null; type: string | null; coverUrl: string | null;
    industryId: number | null;
  };
  withdrawAction?: (formData: FormData) => Promise<void>;
  /** The member's own industry — the fallback whenever the event has none of its
   *  own, on a new submission and on editing one that pre-dates the field. */
  defaultIndustryId?: number | null;
};

/**
 * Member event form with a true preview: date/time/location + description
 * shown exactly as it will publish — same pattern as StoryForm/VideoForm.
 * Doubles as the edit form for a pending/rejected submission when `initial`
 * is given.
 */
export function EventForm({ action, uploadImage, member, industries, initial, withdrawAction, defaultIndustryId }: Props) {
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

      {/* Both tabs stay mounted — hidden/plain inputs must remain in the form. */}
      <div id="write-panel" role="tabpanel" aria-labelledby="write-tab" className={tab === "write" ? "space-y-4" : "hidden"}>
        <div>
          <label htmlFor="title" className="text-sm font-medium">Event name<RequiredMark /></label>
          <input id="title" name="title" required value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <span className="block text-sm font-medium">Description</span>
          <RichTextEditor name="description" ariaLabel="Description" uploadImage={uploadImage} minHeightClass="min-h-32" initialHtml={initial?.description} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="starts_on" className="text-sm font-medium">Starts<RequiredMark /></label>
            <input id="starts_on" name="starts_on" type="date" required defaultValue={initial?.startsOn} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label htmlFor="starts_time" className="text-sm font-medium">Time (optional)</label>
            <input id="starts_time" name="starts_time" type="time" defaultValue={initial?.startsTime ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label htmlFor="ends_on" className="text-sm font-medium">Ends (optional)</label>
            <input id="ends_on" name="ends_on" type="date" defaultValue={initial?.endsOn ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="location" className="text-sm font-medium">Location</label>
            <input id="location" name="location" defaultValue={initial?.location} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label htmlFor="link" className="text-sm font-medium">Link (optional)</label>
            <input id="link" name="link" type="url" defaultValue={initial?.link ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="type" className="text-sm font-medium">Type (optional)</label>
            <select id="type" name="type" defaultValue={initial?.type ?? ""} className="mt-1 w-full rounded border px-3 py-2">
              <option value="">— none —</option>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            {/* Defaults to the member's own industry on a new event. Nothing has
                ever written events.industry_id, so this form is where the
                column starts getting values. On an edit the saved value wins
                outright, including when it is none — otherwise a resubmit
                would silently undo a deliberate "— none —". */}
            <label htmlFor="industry_id" className="text-sm font-medium">Industry</label>
            <select id="industry_id" name="industry_id" defaultValue={initial ? initial.industryId ?? "" : defaultIndustryId ?? ""} className="mt-1 w-full rounded border px-3 py-2">
              <option value="">— none —</option>
              {industries.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-graphite">Helps buyers find your event on the matching industry page.</p>
          </div>
        </div>
        <div>
          <label htmlFor="cover" className="text-sm font-medium">Cover image (optional)</label>
          <input id="cover"
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
          <p className="mt-1 text-xs text-graphite">Landscape works best, JPG/PNG/WebP, max 8MB.</p>
        </div>
      </div>

      {tab === "preview" && (
        <div id="preview-panel" role="tabpanel" aria-labelledby="preview-tab">
          <EventPreview title={title} coverUrl={coverUrl} member={member} />
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

function EventPreview({ title, coverUrl, member }: { title: string; coverUrl: string | null; member: Props["member"] }) {
  // Reads the sibling inputs the write tab keeps updated; preview only ever
  // shows the author their own markup, and the server sanitises on submit.
  const read = (name: string) => (typeof document !== "undefined"
    ? (document.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value ?? ""
    : "");
  const description = read("description");
  const location = read("location");
  const startsOn = read("starts_on");
  const startsTime = read("starts_time");
  const endsOn = read("ends_on");

  const dateLabel = startsOn
    ? new Date(`${startsOn}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
      + (endsOn && endsOn > startsOn ? ` – ${new Date(`${endsOn}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}` : "")
      + (startsTime ? `, ${new Date(2000, 0, 1, Number(startsTime.split(":")[0]), Number(startsTime.split(":")[1])).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })}` : "")
    : "";

  return (
    <div data-testid="event-preview" className="rounded-lg border bg-paper p-5">
      <p className="text-xs uppercase tracking-widest text-graphite">Preview — how your event will appear</p>
      {dateLabel && <p className="mt-4 text-xs font-semibold uppercase text-brand-text">{dateLabel}</p>}
      {/* Visual preview, not document structure — the page already has its h1. */}
      <p className="mt-1 text-3xl font-bold leading-tight text-ink">{title || "Untitled event"}</p>
      {location && <p className="mt-1 text-sm text-graphite">{location}</p>}
      {coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" className="mt-4 max-h-96 w-full rounded-lg object-cover" />
      )}
      <div className="story-body mt-6" dangerouslySetInnerHTML={{ __html: description }} />
      {member.name && (
        <p className="mt-6 text-sm text-graphite">
          Hosted by <Link href={`/member/${member.slug}`} className="font-medium text-ink hover:underline">{member.name}</Link>
        </p>
      )}
    </div>
  );
}

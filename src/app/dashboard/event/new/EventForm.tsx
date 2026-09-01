"use client";

import Link from "next/link";
import { useState } from "react";
import { RichTextEditor } from "@/components/RichTextEditor";
import { EVENT_TYPES, EVENT_TYPE_LABELS } from "@/lib/event-types";

type Props = {
  action: (formData: FormData) => Promise<void>;
  uploadImage: (formData: FormData) => Promise<string | null>;
  member: { name: string; slug: string };
  /** Present only in edit mode — pre-fills the form and switches the copy/actions. */
  initial?: {
    id: string; title: string; description: string; startsOn: string; startsTime: string | null;
    endsOn: string | null; location: string; link: string | null; type: string | null; coverUrl: string | null;
  };
  withdrawAction?: (formData: FormData) => Promise<void>;
};

/**
 * Member event form with a true preview: date/time/location + description
 * shown exactly as it will publish — same pattern as StoryForm/VideoForm.
 * Doubles as the edit form for a pending/rejected submission when `initial`
 * is given.
 */
export function EventForm({ action, uploadImage, member, initial, withdrawAction }: Props) {
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

      {/* Both tabs stay mounted — hidden/plain inputs must remain in the form. */}
      <div className={tab === "write" ? "space-y-4" : "hidden"}>
        <div>
          <label htmlFor="title" className="text-sm font-medium">Event name</label>
          <input id="title" name="title" required value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <span className="block text-sm font-medium">Description</span>
          <RichTextEditor name="description" ariaLabel="Description" uploadImage={uploadImage} minHeightClass="min-h-32" initialHtml={initial?.description} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="starts_on" className="text-sm font-medium">Starts</label>
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
        <div>
          <label htmlFor="type" className="text-sm font-medium">Type (optional)</label>
          <select id="type" name="type" defaultValue={initial?.type ?? ""} className="mt-1 w-full rounded border px-3 py-2">
            <option value="">— none —</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>)}
          </select>
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
          <p className="mt-1 text-xs text-gray-500">Landscape works best, JPG/PNG/WebP, max 8MB.</p>
        </div>
      </div>

      {tab === "preview" && <EventPreview title={title} coverUrl={coverUrl} member={member} />}

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
      <p className="text-xs uppercase tracking-widest text-gray-500">Preview — how your event will appear</p>
      {dateLabel && <p className="mt-4 text-xs font-semibold uppercase text-brand">{dateLabel}</p>}
      <h1 className="mt-1 text-3xl font-bold leading-tight text-ink">{title || "Untitled event"}</h1>
      {location && <p className="mt-1 text-sm text-gray-500">{location}</p>}
      {coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" className="mt-4 max-h-96 w-full rounded-lg object-cover" />
      )}
      <div className="story-body mt-6" dangerouslySetInnerHTML={{ __html: description }} />
      {member.name && (
        <p className="mt-6 text-sm text-gray-500">
          Hosted by <Link href={`/member/${member.slug}`} className="font-medium text-ink hover:underline">{member.name}</Link>
        </p>
      )}
    </div>
  );
}

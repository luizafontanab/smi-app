"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

export type AdvertDefaults = {
  name: string;
  format: string;
  linkUrl: string;
  startsOn: string;
  endsOn: string;
  desktopUrl: string | null;
  mobileUrl: string | null;
};

type Props = {
  action: (formData: FormData) => Promise<void>;
  bookingId?: string;
  defaults?: AdvertDefaults;
  submitLabel?: string;
};

/**
 * Formats a member may ask for, with the footprint they need to supply. The
 * pixel sizes mirror AdCreative.tsx — if those change, these captions are the
 * thing an advertiser will have designed against, so they change together.
 */
const FORMATS = [
  { value: "banner", label: "Banner", desktop: "1280×170", mobile: "370×280" },
  { value: "mpu", label: "Box (MPU)", desktop: "300×250", mobile: "300×250" },
  { value: "skyscraper", label: "Skyscraper", desktop: "300×600", mobile: "— desktop only" },
  { value: "in_feed", label: "In-feed card", desktop: "370×280", mobile: "370×280" },
  { value: "supplier_logo", label: "Supplier logo", desktop: "240×120", mobile: "240×120" },
];

/**
 * The preview is the point of this form: an advertiser is buying a footprint,
 * so they need to see their artwork at the size it will actually occupy rather
 * than trust a caption. Both panes stay mounted — the file inputs must remain
 * in the form for submission.
 */
export function AdvertForm({ action, bookingId, defaults, submitLabel = "Submit for approval" }: Props) {
  const [tab, setTab] = useState<"details" | "preview">("details");
  const [format, setFormat] = useState(defaults?.format ?? "banner");
  const [desktopUrl, setDesktopUrl] = useState<string | null>(defaults?.desktopUrl ?? null);
  const [mobileUrl, setMobileUrl] = useState<string | null>(defaults?.mobileUrl ?? null);
  const spec = FORMATS.find((f) => f.value === format) ?? FORMATS[0];

  // Revoke the previous object URL before replacing it, or picking a few files
  // in a row leaks each one for the life of the page.
  const preview = (file: File | undefined, set: Dispatch<SetStateAction<string | null>>) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    set((old) => {
      if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
      return url;
    });
  };

  return (
    <form action={action} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
      {bookingId && <input type="hidden" name="id" value={bookingId} />}
      <div className="flex gap-1 border-b pb-3 text-sm">
        <button type="button" onClick={() => setTab("details")} className={`rounded px-3 py-1.5 ${tab === "details" ? "bg-ink text-white" : "bg-gray-100"}`}>Details</button>
        <button type="button" onClick={() => setTab("preview")} className={`rounded px-3 py-1.5 ${tab === "preview" ? "bg-ink text-white" : "bg-gray-100"}`}>Preview</button>
      </div>

      <div className={tab === "details" ? "space-y-4" : "hidden"}>
        <div>
          <label htmlFor="name" className="text-sm font-medium">Advert name</label>
          <input id="name" name="name" required defaultValue={defaults?.name ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
          <p className="mt-1 text-xs text-gray-400">For your own reference — readers never see it.</p>
        </div>
        <div>
          <label htmlFor="format" className="text-sm font-medium">Format</label>
          <select id="format" name="format" value={format} onChange={(e) => setFormat(e.target.value)} className="mt-1 w-full rounded border px-3 py-2">
            {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label} — {f.desktop}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="link_url" className="text-sm font-medium">Where should clicks go? (optional)</label>
          <input id="link_url" name="link_url" type="url" defaultValue={defaults?.linkUrl ?? ""} placeholder="https://…" className="mt-1 w-full rounded border px-3 py-2" />
          <p className="mt-1 text-xs text-gray-400">Leave blank to send people to your SMI member page.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="desktop" className="text-sm font-medium">Desktop artwork</label>
            <p className="text-xs text-gray-400">{spec.desktop}</p>
            <input id="desktop" name="desktop" type="file" accept="image/jpeg,image/png,image/webp" required={!defaults}
              onChange={(e) => preview(e.target.files?.[0], setDesktopUrl)} className="mt-1 w-full text-sm" />
          </div>
          <div>
            <label htmlFor="mobile" className="text-sm font-medium">Mobile artwork</label>
            <p className="text-xs text-gray-400">{spec.mobile}</p>
            <input id="mobile" name="mobile" type="file" accept="image/jpeg,image/png,image/webp" required={!defaults}
              onChange={(e) => preview(e.target.files?.[0], setMobileUrl)} className="mt-1 w-full text-sm" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="starts_on" className="text-sm font-medium">Preferred start</label>
            <input id="starts_on" name="starts_on" type="date" required defaultValue={defaults?.startsOn ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label htmlFor="ends_on" className="text-sm font-medium">Preferred end</label>
            <input id="ends_on" name="ends_on" type="date" required defaultValue={defaults?.endsOn ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
        </div>
        <div>
          <label htmlFor="notes" className="text-sm font-medium">Anything we should know? (optional)</label>
          <input id="notes" name="notes" className="mt-1 w-full rounded border px-3 py-2" />
        </div>
      </div>

      <div className={tab === "preview" ? "space-y-5" : "hidden"} data-testid="advert-preview">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Desktop — {spec.desktop}</p>
          {desktopUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={desktopUrl} alt="" className="mt-2 w-full rounded border" />
            : <div className="mt-2 flex h-24 items-center justify-center rounded border-2 border-dashed text-xs text-gray-400">Choose desktop artwork to preview it</div>}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Mobile — {spec.mobile}</p>
          {mobileUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={mobileUrl} alt="" className="mt-2 w-full max-w-[370px] rounded border" />
            : <div className="mt-2 flex h-24 items-center justify-center rounded border-2 border-dashed text-xs text-gray-400">Choose mobile artwork to preview it</div>}
        </div>
        <p className="text-xs text-gray-500">
          Every advert rotates equally — no one can buy a position, so what you see here is what every reader sees.
        </p>
      </div>

      <button className="rounded bg-ink px-5 py-2.5 text-white">{submitLabel}</button>
    </form>
  );
}

import { ContactForm } from "@/components/ContactForm";
import { JoinCta } from "@/components/JoinCta";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { DEFAULT_AD_FORMATS, type AdFormat } from "@/lib/advert-formats";

export const metadata = {
  title: "Advertising",
  description: "Put your brand in front of the UK sheet metal trade — banner, rail and newsletter advertising with Sheet Metal Industries.",
  alternates: { canonical: "/advertising" },
};
export const dynamic = "force-dynamic";

export default async function AdvertisingPage() {
  const db = serviceDb();
  const [{ data: setting }, { data: formatSetting }] = await Promise.all([
    db.from("settings").select("value").eq("key", "media_pack").maybeSingle(),
    db.from("settings").select("value").eq("key", "advert_formats").maybeSingle(),
  ]);
  const packUrl = mediaUrl((setting?.value as { path?: string } | null)?.path ?? null);
  const FORMATS = (formatSetting?.value as AdFormat[] | null) ?? DEFAULT_AD_FORMATS;
  return (
    <div className="mx-auto max-w-4xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-ink">Advertise with SMI</h1>
      <p className="mt-2 max-w-2xl text-sm text-gray-600">
        Reach the UK sheet metal, fabrication and welding trade. Rotation is deliberate: no one can buy position, so every advertiser gets equal visibility.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {FORMATS.map((f) => (
          <div key={f.key} className="rounded-lg bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase text-brand">Format {f.key}</p>
            <h2 className="mt-1 font-bold">{f.name}</h2>
            <p className="mt-1 text-sm text-gray-600">{f.detail}</p>
          </div>
        ))}
      </div>
      <div className="mt-8 rounded-lg bg-white p-6 shadow-sm">
        <h2 className="font-bold text-ink">{packUrl ? "Media pack" : "Request the media pack"}</h2>
        {packUrl ? (
          <>
            <p className="mt-1 text-sm text-gray-600">Rates, formats and audience stats.</p>
            <a href={packUrl} target="_blank" rel="noopener" className="mt-3 inline-block rounded bg-ink px-4 py-2 text-sm text-white">
              Download the media pack (PDF)
            </a>
            <p className="mb-4 mt-6 text-sm text-gray-600">Or ask us anything:</p>
          </>
        ) : (
          <p className="mb-4 mt-1 text-sm text-gray-600">Rates and audience stats — we&apos;ll send the current pack.</p>
        )}
        <ContactForm kind="advertising" />
      </div>
      <JoinCta />
      <div className="my-10" />
    </div>
  );
}

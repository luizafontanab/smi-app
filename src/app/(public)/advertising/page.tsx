import Image from "next/image";
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
      <p className="mt-2 max-w-2xl text-sm text-graphite">
        Reach the UK sheet metal, fabrication and welding trade. Rotation is deliberate: no one can buy position, so every advertiser gets equal visibility.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {FORMATS.map((f) => {
          const example = mediaUrl(f.example_path ?? null);
          return (
            <div key={f.key} className="rounded-lg bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase text-brand-text">Format {f.key}</p>
              <h2 className="mt-1 font-bold">{f.name}</h2>
              <p className="mt-1 text-sm text-graphite">{f.detail}</p>
              {example && (
                <Image
                  src={example}
                  alt={`Example ${f.name} advert`}
                  width={640}
                  height={320}
                  className="mt-3 h-auto w-full rounded object-contain"
                  unoptimized
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-8 rounded-lg bg-white p-6 shadow-sm">
        <h2 className="font-bold text-ink">Bundles</h2>
        <p className="mt-1 text-sm text-graphite">
          Most advertisers combine formats — a sitewide banner alongside a newsletter slot, or a Featured Member spot with
          a homepage takeover. We put bundles together individually and price them for your campaign, so there&apos;s no
          fixed menu: tell us what you want to achieve and we&apos;ll propose a package. Ask about a bundle using the form
          below.
        </p>
      </div>
      <div className="mt-8 rounded-lg bg-white p-6 shadow-sm">
        <h2 className="font-bold text-ink">{packUrl ? "Media pack" : "Request the media pack"}</h2>
        {packUrl ? (
          <>
            <p className="mt-1 text-sm text-graphite">Rates, formats and audience stats.</p>
            <a href={packUrl} target="_blank" rel="noopener" className="mt-3 inline-block rounded bg-ink px-4 py-2 text-sm text-white">
              Download the media pack (PDF)
            </a>
            <p className="mb-4 mt-6 text-sm text-graphite">Or ask us anything:</p>
          </>
        ) : (
          <p className="mb-4 mt-1 text-sm text-graphite">Rates and audience stats — we&apos;ll send the current pack.</p>
        )}
        <ContactForm kind="advertising" />
      </div>
      <JoinCta />
      <div className="my-10" />
    </div>
  );
}

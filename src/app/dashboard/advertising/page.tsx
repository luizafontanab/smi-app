import Link from "next/link";
import { requireMemberView } from "@/lib/auth";
import { DEFAULT_AD_FORMATS, type AdFormat } from "@/lib/advert-formats";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { VISIBILITY_PRODUCTS } from "@/lib/visibility-products";
import { AdvertisingTabs } from "./AdvertisingTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Advertising" };

export default async function AdvertisingInfoPage() {
  await requireMemberView();
  const db = serviceDb();
  const [{ data: packSetting }, { data: formatSetting }] = await Promise.all([
    db.from("settings").select("value").eq("key", "media_pack").maybeSingle(),
    db.from("settings").select("value").eq("key", "advert_formats").maybeSingle(),
  ]);
  const packUrl = mediaUrl((packSetting?.value as { path?: string } | null)?.path ?? null);
  const formats = (formatSetting?.value as AdFormat[] | null) ?? DEFAULT_AD_FORMATS;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mt-1 text-xl font-bold text-ink">Advertising</h1>
      <p className="mt-1 text-sm text-graphite">
        Banners, featured slots and the newsletter — all in one place. Rotation is deliberate: no one can buy position,
        so every advertiser gets equal visibility.
      </p>
      <AdvertisingTabs active="information" />

      <section className="mt-5">
        <h2 className="font-bold text-ink">Banner adverts</h2>
        <p className="mt-1 text-sm text-graphite">
          Upload your artwork, pick the dates, and we take it from there. We confirm availability and send you
          an invoice, which you can pay by card from your account — your advert goes live once it&apos;s paid.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {formats.map((f) => (
            <div key={f.key} className="rounded-lg bg-white p-4 shadow-sm">
              <p className="text-xs font-bold uppercase text-brand-text">Format {f.key}</p>
              <p className="mt-1 font-bold text-ink">{f.name}</p>
              <p className="mt-1 text-sm text-graphite">{f.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-bold text-ink">Visibility products</h2>
        <p className="mt-1 text-sm text-graphite">Featured slots and newsletter placements, requested with one click.</p>
        <div className="mt-3 space-y-3">
          {VISIBILITY_PRODUCTS.map((p) => (
            <div key={p.key} className="rounded-lg bg-white p-4 shadow-sm">
              <p className="font-bold text-ink">{p.name}</p>
              <p className="text-sm text-graphite">{p.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="mt-6 text-sm text-graphite">
        {packUrl && (
          <>
            <a href={packUrl} target="_blank" rel="noopener" className="text-graphite underline">
              Download the media pack (PDF)
            </a>{" "}
            for rates and audience stats, or{" "}
          </>
        )}
        {!packUrl && <>Rates and audience stats live on the </>}
        <Link href="/advertising" className="text-graphite underline">public advertising page</Link>.
        Ready to go? <Link href="/dashboard/advertising/buy" className="font-semibold text-graphite underline">Buy →</Link>
      </p>
    </div>
  );
}

import { ContactForm } from "@/components/ContactForm";
import { mediaUrl, serviceDb } from "@/lib/db/server";

export const metadata = { title: "Advertising" };
export const dynamic = "force-dynamic";

const FORMATS = [
  { key: "A", name: "Sitewide website banners", detail: "Randomised rotation across homepage, news, articles, videos and the member directory. Desktop 1280×170px, mobile 370×280px. No advertiser owns a position — every slot rotates." },
  { key: "B", name: "Featured Member", detail: "Your logo and profile in the homepage carousel and higher visibility in Find a Member." },
  { key: "C", name: "Homepage Takeover", detail: "Your colour scheme across homepage, news and videos with top banner placement. Hex colour required; WCAG 2.1 A compliance applies." },
  { key: "D", name: "Supplier Logo", detail: "Rotating logo carousel on the homepage and news pages." },
  { key: "E", name: "Editor's Monthly E-Newsletter", detail: "Banner (560×300px, 18pt minimum font) or 'In Association With' logo (250×60px). 12 issues a year to ~2,500 trade readers." },
  { key: "F", name: "Banner design help", detail: "One-off design service for desktop and mobile banners." },
];

export default async function AdvertisingPage() {
  const { data: setting } = await serviceDb().from("settings").select("value").eq("key", "media_pack").maybeSingle();
  const packUrl = mediaUrl((setting?.value as { path?: string } | null)?.path ?? null);
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
      <div className="my-10" />
    </div>
  );
}

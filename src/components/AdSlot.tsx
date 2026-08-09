import Image from "next/image";
import Link from "next/link";
import { advertHref, type LiveAdvert } from "@/lib/adverts";
import { mediaUrl } from "@/lib/db/server";

/**
 * Renders one advert slot. Which adverts land here was decided by an
 * unbiased per-request shuffle upstream (lib/adverts.ts) — this component
 * only displays; it must never reorder or filter by advertiser.
 */
export function AdSlot({ adverts, shape = "banner" }: { adverts: LiveAdvert[]; shape?: "banner" | "rail" }) {
  const ad = adverts[0];
  if (!ad) return null;
  const desktop = mediaUrl(ad.desktopPath)!;
  const mobile = mediaUrl(ad.mobilePath)!;
  return (
    <Link href={advertHref(ad)} className="block" aria-label={`Advert: ${ad.name}`}>
      {shape === "banner" ? (
        <>
          <Image src={desktop} alt={ad.name} width={1280} height={170} className="hidden w-full rounded md:block" unoptimized />
          <Image src={mobile} alt={ad.name} width={370} height={280} className="w-full rounded md:hidden" unoptimized />
        </>
      ) : (
        <Image src={mobile} alt={ad.name} width={370} height={280} className="w-full rounded" unoptimized />
      )}
    </Link>
  );
}

export function SupplierLogos({ adverts }: { adverts: LiveAdvert[] }) {
  if (adverts.length === 0) return null;
  return (
    <section className="border-t bg-white py-6">
      <div className="mx-auto max-w-6xl px-4">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-500">Suppliers</h2>
        <div className="flex flex-wrap items-center gap-6">
          {adverts.map((ad) => (
            <Link key={ad.advertId} href={advertHref(ad)}>
              <Image src={mediaUrl(ad.mobilePath)!} alt={ad.name} width={120} height={60} className="h-12 w-auto" unoptimized />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

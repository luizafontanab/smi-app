import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { CookieConsent } from "@/components/CookieConsent";
import { SkipLink } from "@/components/SkipLink";
import { currentUser } from "@/lib/auth";
import { mediaUrl } from "@/lib/db/server";
import { organizationLd, webSiteLd } from "@/lib/jsonld";
import { activeTakeover } from "@/lib/queries";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [user, takeover] = await Promise.all([currentUser(), activeTakeover()]);

  // Site-wide by design (V17 names home/news/videos; this is a deliberate
  // superset — one shared layout, not a per-route check). --smi-brand is the
  // one variable every brand-coloured class in globals.css reads through
  // @theme inline, so overriding it here recolours the whole public site for
  // the takeover's duration and nothing else touches — inline style always
  // beats the stylesheet default regardless of Next's <style> injection order.
  const style = takeover ? ({ "--smi-brand": takeover.hex } as React.CSSProperties) : undefined;
  const bannerHref = takeover?.memberSlug ? `/member/${takeover.memberSlug}` : undefined;

  return (
    <div style={style} className="flex min-h-full flex-1 flex-col">
      {/* Site identity for search/AI crawlers — page-specific types (Article,
          Event, …) are added by the pages themselves. */}
      <JsonLd data={[organizationLd(), webSiteLd()]} />
      <SkipLink />
      {takeover && (
        bannerHref ? (
          <Link href={bannerHref}>
            {/* eslint-disable-next-line @next/next/no-img-element -- full-bleed takeover banner, not a fixed-ratio card image */}
            <img src={mediaUrl(takeover.bannerPath)!} alt="" className="w-full" />
          </Link>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(takeover.bannerPath)!} alt="" className="w-full" />
        )
      )}
      <SiteHeader user={user} />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter />
      <CookieConsent />
    </div>
  );
}

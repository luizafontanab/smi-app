import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { GridSiteHeader } from "@/components/GridSiteHeader";
import { GridSiteFooter } from "@/components/GridSiteFooter";
import { CookieConsent } from "@/components/CookieConsent";
import { SkipLink } from "@/components/SkipLink";
import { currentUser } from "@/lib/auth";
import { mediaUrl } from "@/lib/db/server";
import { organizationLd, webSiteLd } from "@/lib/jsonld";
import { unreadNotificationCount } from "@/lib/notifications";
import { activeTakeover, industries as industryList } from "@/lib/queries";
import { siteVariant } from "@/lib/variant";
import { IndustryBar } from "@/components/IndustryBar";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [user, takeover, industries, variant] = await Promise.all([currentUser(), activeTakeover(), industryList(), siteVariant()]);

  // The two designs' chrome differs structurally, not just in colour — grid's
  // is the light header/footer from the client's comps, forge's the near-black
  // pair. siteVariant() is cache()-wrapped and the root layout already reads
  // the same cookie, so this costs nothing extra. Grid's chrome applies to
  // every grid-mode route, not just the homepage: there is one public layout,
  // and a light homepage under a near-black header was the thing to avoid.
  const isGrid = variant === "grid";
  const Header = isGrid ? GridSiteHeader : SiteHeader;
  const Footer = isGrid ? GridSiteFooter : SiteFooter;

  // Signed-in members only: an anonymous visit adds no query, and an admin's
  // unread signal is the console's own inbox bell. currentUser() reads cookies,
  // so this layout is already per-request — no caching is given up here.
  const unread = user?.memberId ? await unreadNotificationCount(user.memberId) : 0;

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
          <Link href={bannerHref} aria-label="Advertisement — visit the takeover sponsor">
            {/* eslint-disable-next-line @next/next/no-img-element -- full-bleed takeover banner, not a fixed-ratio card image */}
            <img src={mediaUrl(takeover.bannerPath)!} alt="" className="w-full" />
          </Link>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(takeover.bannerPath)!} alt="" className="w-full" />
        )
      )}
      <IndustryBar industries={industries} tone={isGrid ? "light" : "dark"} />
      <Header user={user} unread={unread} />
      <main id="main" className="flex-1">{children}</main>
      <Footer />
      <CookieConsent />
    </div>
  );
}

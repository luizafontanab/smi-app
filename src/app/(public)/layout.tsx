import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
// Header and footer come through the design-option hook point, never their
// component files (#69). Forge's footer is not a design-option piece.
import { Footer as DesignFooter, Header } from "@/components/design-option";
import { SiteFooter as ForgeSiteFooter } from "@/components/SiteFooter";
import { CookieConsent } from "@/components/CookieConsent";
import { SkipLink } from "@/components/SkipLink";
import { currentUser } from "@/lib/auth";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { mediaUrl } from "@/lib/db/server";
import { organizationLd, webSiteLd } from "@/lib/jsonld";
import { unreadNotificationCount } from "@/lib/notifications";
import { activeTakeover, industries as industryList } from "@/lib/queries";
import { siteVariant } from "@/lib/variant";
import { IndustryBar } from "@/components/IndustryBar";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // The industry strip only exists while Jas has industries on for the public
  // site (feature flag industries_public); off, it isn't even fetched.
  const [user, takeover, industries, variant] = await Promise.all([
    currentUser(),
    activeTakeover(),
    isFeatureEnabled("industries_public").then((on) => (on ? industryList() : [])),
    siteVariant(),
  ]);

  // The header is one structure in two tones — grid's the light bar from the
  // client's comps, forge's near-black — with the menus right of the mark on
  // both. The footers still differ structurally. siteVariant() is
  // cache()-wrapped and the root layout already reads the same cookie, so this
  // costs nothing extra. Grid's chrome applies to every grid-mode route, not
  // just the homepage: there is one public layout, and a light homepage under
  // a near-black header was the thing to avoid.
  const isGrid = variant === "grid";
  const Footer = isGrid ? DesignFooter : ForgeSiteFooter;

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
    // data-site="public" scopes a design option's stylesheet to the public site;
    // it never goes on /console or /dashboard (#69). data-takeover flags the
    // inline --smi-brand above, so an option can change what it puts on that
    // colour; Current's stylesheet ignores it (#68 review).
    <div data-site="public" data-takeover={takeover ? "" : undefined} style={style} className="flex min-h-full flex-1 flex-col">
      {/* Site identity for search/AI crawlers — page-specific types (Article,
          Event, …) are added by the pages themselves. */}
      <JsonLd data={[organizationLd(), webSiteLd()]} />
      <SkipLink />
      {takeover && (
        bannerHref ? (
          <Link href={bannerHref} data-part="takeover-banner" aria-label="Advertisement — visit the takeover sponsor">
            {/* eslint-disable-next-line @next/next/no-img-element -- full-bleed takeover banner, not a fixed-ratio card image */}
            <img src={mediaUrl(takeover.bannerPath)!} alt="" className="w-full" />
          </Link>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(takeover.bannerPath)!} alt="" data-part="takeover-banner" className="w-full" />
        )
      )}
      {/* The strip sits above the header on forge and below it on grid — the
          client's placement for each design, not an inconsistency. On grid it
          reads as the header's secondary nav; on forge it is the first thing
          on the page as before. */}
      {!isGrid && <IndustryBar industries={industries} tone="dark" />}
      <Header user={user} unread={unread} tone={isGrid ? "light" : "dark"} />
      {isGrid && <IndustryBar industries={industries} tone="grey" />}
      <main id="main" data-part="site-main" className="flex-1">{children}</main>
      <Footer />
      <CookieConsent />
    </div>
  );
}

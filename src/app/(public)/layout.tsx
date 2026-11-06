import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { GridSiteFooter } from "@/components/GridSiteFooter";
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
// PROTOTYPE (issue #59) — throwaway branch prototype-classic only.
import { classicVariant, CLASSIC_VARIANTS, VARIANT_NAMES } from "@/components/classic-prototype/variant";
import { ClassicHeader } from "@/components/classic-prototype/ClassicHeader";
import { ClassicFooter } from "@/components/classic-prototype/ClassicFooter";
import { PrototypeSwitcher } from "@/components/classic-prototype/PrototypeSwitcher";
import "./classic.prototype.css";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // The industry strip only exists while Jas has industries on for the public
  // site (feature flag industries_public); off, it isn't even fetched.
  const [user, takeover, industries, variant, proto] = await Promise.all([
    currentUser(),
    activeTakeover(),
    isFeatureEnabled("industries_public").then((on) => (on ? industryList() : [])),
    siteVariant(),
    classicVariant(),
  ]);

  // The header is one structure in two tones — grid's the light bar from the
  // client's comps, forge's near-black — with the menus right of the mark on
  // both. The footers still differ structurally. siteVariant() is
  // cache()-wrapped and the root layout already reads the same cookie, so this
  // costs nothing extra. Grid's chrome applies to every grid-mode route, not
  // just the homepage: there is one public layout, and a light homepage under
  // a near-black header was the thing to avoid.
  const isGrid = variant === "grid";
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
    <div style={style} data-classic={proto === "current" ? undefined : proto} className="flex min-h-full flex-1 flex-col">
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
      {/* The strip sits above the header on forge and below it on grid — the
          client's placement for each design, not an inconsistency. On grid it
          reads as the header's secondary nav; on forge it is the first thing
          on the page as before. */}
      {proto === "current" ? (
        <>
          {!isGrid && <IndustryBar industries={industries} tone="dark" />}
          <SiteHeader user={user} unread={unread} tone={isGrid ? "light" : "dark"} />
          {isGrid && <IndustryBar industries={industries} tone="grey" />}
        </>
      ) : (
        <>
          <ClassicHeader user={user} unread={unread} shape={proto === "B" ? "adapted" : "faithful"} />
          {proto === "B" && <IndustryBar industries={industries} tone="grey" />}
        </>
      )}
      <main id="main" className="relative flex-1">
        {proto === "A" && <ClassicStripes />}
        {children}
      </main>
      {proto === "current" ? <Footer /> : <ClassicFooter buttons={proto === "C" ? "ink" : "blue"} />}
      <PrototypeSwitcher variants={CLASSIC_VARIANTS} names={VARIANT_NAMES} current={proto} />
      <CookieConsent />
    </div>
  );
}

/* PROTOTYPE: the live site's big diagonal chevrons behind the top of the page (#dbdbdb on #e2e2e2). */
function ClassicStripes() {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-[-1] h-[900px] w-full" preserveAspectRatio="none" viewBox="0 0 1440 900">
      <path d="M0 0h260L760 450 260 900H0l500-450z M520 0h180l500 450-500 450H520l500-450z" fill="#dbdbdb" />
    </svg>
  );
}

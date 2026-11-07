import Image from "next/image";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { currentUser, isAdmin } from "@/lib/auth";
import { getLayout } from "@/lib/blocks/layouts";
import { adSlotKeys } from "@/lib/blocks/schema";
import { mediaUrl } from "@/lib/db/server";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { breadcrumbLd, localBusinessLd } from "@/lib/jsonld";
import { memberMetadata } from "@/lib/member-seo";
import { memberBySlug, publishedStories } from "@/lib/queries";
import { resolveRedirect } from "@/lib/redirects";
import { socialLinks } from "@/lib/social";
import { memberVideoList } from "@/lib/member-videos";
import { BlockRenderer } from "@/components/blocks/BlockRenderer";
import { JsonLd } from "@/components/JsonLd";
import { RichText } from "@/components/RichText";
import { MemberLinks } from "@/components/MemberLinks";
import { PinMap } from "@/components/PinMap";
import { MemberVideos } from "@/components/MemberVideos";

export const dynamic = "force-dynamic";

/**
 * Archived members are visible to admins only (fix list 72). Both entry points
 * have to ask — `generateMetadata` and the page body are separate invocations,
 * and a metadata call that skipped the check would leak an archived member's
 * name and description into the <title> and the OG tags of a page that 404s.
 * currentUser() is request-cached, so this is one session read per request.
 */
const viewerIsAdmin = async () => isAdmin(await currentUser());

export async function generateMetadata(props: PageProps<"/member/[slug]">) {
  const { slug } = await props.params;
  const [m, showIndustries] = await Promise.all([
    memberBySlug(slug, { includeArchived: await viewerIsAdmin() }),
    isFeatureEnabled("industries_public"),
  ]);
  // Industry stays out of the fallback description while hidden from the public.
  return memberMetadata(
    m && { ...m, industry: showIndustries ? m.industry : null, heroUrl: mediaUrl(m.hero_path), logoUrl: mediaUrl(m.logo_path) },
    slug,
  );
}

export default async function MemberPage(props: PageProps<"/member/[slug]">) {
  const { slug } = await props.params;
  const admin = await viewerIsAdmin();
  const [member, ctx, showIndustries] = await Promise.all([
    memberBySlug(slug, { includeArchived: admin }),
    requestContext(),
    isFeatureEnabled("industries_public"),
  ]);
  // renamed in the console? honour the recorded 301 before 404ing. serviceDb
  // because `redirects` has RLS on with no public policy; the extra query only
  // ever runs on a miss, never on the hot path.
  if (!member) {
    const moved = await resolveRedirect(`/member/${slug}`);
    if (moved?.permanent) permanentRedirect(moved.to);
    if (moved) redirect(moved.to);
    notFound();
  }

  const layout = await getLayout("member_profile", member.id);
  const [banners, { stories: latest }, logos, showPlaceholders] = await Promise.all([
    liveAdverts("banner"),
    layout.blocks.some((b) => b.type === "latest_news") ? publishedStories({ limit: 4 }) : Promise.resolve({ stories: [] }),
    layout.blocks.some((b) => b.type === "supplier_logos") ? liveAdverts("supplier_logo") : Promise.resolve([]),
    showAdPlaceholders(),
  ]);
  const slots = dealSlots(banners, adSlotKeys("member_profile", layout));

  // impressions come from the browser once seen — see AdCreative / /api/seen
  record([{ kind: "member_page_view", member_id: member.id, path: `/member/${slug}`, ...ctx }]);

  const socials = socialLinks(member.social);
  const hero = mediaUrl(member.hero_path);
  // Hidden from the page and its structured data while industries are off for the public.
  const industryName = showIndustries ? member.industry?.name : undefined;

  const profileMain = (
    <>
      <JsonLd
        data={[
          localBusinessLd({
            ...member,
            logoUrl: mediaUrl(member.logo_path),
            socialUrls: socials.map((s) => s.href).filter((h): h is string => Boolean(h)),
            industryName,
          }),
          breadcrumbLd([
            { name: "Members", path: "/member" },
            { name: member.name, path: `/member/${slug}` },
          ]),
        ]}
      />
      {/* Only ever reachable by an admin — a public read cannot return an
          archived row at all — but an admin looking at a page that nobody else
          can see needs telling, or the archive silently looks like a no-op. */}
      {member.archived_at && (
        <p data-part="form-notice" className="mt-6 rounded border border-line bg-shade px-4 py-2 text-sm text-graphite">
          <strong className="font-semibold text-ink">Archived.</strong> This page is hidden from the public site, from search and
          from the directory. You can see it because you are signed in as an admin.
        </p>
      )}
      {hero && (
        <div data-part="member-hero" className="relative mt-6 h-64 overflow-hidden rounded-t-xl">
          <Image src={hero} alt="" fill sizes="100vw" className="object-cover" unoptimized />
        </div>
      )}
      {/* Stacked on phones (#33): beside a 112px logo the name, address and
          services had ~178px, so the address ran to five lines. Stacked, the
          -mt-16 pull also lands the logo in the hero as intended. */}
      <header data-part="member-header" className={`relative z-10 ${hero ? "rounded-b-xl" : "mt-6 rounded-xl"} flex flex-col items-start gap-4 bg-white p-5 shadow-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-5 sm:p-6`}>
        {/* Logo overlaps up into the hero (a -mt-16 pull, plus relative z-10 on
            the header so it explicitly wins the stacking order rather than
            relying on DOM-order paint order — that was fragile enough to
            occasionally paint the logo behind the hero). Prominent position
            per fix list; the white ring reads against any hero photo. */}
        <div data-part="member-logo" className={hero ? "-mt-16 shrink-0" : "shrink-0"}>
          {member.logo_path ? (
            // Rounded box is bigger than the image inside it (112px box, 96px
            // image) so the corner radius only ever clips white background,
            // never the logo artwork — object-contain alone can letterbox a
            // non-square logo right up to the box's edges.
            <div className={`flex h-28 w-28 items-center justify-center rounded-xl bg-white ${hero ? "border-4 border-white shadow-md" : ""}`}>
              <Image src={mediaUrl(member.logo_path)!} alt="" width={96} height={96} className="object-contain" unoptimized />
            </div>
          ) : hero ? (
            <div className="flex h-28 w-28 items-center justify-center rounded-xl border-4 border-white bg-graphite/10 text-4xl text-graphite/30 shadow-md">⚙</div>
          ) : null}
        </div>
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <p data-part="card-meta" className="text-xs uppercase tracking-widest text-brand-text">SMI Member{industryName ? ` · ${industryName}` : ""}</p>
          <h1 data-part="page-title" className="break-words text-2xl font-bold text-ink">{member.name}</h1>
          <p data-part="member-address" className="text-sm text-graphite">{member.address}</p>
          {member.services.length > 0 && (
            <div data-part="member-services" className="mt-2 flex flex-wrap gap-1.5">
              {member.services.map((s) => (
                <span data-part="card-badge" key={s.slug} className="rounded-full bg-graphite/10 px-2.5 py-0.5 text-xs font-medium text-graphite">{s.name}</span>
              ))}
            </div>
          )}
        </div>
      </header>

      <div data-part="member-body" className="mt-6 grid items-stretch gap-6 lg:grid-cols-3">
        <div className="flex lg:col-span-2">
          {/* flex + w-full/flex-col so the visible card itself fills the
              grid-stretched row height (never shorter than the sidebar, can
              be taller) rather than just its invisible wrapper growing. */}
          <section data-part="panel" className="flex w-full flex-col rounded-lg bg-white p-6 shadow-sm">
            <h2 data-part="section-title" className="font-bold text-ink">About</h2>
            <RichText html={member.description} className="mt-2 text-ink" />
          </section>
        </div>
        <aside data-part="member-aside" className="flex flex-col gap-4">
          {/* Google Maps, the same map as the directory's Map view (PinMap).
              `!= null`, not truthiness — a longitude of 0 runs through
              Greenwich and London. */}
          {member.lat != null && member.lng != null && (
            <div data-part="map" className="overflow-hidden rounded-lg bg-white shadow-sm">
              <PinMap
                ariaLabel={`Map showing ${member.name}'s location`}
                pins={[{ href: `/member/${member.slug}`, label: member.name, lat: member.lat, lng: member.lng }]}
                zoom={13}
                heightClass="h-56"
                roundedClass=""
                scrollWheelZoom={false}
                popups={false}
              />
              <p data-part="card-meta" className="p-3 text-xs text-graphite">{member.address}</p>
            </div>
          )}
          {/* Website, phone and socials together, under the map — replaces
              the header Website/Call buttons. */}
          <MemberLinks member={member} />
        </aside>
      </div>
    </>
  );

  // Its own anchor rather than living inside profileMain (fix list): "big,
  // below the member's news". The company video leads, then the member's own
  // published SMI videos (GAPS A8.5) — one player, the reader picks.
  const videos = memberVideoList(member.video_url, member.videos);
  const profileVideo = videos.length ? <MemberVideos videos={videos} /> : null;

  return (
    <div data-part="member-page" className="mx-auto max-w-6xl px-4">
      <BlockRenderer
        pageType="member_profile"
        layout={layout}
        slots={slots}
        latestStories={latest}
        memberStories={member.stories}
        memberStoriesTotal={member.storyTotal}
        memberStoriesHref={`/news?member=${encodeURIComponent(slug)}#all-news`}
        memberName={member.name}
        supplierLogos={logos}
        showPlaceholders={showPlaceholders}
        path={`/member/${slug}`}
        anchors={{ profile_main: profileMain, profile_video: profileVideo }}
      />
      <div className="my-10" />
    </div>
  );
}

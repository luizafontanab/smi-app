import Image from "next/image";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { getLayout } from "@/lib/blocks/layouts";
import { adSlotKeys } from "@/lib/blocks/schema";
import { mediaUrl } from "@/lib/db/server";
import { breadcrumbLd, localBusinessLd } from "@/lib/jsonld";
import { memberBySlug, publishedStories } from "@/lib/queries";
import { resolveRedirect } from "@/lib/redirects";
import { excerptFromHtml } from "@/lib/sanitize";
import { socialLinks } from "@/lib/social";
import { BlockRenderer } from "@/components/blocks/BlockRenderer";
import { JsonLd } from "@/components/JsonLd";
import { RichText } from "@/components/RichText";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/member/[slug]">) {
  const { slug } = await props.params;
  const m = await memberBySlug(slug);
  const title = m?.name ?? "Member";
  const description = m?.description ? excerptFromHtml(m.description, 200) ?? undefined : undefined;
  const image = mediaUrl(m?.hero_path) ?? mediaUrl(m?.logo_path);
  return {
    title,
    description,
    alternates: { canonical: `/member/${slug}` },
    openGraph: {
      type: "profile",
      url: `/member/${slug}`,
      title,
      description,
      images: image ? [image] : undefined,
    },
    twitter: { card: "summary_large_image", title, description, images: image ? [image] : undefined },
  };
}

export default async function MemberPage(props: PageProps<"/member/[slug]">) {
  const { slug } = await props.params;
  const [member, ctx] = await Promise.all([memberBySlug(slug), requestContext()]);
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
  const yt = member.video_url?.match(/[?&]v=([\w-]+)/)?.[1];
  const hero = mediaUrl(member.hero_path);

  const profileMain = (
    <>
      <JsonLd
        data={[
          localBusinessLd({
            ...member,
            logoUrl: mediaUrl(member.logo_path),
            socialUrls: socials.map((s) => s.href).filter((h): h is string => Boolean(h)),
            categoryName: member.category?.name,
          }),
          breadcrumbLd([
            { name: "Members", path: "/member" },
            { name: member.name, path: `/member/${slug}` },
          ]),
        ]}
      />
      {hero && (
        <div className="relative mt-6 h-56 overflow-hidden rounded-xl">
          <Image src={hero} alt="" fill sizes="100vw" className="object-cover" unoptimized />
        </div>
      )}
      <header className={`${hero ? "mt-4" : "mt-6"} flex flex-wrap items-center gap-5 rounded-xl bg-white p-6 shadow-sm`}>
        {member.logo_path && <Image src={mediaUrl(member.logo_path)!} alt="" width={80} height={80} className="rounded-lg" unoptimized />}
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-widest text-brand-text">SMI Member{member.category ? ` · ${member.category.name}` : ""}</p>
          <h1 className="text-2xl font-bold text-ink">{member.name}</h1>
          <p className="text-sm text-graphite">{member.address}</p>
        </div>
        <div className="flex gap-2 text-sm">
          {member.website && <a href={`/go/${member.id}?kind=website`} target="_blank" rel="noopener" className="rounded bg-ink px-4 py-2 text-white">Website</a>}
          {member.phone && <a href={`/go/${member.id}?kind=phone`} className="rounded border px-4 py-2">Call</a>}
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <section className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="font-bold text-ink">About</h2>
            <RichText html={member.description} className="mt-2 text-ink" />
          </section>
          {yt && (
            <section className="mt-6 overflow-hidden rounded-lg bg-white shadow-sm">
              <iframe className="aspect-video w-full" src={`https://www.youtube-nocookie.com/embed/${yt}`} title="Company video" allowFullScreen />
            </section>
          )}
        </div>
        <aside className="flex flex-col gap-4">
          {member.lat && member.lng && (
            <div className="overflow-hidden rounded-lg bg-white shadow-sm">
              <iframe
                className="h-56 w-full"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${member.lng - 0.05}%2C${member.lat - 0.03}%2C${member.lng + 0.05}%2C${member.lat + 0.03}&layer=mapnik&marker=${member.lat}%2C${member.lng}`}
                title="Location map"
              />
              <p className="p-3 text-xs text-graphite">{member.address}</p>
            </div>
          )}
          {socials.length > 0 && (
            <div className="rounded-lg bg-white p-4 shadow-sm text-sm">
              <h3 className="font-bold text-ink">Follow</h3>
              <ul className="mt-2 space-y-1 text-graphite">
                {socials.map((s) => (
                  <li key={s.key} className="break-words">
                    {!s.href ? (
                      <>{s.label}: <span className="text-graphite">{s.value}</span></>
                    ) : s.handle ? (
                      <>{s.label}: <a href={`/go/${member.id}?kind=social&platform=${s.key}`} target="_blank" rel="noopener" className="hover:underline">{s.handle}</a></>
                    ) : (
                      <a href={`/go/${member.id}?kind=social&platform=${s.key}`} target="_blank" rel="noopener" className="hover:underline">{s.label}</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </>
  );

  return (
    <div className="mx-auto max-w-6xl px-4">
      <BlockRenderer
        pageType="member_profile"
        layout={layout}
        slots={slots}
        latestStories={latest}
        memberStories={member.stories}
        memberName={member.name}
        supplierLogos={logos}
        showPlaceholders={showPlaceholders}
        anchors={{ profile_main: profileMain }}
      />
      <div className="my-10" />
    </div>
  );
}

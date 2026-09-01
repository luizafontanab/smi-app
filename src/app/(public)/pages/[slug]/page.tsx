import { notFound } from "next/navigation";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { getLayout } from "@/lib/blocks/layouts";
import { adSlotKeys } from "@/lib/blocks/schema";
import { stripTags } from "@/lib/jsonld";
import { publishedStories, staticPage } from "@/lib/queries";
import { BlockRenderer } from "@/components/blocks/BlockRenderer";
import { RichText } from "@/components/RichText";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/pages/[slug]">) {
  const { slug } = await props.params;
  const page = await staticPage(slug);
  const title = page?.title ?? "Page";
  const description = page?.body ? stripTags(page.body).slice(0, 160) : undefined;
  return {
    title,
    description,
    alternates: { canonical: `/pages/${slug}` },
    openGraph: { url: `/pages/${slug}`, title, description },
  };
}

export default async function StaticPage(props: PageProps<"/pages/[slug]">) {
  const { slug } = await props.params;
  const [page, ctx] = await Promise.all([staticPage(slug), requestContext()]);
  if (!page) notFound();

  // Layout override is keyed on the surrogate uuid, not the slug — renaming a
  // page must not silently drop the arrangement an editor built for it.
  const layout = await getLayout("static_page", page.id);
  const [banners, { stories: latest }, logos, showPlaceholders] = await Promise.all([
    liveAdverts("banner"),
    layout.blocks.some((b) => b.type === "latest_news") ? publishedStories({ limit: 4 }) : Promise.resolve({ stories: [] }),
    layout.blocks.some((b) => b.type === "supplier_logos") ? liveAdverts("supplier_logo") : Promise.resolve([]),
    showAdPlaceholders(),
  ]);
  const slots = dealSlots(banners, adSlotKeys("static_page", layout));
  record([{ kind: "page_view", path: `/pages/${slug}`, ...ctx }]);

  const pageMain = (
    <>
      <h1 className="mt-6 text-2xl font-bold text-ink">{page.title}</h1>
      <RichText html={page.body} className="mt-4 rounded-lg bg-white p-6 shadow-sm" />
    </>
  );

  return (
    <div className="mx-auto max-w-3xl px-4">
      <BlockRenderer
        pageType="static_page"
        layout={layout}
        slots={slots}
        latestStories={latest}
        supplierLogos={logos}
        showPlaceholders={showPlaceholders}
        anchors={{ page_main: pageMain }}
      />
      <div className="my-10" />
    </div>
  );
}

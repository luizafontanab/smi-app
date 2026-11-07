import { notFound, redirect } from "next/navigation";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { industries as industryList, industryBySlug } from "@/lib/queries";
import { IndustryView } from "@/components/design-option";
import { loadIndustryHub } from "@/lib/industry-hub";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/industry/[slug]">) {
  const { slug } = await props.params;
  if (!(await isFeatureEnabled("industries_public"))) return {};
  // cache()d, so this costs nothing on top of the page body's own lookup.
  const ind = await industryBySlug(slug);
  return {
    title: ind ? ind.name : "Industry",
    description: ind ? `News, members, videos and events from the UK ${ind.name.toLowerCase()} industry.` : undefined,
    alternates: { canonical: `/industry/${slug}` },
  };
}

export default async function IndustryPage(props: PageProps<"/industry/[slug]">) {
  const { slug } = await props.params;
  // Industries hidden from the public (flag industries_public): an old link —
  // a bookmark, a search result — lands on News instead of an error. redirect()
  // is a 307, so nothing is cached as permanent and turning the flag back on
  // restores the page.
  if (!(await isFeatureEnabled("industries_public"))) redirect("/news");
  // The industry list rides along for an option that lets the reader switch
  // topic from the page (Classic's Topics select, #76). One ten-row read, in
  // parallel with the hub; Current's view ignores it.
  const [hub, industries] = await Promise.all([loadIndustryHub(slug), industryList()]);
  if (!hub) notFound();
  // Rendered through the design-option hook point, never directly (#69).
  return <IndustryView slug={slug} hub={hub} industries={industries} />;
}

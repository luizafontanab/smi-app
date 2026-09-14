import Link from "next/link";
import { notFound } from "next/navigation";
import { record, requestContext } from "@/lib/analytics";
import { industries, storiesByIndustry } from "@/lib/queries";
import { Pagination } from "@/components/Pagination";
import { StoryCard } from "@/components/StoryCard";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 12;

export async function generateMetadata(props: PageProps<"/industry/[slug]">) {
  const { slug } = await props.params;
  const ind = (await industries()).find((i) => i.slug === slug);
  return {
    title: ind ? `${ind.name} News` : "Industry News",
    description: ind ? `The latest news from the ${ind.name} industry.` : undefined,
    alternates: { canonical: `/industry/${slug}` },
  };
}

export default async function IndustryPage(props: PageProps<"/industry/[slug]">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const [result, ctx] = await Promise.all([
    storiesByIndustry(slug, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    requestContext(),
  ]);
  if (!result) notFound();
  const { industry, stories, total } = result;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  record([{ kind: "page_view", path: `/industry/${slug}`, ...ctx }]);

  return (
    <div className="mx-auto max-w-6xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-ink">{industry.name} News</h1>
      <p className="mt-1 text-sm text-graphite">
        {total} {total === 1 ? "story" : "stories"} in {industry.name} ·{" "}
        <Link href={`/member?industry=${industry.slug}`} className="underline hover:no-underline">See the members</Link>
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stories.map((s) => <StoryCard key={s.id} story={s} />)}
      </div>
      {stories.length === 0 && (
        <p className="mt-10 text-center text-graphite">No stories in {industry.name} yet.</p>
      )}

      <Pagination page={page} pages={pages} hrefFor={(p) => (p > 1 ? `/industry/${slug}?page=${p}` : `/industry/${slug}`)} />
      <div className="my-10" />
    </div>
  );
}

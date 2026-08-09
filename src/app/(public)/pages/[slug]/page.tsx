import { notFound } from "next/navigation";
import { record, requestContext } from "@/lib/analytics";
import { staticPage } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function StaticPage(props: PageProps<"/pages/[slug]">) {
  const { slug } = await props.params;
  const [page, ctx] = await Promise.all([staticPage(slug), requestContext()]);
  if (!page) notFound();
  record([{ kind: "page_view", path: `/pages/${slug}`, ...ctx }]);
  return (
    <div className="mx-auto max-w-3xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-navy">{page.title}</h1>
      <div className="story-body mt-4 rounded-lg bg-white p-6 shadow-sm" dangerouslySetInnerHTML={{ __html: page.body }} />
      <div className="my-10" />
    </div>
  );
}

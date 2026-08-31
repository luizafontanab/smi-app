import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { record, requestContext } from "@/lib/analytics";
import { mediaUrl } from "@/lib/db/server";
import { focusStyle } from "@/lib/focus";
import { newsletterBySlug } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function NewsletterIssuePage(props: PageProps<"/newsletters/[slug]">) {
  const { slug } = await props.params;
  const [issue, ctx] = await Promise.all([newsletterBySlug(slug), requestContext()]);
  if (!issue) notFound();
  record([{ kind: "page_view", path: `/newsletters/${slug}`, ...ctx }]);

  return (
    <div className="mx-auto max-w-3xl px-4">
      <header className="mt-6 rounded-t-xl bg-ink p-6 text-white">
        <p className="text-xs uppercase tracking-widest text-brand">SMI Monthly · Issue {issue.number}</p>
        <h1 className="mt-1 text-2xl font-bold">{issue.subject}</h1>
        {issue.intro && <p className="mt-2 text-white/80">{issue.intro}</p>}
      </header>
      <div className="space-y-4 rounded-b-xl bg-white p-6 shadow-sm">
        {issue.items.map(({ story, position }) => story && (
          <Link key={position} href={`/news/${story.slug}`} className="flex gap-4 rounded-lg border p-3 hover:border-ink">
            {story.cover_path && (
              <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded">
                <Image src={mediaUrl(story.cover_path)!} alt="" fill sizes="112px" style={focusStyle(story.cover_focus)} className="object-cover" unoptimized />
              </div>
            )}
            <div>
              <p className="font-semibold leading-snug">{story.title}</p>
              {story.excerpt && <p className="mt-1 text-xs text-gray-500 line-clamp-2">{story.excerpt}</p>}
            </div>
          </Link>
        ))}
      </div>
      <div className="my-10" />
    </div>
  );
}

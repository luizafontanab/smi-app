import { notFound } from "next/navigation";
import { record, requestContext } from "@/lib/analytics";
import { issueExtras } from "@/lib/newsletter-extras";
import { newsletterBySlug } from "@/lib/queries";
import { NewsletterIssueView } from "@/components/design-option";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/newsletters/[slug]">) {
  const { slug } = await props.params;
  const issue = await newsletterBySlug(slug).catch(() => null);
  const title = issue ? `SMI Monthly · Issue ${issue.number} — ${issue.subject}` : "Newsletter";
  const description = issue?.intro ?? undefined;
  return {
    title,
    description,
    alternates: { canonical: `/newsletters/${slug}` },
    openGraph: { url: `/newsletters/${slug}`, title, description },
  };
}

/**
 * The web copy of a sent issue. The layout itself is the design option's
 * NewsletterIssueView, rendered through the hook point, never directly (#69).
 */
export default async function NewsletterIssuePage(props: PageProps<"/newsletters/[slug]">) {
  const { slug } = await props.params;
  const [issue, ctx] = await Promise.all([newsletterBySlug(slug), requestContext()]);
  if (!issue) notFound();
  const extras = await issueExtras(issue.id, issue.scheduled_at ?? issue.sent_at);
  record([{ kind: "page_view", path: `/newsletters/${slug}`, ...ctx }]);
  return <NewsletterIssueView issue={issue} extras={extras} />;
}

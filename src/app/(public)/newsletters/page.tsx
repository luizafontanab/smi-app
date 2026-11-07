import Link from "next/link";
import { record, requestContext } from "@/lib/analytics";
import { sentNewsletters } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Newsletters",
  description: "Read every issue of SMI Monthly — the newsletter of the UK sheet metal, fabrication and welding trade.",
  alternates: { canonical: "/newsletters" },
};

export default async function NewslettersPage() {
  const [issues, ctx] = await Promise.all([sentNewsletters(), requestContext()]);
  record([{ kind: "page_view", path: "/newsletters", ...ctx }]);
  return (
    <div data-part="newsletter-list-page" className="mx-auto max-w-4xl px-4">
      <h1 data-part="page-title" className="mt-6 text-2xl font-bold text-ink">Newsletter archive</h1>
      <div data-part="card-grid" className="mt-6 space-y-3">
        {issues.map((i) => (
          <Link data-part="newsletter-issue-card" key={i.number} href={`/newsletters/${i.web_slug}`} className="block rounded-lg bg-white p-5 shadow-sm hover:shadow-md">
            <p data-part="card-meta" className="text-xs uppercase text-graphite">
              Issue {i.number} · {i.sent_at && new Date(i.sent_at).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Europe/London" })}
            </p>
            <p data-part="card-title" className="mt-1 font-bold text-ink">{i.subject}</p>
            {i.intro && <p data-part="card-excerpt" className="mt-1 text-sm text-graphite line-clamp-2">{i.intro}</p>}
          </Link>
        ))}
      </div>
      <div className="my-10" />
    </div>
  );
}

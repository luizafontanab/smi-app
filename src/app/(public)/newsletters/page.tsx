import Link from "next/link";
import { record, requestContext } from "@/lib/analytics";
import { sentNewsletters } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Newsletters" };

export default async function NewslettersPage() {
  const [issues, ctx] = await Promise.all([sentNewsletters(), requestContext()]);
  record([{ kind: "page_view", path: "/newsletters", ...ctx }]);
  return (
    <div className="mx-auto max-w-4xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-navy">Newsletter archive</h1>
      <div className="mt-6 space-y-3">
        {issues.map((i) => (
          <Link key={i.number} href={`/newsletters/${i.web_slug}`} className="block rounded-lg bg-white p-5 shadow-sm hover:shadow-md">
            <p className="text-xs uppercase text-gray-400">
              Issue {i.number} · {i.sent_at && new Date(i.sent_at).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
            </p>
            <p className="mt-1 font-bold text-navy">{i.subject}</p>
            {i.intro && <p className="mt-1 text-sm text-gray-600 line-clamp-2">{i.intro}</p>}
          </Link>
        ))}
      </div>
      <div className="my-10" />
    </div>
  );
}

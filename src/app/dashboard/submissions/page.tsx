import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { pendingSubmissions } from "@/lib/submissions";
import { SubmissionList } from "@/components/dashboard/SubmissionList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your submissions" };

/**
 * Every submission still waiting on the editor — the "See all" behind the
 * dashboard's "Your submissions" box (fix list item 34), mirroring how
 * "Recent updates" opens out onto /dashboard/notifications.
 */
export default async function SubmissionsPage() {
  const user = await requireMember();
  const { items, total } = await pendingSubmissions(user.memberId);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-ink">
          Your submissions{total > 0 && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-ink">{total}</span>}
        </h1>
        <Link href="/dashboard/story/new" className="text-sm text-graphite underline">Add content →</Link>
      </div>
      <p className="mt-1 text-sm text-graphite">
        Stories, videos, events and equipment you&apos;ve sent in that aren&apos;t live yet. Anything sent back can be edited and resubmitted.
      </p>
      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        {items.length === 0 && <p className="text-sm text-graphite">Nothing awaiting approval.</p>}
        <SubmissionList items={items} flush />
      </section>
    </div>
  );
}

import Link from "next/link";
import { requireMemberView } from "@/lib/auth";
import { CONTENT_FILTERS, isContentFilter, memberContent, type ContentFilter } from "@/lib/submissions";
import { SubmissionList } from "@/components/dashboard/SubmissionList";
import { SectionTabs } from "@/components/dashboard/SectionTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your content" };

const TABS = [
  { key: "all", label: "All" },
  { key: "drafts", label: "Drafts" },
  { key: "pending", label: "Awaiting approval" },
  { key: "published", label: "Live" },
  { key: "attention", label: "Needs attention" },
] as const satisfies readonly { key: ContentFilter; label: string }[];

const EMPTY: Record<ContentFilter, string> = {
  all: "You haven't added any content yet.",
  drafts: "No drafts. Use “Save draft” on a new story to keep working on it before you submit.",
  pending: "Nothing awaiting approval.",
  published: "Nothing of yours is live yet.",
  attention: "Nothing needs your attention.",
};

/**
 * Everything a member has created, across news, videos, events and equipment.
 *
 * Was "Your submissions" and showed only the pre-approval queue, so once
 * something went live the member could not see it here or anywhere else in the
 * member area (fix list). It keeps the same URL rather than moving to
 * /dashboard/content: the dashboard box's "See all" link, the visual manifest
 * and the e2e specs all already point here, and two near-identical list pages
 * would be worse than one with tabs.
 */
export default async function SubmissionsPage(props: PageProps<"/dashboard/submissions">) {
  const user = await requireMemberView();
  const sp = await props.searchParams;
  const filter: ContentFilter = typeof sp.status === "string" && isContentFilter(sp.status) ? sp.status : "all";
  const { items } = await memberContent(user.memberId, { statuses: CONTENT_FILTERS[filter] });

  return (
    <div className="max-w-2xl lg:mx-auto">
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-ink">
          Your content
        </h1>
        <Link href="/dashboard/story/new" className="text-sm text-graphite underline">Add content →</Link>
      </div>
      <p className="mt-1 text-sm text-graphite">
        Everything you&apos;ve sent in — news, videos, events and equipment. Anything sent back can be edited and
        resubmitted; anything live can be viewed, or you can ask us to change it.
      </p>

      <SectionTabs
        items={TABS.map((t) => ({
          ...t,
          href: t.key === "all" ? "/dashboard/submissions" : `/dashboard/submissions?status=${t.key}`,
        }))}
        active={filter}
        ariaLabel="Content status"
      />

      {typeof sp.error === "string" && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      {sp.deleted === "draft" && (
        <p role="status" className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Draft deleted.</p>
      )}
      {sp.requested === "1" && (
        <p className="mt-3 rounded bg-brand/10 p-2 text-sm text-graphite">
          Thanks — your change request is with the SMI editor. Your page stays live in the meantime.
        </p>
      )}

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        {items.length === 0 && <p className="text-sm text-graphite">{EMPTY[filter]}</p>}
        <SubmissionList items={items} flush filter={filter} />
      </section>
    </div>
  );
}

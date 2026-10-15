import Link from "next/link";
import { Badge } from "@/components/console/ui";
import { Pagination } from "@/components/Pagination";
import {
  LIST_STATUSES,
  STORY_LIST_PAGE_SIZE,
  STORY_STATUS_LABELS,
  storyEditorHrefFromList,
  storyListHref,
  type ListStatus,
  type StoryListFilters,
} from "@/lib/story-board";

export type ListStory = {
  id: string;
  title: string;
  status: string;
  source: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  updated_at: string;
  member?: { name: string } | null;
};

const STATUS_TONE: Record<string, "neutral" | "brand" | "green" | "red"> = {
  awaiting_approval: "brand",
  published: "green",
  rejected: "red",
};

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

/**
 * Story Engine as a table (fix-list 75). Every status, newest edit first, 50 a
 * page — the board caps its columns and never shows rejected or withdrawn
 * stories, so this is the view for finding one.
 */
export function StoryList({ stories, total, filters }: { stories: ListStory[]; total: number; filters: StoryListFilters }) {
  const pages = Math.max(1, Math.ceil(total / STORY_LIST_PAGE_SIZE));
  const chips: (ListStatus | "all")[] = ["all", ...LIST_STATUSES];

  return (
    <section className="mt-5 rounded-xl bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-graphite">{total.toLocaleString("en-GB")} {total === 1 ? "story" : "stories"}</p>
        <div className="flex flex-wrap gap-1 text-xs">
          {chips.map((s) => (
            <Link
              key={s}
              href={storyListHref(filters, { status: s, page: 1 })}
              aria-current={s === filters.status ? "page" : undefined}
              className={`rounded px-2 py-1 ${s === filters.status ? "bg-ink font-semibold text-white" : "text-graphite hover:text-ink"}`}
            >
              {s === "all" ? "All" : STORY_STATUS_LABELS[s]}
            </Link>
          ))}
        </div>
      </div>

      {stories.length === 0 ? (
        <p className="mt-4 text-sm text-graphite">
          {filters.status === "all" ? "No stories yet." : `No ${STORY_STATUS_LABELS[filters.status].toLowerCase()} stories.`}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs uppercase text-graphite">
                <th scope="col" className="py-1">Title</th>
                <th scope="col">Member</th>
                <th scope="col">Status</th>
                <th scope="col">Goes / went live</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {stories.map((s) => (
                <tr key={s.id} className="border-t align-top">
                  <td className="py-1.5 pr-3">
                    <Link href={storyEditorHrefFromList(s.id, filters)} className="font-medium text-ink hover:underline">
                      {s.title || "(untitled)"}
                    </Link>
                  </td>
                  <td className="text-graphite">{s.member?.name ?? (s.source === "admin" ? "SMI" : "—")}</td>
                  <td>
                    <Badge tone={STATUS_TONE[s.status] ?? "neutral"}>
                      {STORY_STATUS_LABELS[s.status as ListStatus] ?? s.status}
                    </Badge>
                  </td>
                  <td className="text-xs text-graphite">{date(s.status === "scheduled" ? s.scheduled_at : s.published_at)}</td>
                  <td className="text-xs text-graphite">{date(s.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={filters.page} pages={pages} hrefFor={(p) => storyListHref(filters, { page: p })} />
    </section>
  );
}

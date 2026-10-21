import Link from "next/link";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { pagedList } from "../paged-list";
import { requireConsole } from "@/lib/auth";
import { saveSocialCaps, saveSocialChannels } from "../actions";
import { DEFAULT_SOCIAL_CAPS, type SocialCaps } from "@/lib/social-caps";
import { readSocialChannels } from "@/lib/social-channels";
import { CalendarView, monthGrid, parseMonth, type CalendarStory } from "./CalendarView";
import { StoryBoard } from "./StoryBoard";
import { StoryList, type ListStory } from "./StoryList";
import { parseStoryListFilters, parseStoryView, STORY_LIST_PAGE_SIZE, storyListHref } from "@/lib/story-board";

export const dynamic = "force-dynamic";

const TABS = [
  { view: "board", label: "Board" },
  { view: "calendar", label: "Calendar" },
  { view: "list", label: "List" },
] as const;

const TAB_HREF = { board: "/console/stories", calendar: "/console/stories?view=calendar" } as const;

// FK named: story_members makes a bare `members` embed ambiguous on stories.
const SELECT = "id, title, status, source, scheduled_at, published_at, pinned_until, member:members!stories_member_id_fkey(name)";

export default async function StoriesPage(props: PageProps<"/console/stories">) {
  await requireConsole();
  const sp = await props.searchParams;
  const view = parseStoryView(sp.view);
  const listFilters = parseStoryListFilters(sp);
  const month = parseMonth(typeof sp.month === "string" ? sp.month : undefined);
  const db = serviceDb();

  // The board's "most recently touched 120" is the wrong window for a calendar —
  // a story scheduled months out can fall outside it. Query by date range instead.
  const { start, end } = monthGrid(month);
  const [stories, capsSetting, channelsSetting, list] = await Promise.all([
    view === "list" ? Promise.resolve(null) : must(
      view === "calendar"
        ? db
            .from("stories")
            .select(SELECT)
            // A member's own draft is never the desk's to see (lib/story-board
            // isMemberDraft) — it can't be scheduled or published while it is
            // one, but the filter states that rather than relying on it.
            .eq("member_draft", false)
            .or(
              `and(status.eq.scheduled,scheduled_at.gte.${start.toISOString()},scheduled_at.lt.${end.toISOString()}),` +
              `and(status.eq.published,published_at.gte.${start.toISOString()},published_at.lt.${end.toISOString()})`,
            )
        : db
            .from("stories")
            .select(SELECT)
            .eq("member_draft", false)
            .order("updated_at", { ascending: false })
            .limit(120),
      "console/stories list",
    ),
    must(db.from("settings").select("value").eq("key", "social_caps").maybeSingle(), "console/stories social caps"),
    must(db.from("settings").select("value").eq("key", "social_channels").maybeSingle(), "console/stories social channels"),
    // The list's own window: every status, paged by count — the board's
    // "120 most recently touched" would hide everything older.
    // A page past the end (pagedList) shows the last page rather than failing.
    view === "list"
      ? pagedList((from, to) => {
          let q = db.from("stories").select(`${SELECT}, updated_at`, { count: "exact" }).eq("member_draft", false);
          if (listFilters.status !== "all") q = q.eq("status", listFilters.status);
          return q.order("updated_at", { ascending: false }).range(from, to);
        }, listFilters.page, STORY_LIST_PAGE_SIZE, "console/stories list view")
      : Promise.resolve(null),
  ]);
  const caps: SocialCaps = { ...DEFAULT_SOCIAL_CAPS, ...(capsSetting?.value as Partial<SocialCaps> | null) };
  const channels = readSocialChannels(channelsSetting?.value);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Story Engine</h1>
        <Link href="/console/stories/new" className="rounded bg-ink px-4 py-2 text-sm text-white">+ New story</Link>
      </div>
      {/* A refused board move (setStoryStatus) or an editor that sent Jas back here. */}
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      <p className="mt-1 text-sm text-graphite">
        Nothing publishes without approval. New articles found on company news pages are in{" "}
        <Link href="/console/sources" className="underline hover:text-ink">Story sources</Link>.
      </p>

      <div className="mt-4 flex gap-1 border-b text-sm">
        {TABS.map((t) => (
          <Link
            key={t.view}
            href={t.view === "list" ? storyListHref({ status: "all", page: 1 }) : TAB_HREF[t.view]}
            aria-current={t.view === view ? "page" : undefined}
            className={`rounded-t px-4 py-2 ${t.view === view ? "border border-b-0 bg-white font-semibold text-ink" : "text-graphite hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {view === "list" ? (
        <StoryList stories={(list?.data ?? []) as ListStory[]} total={list?.count ?? 0} filters={{ ...listFilters, page: list?.page ?? listFilters.page }} />
      ) : view === "calendar" ? (
        <CalendarView month={month} stories={(stories ?? []) as CalendarStory[]} />
      ) : (
        <StoryBoard stories={stories ?? []} />
      )}

      <section className="mt-6 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold text-ink">Social push settings</h2>
        <p className="mt-1 text-xs text-graphite">How many auto-posts go out a day (UK day, stories and videos together), and how long after going live a story or video posts when its editor leaves &quot;Post at&quot; empty.</p>
        <form action={saveSocialCaps} className="mt-2 flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col">
            Per day
            <input type="number" name="per_day" min={1} defaultValue={caps.per_day} className="mt-1 w-20 rounded border px-2 py-1" />
          </label>
          <label className="flex flex-col">
            Delay (minutes)
            <input type="number" name="delay_minutes" min={0} defaultValue={caps.delay_minutes} className="mt-1 w-24 rounded border px-2 py-1" />
          </label>
          <button className="rounded bg-ink px-4 py-2 text-white">Save</button>
        </form>

        <h2 className="mt-5 text-sm font-bold text-ink">Buffer channels</h2>
        <p className="mt-1 text-xs text-graphite">
          Which connected Buffer channels auto-posts go to — Buffer sends one post per channel, with no &quot;post everywhere&quot; default, so this must be set before any post can send.
        </p>
        {channels.legacyProfileIds.length > 0 && (
          <p className="mt-2 rounded bg-danger/10 p-2 text-xs text-danger">
            The saved ids ({channels.legacyProfileIds.join(", ")}) are Buffer v1 <em>profile</em> ids. The current
            Buffer API does not accept them — re-enter them as channel ids, or no post will send.
          </p>
        )}
        <form action={saveSocialChannels} className="mt-2 flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-1 flex-col">
            Channel IDs (one per line, or comma-separated)
            <textarea
              name="channel_ids"
              rows={2}
              defaultValue={channels.channelIds.join("\n")}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col">
            Organisation ID (optional)
            <input
              type="text"
              name="organization_id"
              defaultValue={channels.organizationId ?? ""}
              className="mt-1 w-56 rounded border px-2 py-1"
            />
          </label>
          <button className="rounded bg-ink px-4 py-2 text-white">Save</button>
        </form>
      </section>
    </div>
  );
}

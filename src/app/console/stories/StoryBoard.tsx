"use client";

import Link from "next/link";
import { startTransition, useState } from "react";
import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BOARD_STATUSES, isBoardStatus, LEGAL_STORY_MOVES, type BoardStatus } from "@/lib/story-board";
import { decideStory, moveStory, pinStory, setStoryStatus } from "../actions";

export type BoardStory = {
  id: string;
  title: string;
  status: string;
  source: string;
  scheduled_at: string | null;
  pinned_until: string | null;
  member?: { name: string } | null;
};

const COLUMN_LABELS: Record<BoardStatus, string> = {
  awaiting_approval: "Awaiting approval",
  draft: "Drafts",
  scheduled: "Scheduled",
  published: "Published",
};

const COLUMN_CAP: Partial<Record<BoardStatus, number>> = { published: 10, draft: 30, awaiting_approval: 30, scheduled: 30 };

/**
 * Kanban board with drag-and-drop status moves (A1.10). Modelled on
 * console/dev/DevBoard.tsx — same sensors, same closestCorners collision
 * detection (cross-column dropping needs it over closestCenter), same
 * per-card <select> fallback for keyboard/no-JS. Diverges in one way:
 * moveStory can reject a move (see LEGAL_STORY_MOVES), so a rejected drop
 * must revert the optimistic UI and surface why — DevBoard's moveDevTask
 * never fails, so it has no equivalent of `error`/revert here.
 *
 * There is no persisted order within a column (stories has no sort_order,
 * unlike dev_tasks) — the board sorts by updated_at, which a status change
 * already bumps, so a column re-syncs to that order after the drop settles.
 */
export function StoryBoard({ stories: initial }: { stories: BoardStory[] }) {
  const [stories, setStories] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setStories(initial);
  }
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function columnOf(status: BoardStatus) {
    return stories.filter((s) => s.status === status);
  }

  function applyStatus(id: string, status: BoardStatus) {
    setStories((ss) => ss.map((s) => (s.id === id ? { ...s, status } : s)));
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const overId = String(over.id);
    const overStory = stories.find((s) => s.id === overId);
    const targetStatus = overStory ? overStory.status : overId;
    if (!isBoardStatus(targetStatus)) return;

    const story = stories.find((s) => s.id === String(active.id));
    if (!story || story.status === targetStatus) return;
    const fromStatus = story.status;

    setError(null);
    applyStatus(story.id, targetStatus);
    startTransition(() => {
      void moveStory({ id: story.id, to: targetStatus }).then((res) => {
        if (!res.ok) {
          if (isBoardStatus(fromStatus)) applyStatus(story.id, fromStatus);
          setError(res.error ?? "That move isn't allowed.");
        }
      });
    });
  }

  return (
    <div>
      {error && (
        <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-600">
          {error} <button type="button" onClick={() => setError(null)} className="underline">dismiss</button>
        </p>
      )}
      {/*
        Explicit id: dnd-kit's aria-describedby id otherwise falls back to a
        module-level counter (@dnd-kit/utilities' useUniqueId) that isn't
        reset per server request, so it drifts from a fresh client's count
        and throws a hydration-mismatch warning after this server has
        rendered more than one DndContext-bearing page. A stable id sidesteps
        the counter entirely.
      */}
      <DndContext id="story-board" sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div className="mt-5 grid gap-4 lg:grid-cols-4">
          {BOARD_STATUSES.map((status) => {
            const items = columnOf(status);
            const cap = COLUMN_CAP[status] ?? items.length;
            const visible = items.slice(0, cap);
            return <Column key={status} status={status} items={visible} total={items.length} />;
          })}
        </div>
      </DndContext>
    </div>
  );
}

function Column({ status, items, total }: { status: BoardStatus; items: BoardStory[]; total: number }) {
  const { setNodeRef } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className="rounded-xl bg-white p-3 shadow-sm">
      <h2 className="px-1 text-sm font-bold uppercase tracking-wide text-gray-500">
        {COLUMN_LABELS[status]} <span className="text-gray-500">({total})</span>
      </h2>
      <SortableContext items={items.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <div className="mt-2 space-y-2">
          {items.map((s) => <StoryCard key={s.id} story={s} />)}
          {items.length === 0 && <p className="px-1 text-xs text-gray-500">Empty</p>}
          {total > items.length && <p className="px-1 text-xs text-gray-500">+{total - items.length} more</p>}
        </div>
      </SortableContext>
    </div>
  );
}

function StoryCard({ story }: { story: BoardStory }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: story.id });
  const status = isBoardStatus(story.status) ? story.status : "draft";
  const isPinned = story.pinned_until != null && new Date(story.pinned_until) > new Date();

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded border p-2.5 text-sm ${isDragging ? "bg-white opacity-60 shadow-lg" : "bg-white"}`}
    >
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Move ${story.title}`}
          className="mt-0.5 cursor-grab rounded px-1 text-gray-500 hover:bg-gray-100 focus:outline focus:outline-2 focus:outline-ink"
        >
          ⠿
        </button>
        <Link href={`/console/stories/${story.id}`} className="font-medium leading-snug hover:text-graphite">
          {story.title}
        </Link>
      </div>
      <p className="mt-1 pl-6 text-xs text-gray-500">
        {story.member?.name && <>{story.member.name} · </>}{story.source}
        {story.scheduled_at && story.status === "scheduled" && <> · {new Date(story.scheduled_at).toLocaleString("en-GB")}</>}
        {isPinned && <> · 📌 pinned</>}
      </p>

      {story.status === "awaiting_approval" && (
        <div className="mt-2 flex gap-2 pl-6">
          <form action={decideStory}>
            <input type="hidden" name="id" value={story.id} />
            <input type="hidden" name="decision" value="approve" />
            <button className="rounded bg-green-600 px-2.5 py-1 text-xs text-white">Approve</button>
          </form>
          <Link href={`/console/stories/${story.id}`} className="rounded border px-2.5 py-1 text-xs">Review</Link>
        </div>
      )}
      {story.status === "published" && (
        <form action={pinStory} className="mt-1.5 flex items-center gap-1 pl-6 text-xs">
          <input type="hidden" name="id" value={story.id} />
          {isPinned ? (
            <>
              <input type="hidden" name="days" value="0" />
              <button className="text-gray-500 hover:text-ink">Unpin</button>
            </>
          ) : (
            <>
              <span className="text-gray-500">📌 Pin</span>
              <input type="number" name="days" defaultValue={2} min={1} max={30} className="w-10 rounded border px-1 py-0.5" />
              <span className="text-gray-500">days</span>
              <button className="text-gray-500 hover:text-ink underline">Go</button>
            </>
          )}
        </form>
      )}

      <form action={setStoryStatus} className="mt-1.5 pl-6">
        <input type="hidden" name="id" value={story.id} />
        <select
          name="status"
          defaultValue={status}
          className="w-full rounded border px-1.5 py-0.5 text-xs"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          <option value={status}>{COLUMN_LABELS[status]}</option>
          {LEGAL_STORY_MOVES[status].map((to) => (
            <option key={to} value={to}>{COLUMN_LABELS[to]}</option>
          ))}
        </select>
        <noscript>
          <button className="mt-1 rounded border px-2 py-0.5 text-xs">Move</button>
        </noscript>
      </form>
    </div>
  );
}

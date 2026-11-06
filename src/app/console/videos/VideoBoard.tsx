"use client";

import { formatLondon } from "@/lib/london-time";
import Image from "next/image";
import Link from "next/link";
import { startTransition, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
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
import { BOARD_STATUSES, COLUMN_LABELS, isBoardStatus, LEGAL_VIDEO_MOVES, type BoardStatus } from "@/lib/video-board";
import { decideVideo, moveVideo, pinVideo, setVideoStatus } from "../actions";

export type BoardVideo = {
  id: string;
  title: string;
  status: string;
  source: string;
  scheduled_at: string | null;
  pinned_until: string | null;
  thumbnailUrl: string | null;
  member?: { name: string } | null;
};

const COLUMN_CAP: Partial<Record<BoardStatus, number>> = { published: 10, draft: 30, awaiting_approval: 30, scheduled: 30 };

/**
 * Video Engine kanban with drag-and-drop status moves (fix list). Straight
 * mirror of console/stories/StoryBoard.tsx — same sensors, same closestCorners
 * (cross-column dropping needs it over closestCenter), same optimistic-apply-
 * then-revert because moveVideo can reject a move, same per-card <select>
 * fallback for keyboard and no-JS.
 *
 * The one difference from StoryBoard: cards carry a thumbnail. The URL is
 * resolved server-side and passed in, because mediaUrl() reads server-only env.
 *
 * There is no persisted order within a column (videos has no sort_order) — the
 * board sorts by updated_at, which a status change bumps, so a column re-syncs
 * to that order once the drop settles.
 */
export function VideoBoard({ videos: initial }: { videos: BoardVideo[] }) {
  const [videos, setVideos] = useState(initial);
  // Re-sync after the server action's revalidatePath produces fresh props.
  // Adjusted during render (React's documented pattern), not in an effect.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setVideos(initial);
  }
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function columnOf(status: BoardStatus) {
    return videos.filter((v) => v.status === status);
  }

  function applyStatus(id: string, status: BoardStatus) {
    setVideos((vs) => vs.map((v) => (v.id === id ? { ...v, status } : v)));
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const overId = String(over.id);
    const overVideo = videos.find((v) => v.id === overId);
    const targetStatus = overVideo ? overVideo.status : overId;
    if (!isBoardStatus(targetStatus)) return;

    const video = videos.find((v) => v.id === String(active.id));
    if (!video || video.status === targetStatus) return;
    const fromStatus = video.status;

    setError(null);
    applyStatus(video.id, targetStatus);
    startTransition(() => {
      void moveVideo({ id: video.id, to: targetStatus }).then((res) => {
        if (!res.ok) {
          if (isBoardStatus(fromStatus)) applyStatus(video.id, fromStatus);
          setError(res.error ?? "That move isn't allowed.");
        } else {
          setAnnouncement(`${video.title} moved to ${COLUMN_LABELS[targetStatus]}`);
        }
      });
    });
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">
          {error} <button type="button" onClick={() => setError(null)} className="underline">dismiss</button>
        </p>
      )}
      <p aria-live="polite" className="sr-only">{announcement}</p>
      {/* Explicit id for the same hydration reason StoryBoard documents: dnd-kit's
          aria-describedby id otherwise comes from a module-level counter that
          isn't reset per server request, so it drifts from a fresh client's
          count once one server has rendered more than one board. */}
      <DndContext id="video-board" sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div className="mt-5 grid gap-4 lg:grid-cols-4">
          {BOARD_STATUSES.map((status) => {
            const items = columnOf(status);
            const cap = COLUMN_CAP[status] ?? items.length;
            return <Column key={status} status={status} items={items.slice(0, cap)} total={items.length} />;
          })}
        </div>
      </DndContext>
    </div>
  );
}

function Column({ status, items, total }: { status: BoardStatus; items: BoardVideo[]; total: number }) {
  const { setNodeRef } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className="rounded-xl bg-white p-3 shadow-sm">
      <h2 className="px-1 text-sm font-bold uppercase tracking-wide text-graphite">
        {COLUMN_LABELS[status]} <span className="text-graphite">({total})</span>
      </h2>
      <SortableContext items={items.map((v) => v.id)} strategy={verticalListSortingStrategy}>
        <div className="mt-2 space-y-2">
          {items.map((v) => <VideoCard key={v.id} video={v} />)}
          {items.length === 0 && <p className="px-1 text-xs text-graphite">Empty</p>}
          {total > items.length && <p className="px-1 text-xs text-graphite">+{total - items.length} more</p>}
        </div>
      </SortableContext>
    </div>
  );
}

function VideoCard({ video }: { video: BoardVideo }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: video.id });
  const status = isBoardStatus(video.status) ? video.status : "draft";
  const isPinned = video.pinned_until != null && new Date(video.pinned_until) > new Date();

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
          aria-label={`Move ${video.title}`}
          className="mt-0.5 cursor-grab rounded px-1 text-graphite hover:bg-shade focus:outline focus:outline-2 focus:outline-ink"
        >
          ⠿
        </button>
        {video.thumbnailUrl && (
          <Image src={video.thumbnailUrl} alt="" width={56} height={32} className="mt-0.5 h-8 w-14 shrink-0 rounded object-cover" unoptimized />
        )}
        <Link href={`/console/videos/${video.id}`} className="min-w-0 font-medium leading-snug hover:text-graphite">
          {video.title}
        </Link>
      </div>
      <p className="mt-1 pl-6 text-xs text-graphite">
        {video.member?.name && <>{video.member.name} · </>}{video.source}
        {video.scheduled_at && video.status === "scheduled" && <> · {formatLondon(video.scheduled_at)}</>}
        {isPinned && <> · 📌 pinned</>}
      </p>

      {video.status === "awaiting_approval" && (
        <div className="mt-2 flex gap-2 pl-6">
          <form action={decideVideo}>
            <input type="hidden" name="id" value={video.id} />
            <input type="hidden" name="decision" value="approve" />
            <SubmitButton pendingLabel="Approving…" className="rounded bg-success px-2.5 py-1 text-xs text-white">Approve</SubmitButton>
          </form>
          <Link href={`/console/videos/${video.id}`} className="rounded border px-2.5 py-1 text-xs">Review</Link>
        </div>
      )}
      {video.status === "published" && (
        <form action={pinVideo} className="mt-1.5 flex items-center gap-1 pl-6 text-xs">
          <input type="hidden" name="id" value={video.id} />
          {isPinned ? (
            <>
              <input type="hidden" name="days" value="0" />
              <SubmitButton pendingLabel="Unpinning…" className="text-graphite hover:text-ink">Unpin</SubmitButton>
            </>
          ) : (
            <>
              <span className="text-graphite">📌 Pin</span>
              <input type="number" name="days" defaultValue={2} min={1} max={30} aria-label="Days to pin" className="w-10 rounded border px-1 py-0.5" />
              <span className="text-graphite">days</span>
              <SubmitButton pendingLabel="Pinning…" className="text-graphite hover:text-ink underline">Go</SubmitButton>
            </>
          )}
        </form>
      )}

      <form action={setVideoStatus} className="mt-1.5 pl-6">
        <input type="hidden" name="id" value={video.id} />
        <select
          name="status"
          defaultValue={status}
          aria-label={`Move ${video.title} to column`}
          className="w-full rounded border px-1.5 py-0.5 text-xs"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          <option value={status}>{COLUMN_LABELS[status]}</option>
          {LEGAL_VIDEO_MOVES[status].map((to) => (
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

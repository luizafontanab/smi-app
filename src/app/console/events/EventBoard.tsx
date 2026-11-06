"use client";

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
import { BOARD_STATUSES, isBoardStatus, LEGAL_EVENT_MOVES, type BoardStatus } from "@/lib/event-board";
import { decideEvent, moveEvent, setEventStatus } from "../actions";

export type BoardEvent = {
  id: string;
  title: string;
  status: string;
  source: string;
  starts_on: string;
  coverUrl: string | null;
  member?: { name: string } | null;
};

const COLUMN_LABELS: Record<BoardStatus, string> = {
  awaiting_approval: "Awaiting approval",
  draft: "Drafts",
  published: "Published",
};

const COLUMN_CAP: Partial<Record<BoardStatus, number>> = { published: 10, draft: 30, awaiting_approval: 30 };

/**
 * Kanban board with drag-and-drop status moves, mirroring StoryBoard.tsx —
 * same sensors, same closestCorners collision detection, same per-card
 * <select> fallback for keyboard/no-JS. moveEvent can reject a move (see
 * LEGAL_EVENT_MOVES), so a rejected drop reverts the optimistic UI and
 * surfaces why.
 *
 * Cards carry a thumbnail, same as VideoBoard: the URL is resolved
 * server-side and passed in, because mediaUrl() reads server-only env.
 *
 * There is no persisted order within a column — the board sorts by
 * updated_at, which a status change already bumps.
 */
export function EventBoard({ events: initial }: { events: BoardEvent[] }) {
  const [events, setEvents] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setEvents(initial);
  }
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function columnOf(status: BoardStatus) {
    return events.filter((e) => e.status === status);
  }

  function applyStatus(id: string, status: BoardStatus) {
    setEvents((es) => es.map((e) => (e.id === id ? { ...e, status } : e)));
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const overId = String(over.id);
    const overEvent = events.find((e) => e.id === overId);
    const targetStatus = overEvent ? overEvent.status : overId;
    if (!isBoardStatus(targetStatus)) return;

    const event = events.find((e) => e.id === String(active.id));
    if (!event || event.status === targetStatus) return;
    const fromStatus = event.status;

    setError(null);
    applyStatus(event.id, targetStatus);
    startTransition(() => {
      void moveEvent({ id: event.id, to: targetStatus }).then((res) => {
        if (!res.ok) {
          if (isBoardStatus(fromStatus)) applyStatus(event.id, fromStatus);
          setError(res.error ?? "That move isn't allowed.");
        } else {
          setAnnouncement(`${event.title} moved to ${COLUMN_LABELS[targetStatus]}`);
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
      <DndContext id="event-board" sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
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

function Column({ status, items, total }: { status: BoardStatus; items: BoardEvent[]; total: number }) {
  const { setNodeRef } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className="rounded-xl bg-white p-3 shadow-sm">
      <h2 className="px-1 text-sm font-bold uppercase tracking-wide text-graphite">
        {COLUMN_LABELS[status]} <span className="text-graphite">({total})</span>
      </h2>
      <SortableContext items={items.map((e) => e.id)} strategy={verticalListSortingStrategy}>
        <div className="mt-2 space-y-2">
          {items.map((e) => <EventCard key={e.id} event={e} />)}
          {items.length === 0 && <p className="px-1 text-xs text-graphite">Empty</p>}
          {total > items.length && <p className="px-1 text-xs text-graphite">+{total - items.length} more</p>}
        </div>
      </SortableContext>
    </div>
  );
}

function EventCard({ event }: { event: BoardEvent }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: event.id });
  const status = isBoardStatus(event.status) ? event.status : "draft";

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
          aria-label={`Move ${event.title}`}
          className="mt-0.5 cursor-grab rounded px-1 text-graphite hover:bg-shade focus:outline focus:outline-2 focus:outline-ink"
        >
          ⠿
        </button>
        <div className="min-w-0 flex-1">
          <Link href={`/console/events/${event.id}`} className="font-medium leading-snug hover:text-graphite">
            {event.title}
          </Link>
          {event.coverUrl && (
            <Image src={event.coverUrl} alt="" width={56} height={32} className="mt-1 h-8 w-14 shrink-0 rounded object-cover" unoptimized />
          )}
        </div>
      </div>
      <p className="mt-1 pl-6 text-xs text-graphite">
        {event.member?.name && <>{event.member.name} · </>}{event.source} · {new Date(event.starts_on).toLocaleDateString("en-GB", { timeZone: "UTC" })}
      </p>

      {event.status === "awaiting_approval" && (
        <div className="mt-2 flex gap-2 pl-6">
          <form action={decideEvent}>
            <input type="hidden" name="id" value={event.id} />
            <input type="hidden" name="decision" value="approve" />
            <SubmitButton pendingLabel="Approving…" className="rounded bg-success px-2.5 py-1 text-xs text-white">Approve</SubmitButton>
          </form>
          <Link href={`/console/events/${event.id}`} className="rounded border px-2.5 py-1 text-xs">Review</Link>
        </div>
      )}

      <form action={setEventStatus} className="mt-1.5 pl-6">
        <input type="hidden" name="id" value={event.id} />
        <select
          name="status"
          defaultValue={status}
          aria-label={`Move ${event.title} to column`}
          className="w-full rounded border px-1.5 py-0.5 text-xs"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          <option value={status}>{COLUMN_LABELS[status]}</option>
          {LEGAL_EVENT_MOVES[status].map((to) => (
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

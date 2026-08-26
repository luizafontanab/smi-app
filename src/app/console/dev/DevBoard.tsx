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
import { Badge } from "@/components/console/ui";
import {
  applyMove,
  BOARD_STATUSES,
  DEV_STATUS_LABELS,
  DEV_STATUSES,
  DEV_TASK_KIND_LABELS,
  KIND_TONE,
  PRIORITY_TONE,
  type DevStatus,
  type DevTask,
} from "@/lib/dev-tasks";
import { createDevTask, moveDevTask, setDevTaskStatus } from "../actions";

const DONE_CAP = 20;

/**
 * Kanban board. Modelled on console/pages/LayoutEditor.tsx — same sensors,
 * same drag-handle-with-aria-label treatment, same isDragging styling — but
 * multi-column and closestCorners (closestCenter mis-targets across columns),
 * and it persists on drop rather than serialising into a hidden input.
 *
 * The per-card status <select> is the keyboard/no-JS path: cross-column
 * keyboard dragging in dnd-kit is unreliable, so the KeyboardSensor is not
 * relied on for that, and the dropdown is also how a card leaves the board
 * (via "canceled", which has no column here).
 */
export function DevBoard({ tasks: initial, returnTo }: { tasks: DevTask[]; returnTo: string }) {
  const [tasks, setTasks] = useState(initial);
  // Re-sync after the server action's revalidatePath produces fresh props.
  // Adjusted during render (React's documented pattern for this), not in an
  // effect — the parent's `initial` array is a fresh reference on every
  // server re-render, so comparing prop identity here is the same signal a
  // useEffect([initial]) would have used, without the extra render pass.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setTasks(initial);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function columnOf(status: DevStatus) {
    return tasks.filter((t) => t.status === status).sort((a, b) => a.sort_order - b.sort_order);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const overId = String(over.id);
    const overTask = tasks.find((t) => t.id === overId);
    const targetStatus = overTask
      ? overTask.status
      : (DEV_STATUSES as readonly string[]).includes(overId)
        ? (overId as DevStatus)
        : null;
    if (!targetStatus) return;

    const { tasks: next, orderedIds } = applyMove(tasks, String(active.id), targetStatus, overTask ? overId : null);
    setTasks(next);
    startTransition(() => {
      void moveDevTask({ id: String(active.id), status: targetStatus, orderedIds });
    });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
      <div className="mt-5 grid gap-4 lg:grid-cols-5">
        {BOARD_STATUSES.map((status) => {
          const items = columnOf(status);
          const visible = status === "done" ? items.slice(0, DONE_CAP) : items;
          return <Column key={status} status={status} items={visible} extra={items.length - visible.length} returnTo={returnTo} />;
        })}
      </div>
    </DndContext>
  );
}

function Column({ status, items, extra, returnTo }: { status: DevStatus; items: DevTask[]; extra: number; returnTo: string }) {
  const { setNodeRef } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className="rounded-xl bg-white p-3 shadow-sm">
      <h2 className="px-1 text-sm font-bold uppercase tracking-wide text-gray-500">
        {DEV_STATUS_LABELS[status]} <span className="text-gray-300">({items.length + extra})</span>
      </h2>
      <SortableContext items={items.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="mt-2 space-y-2">
          {items.map((t) => (
            <TaskCard key={t.id} task={t} returnTo={returnTo} />
          ))}
          {extra > 0 && <p className="px-1 text-xs text-gray-400">+{extra} more</p>}
        </div>
      </SortableContext>
      <form action={createDevTask} className="mt-2">
        <input type="hidden" name="status" value={status} />
        <input
          name="title"
          placeholder="+ Add task"
          required
          className="w-full rounded border px-2 py-1.5 text-sm placeholder:text-gray-400"
        />
      </form>
    </div>
  );
}

function TaskCard({ task, returnTo }: { task: DevTask; returnTo: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
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
          aria-label={`Move ${task.title}`}
          className="mt-0.5 cursor-grab rounded px-1 text-gray-400 hover:bg-gray-100 focus:outline focus:outline-2 focus:outline-ink"
        >
          ⠿
        </button>
        <Link href={`/console/dev/${task.id}${returnTo}`} className="font-medium leading-snug hover:text-graphite">
          {task.title}
        </Link>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-6">
        <Badge tone={PRIORITY_TONE[task.priority]}>{task.priority}</Badge>
        {task.kind && <Badge tone={KIND_TONE[task.kind]}>{DEV_TASK_KIND_LABELS[task.kind]}</Badge>}
        {task.assignee && <span className="text-xs text-gray-400">{task.assignee}</span>}
      </div>
      <form action={setDevTaskStatus} className="mt-1.5 pl-6">
        <input type="hidden" name="id" value={task.id} />
        <select
          name="status"
          defaultValue={task.status}
          className="w-full rounded border px-1.5 py-0.5 text-xs"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          {DEV_STATUSES.map((s) => (
            <option key={s} value={s}>
              {DEV_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <noscript>
          <button className="mt-1 rounded border px-2 py-0.5 text-xs">Move</button>
        </noscript>
      </form>
    </div>
  );
}

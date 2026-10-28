"use client";

import { useId, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BLOCK_LABELS, DECORATIONS, isAnchor, validateLayout, type Block, type BlockType, type PageLayout, type PageType } from "@/lib/blocks/schema";

type Props = { pageType: PageType; initial: PageLayout };

/**
 * Drag-and-drop block arranger. Anchors (the members' editable main content)
 * are pinned — they shift as decorations move around them but can't be picked
 * up or removed. Ad blocks are rotation slots with deliberately no settings.
 */
export function LayoutEditor({ pageType, initial }: Props) {
  const [blocks, setBlocks] = useState<Block[]>(initial.blocks);
  const uid = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const layout: PageLayout = { version: 1, blocks };
  const error = validateLayout(pageType, layout);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setBlocks((bs) => {
      const from = bs.findIndex((b) => b.id === active.id);
      const to = bs.findIndex((b) => b.id === over.id);
      return arrayMove(bs, from, to);
    });
  };

  const addBlock = (type: BlockType) => {
    const id = `${type}-${uid.replace(/[^a-z0-9]/gi, "")}-${blocks.length}-${counter++}`;
    const props =
      type === "back_link" ? { label: "Back to News", href: "/news" } :
      type === "latest_news" ? { limit: 4 } : undefined;
    setBlocks((bs) => [...bs, { id, type, ...(props ? { props } : {}) }]);
  };

  const setProps = (id: string, props: Record<string, unknown>) =>
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, props: { ...b.props, ...props } } : b)));

  let adIndex = 0;

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <ol aria-label="Page blocks" className="space-y-1.5">
            {blocks.map((b) => (
              <SortableBlock
                key={b.id}
                block={b}
                pinned={isAnchor(pageType, b.type)}
                adNumber={b.type === "ad_banner" ? ++adIndex : undefined}
                onRemove={() => setBlocks((bs) => bs.filter((x) => x.id !== b.id))}
                onProps={(p) => setProps(b.id, p)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <div className="mt-4 flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-xs uppercase tracking-wide text-graphite">Add block:</span>
        {DECORATIONS[pageType].map((t) => (
          <button key={t} type="button" onClick={() => addBlock(t)} className="rounded border px-2.5 py-1 text-xs hover:bg-shade">
            + {BLOCK_LABELS[t]}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{error}</p>}
      <input type="hidden" name="layout" value={JSON.stringify(layout)} />
      <button disabled={error !== null} className="mt-4 rounded bg-ink px-5 py-2.5 text-white disabled:opacity-40">
        Save layout
      </button>
    </div>
  );
}

let counter = 0;

function SortableBlock({ block, pinned, adNumber, onRemove, onProps }: {
  block: Block; pinned: boolean; adNumber?: number;
  onRemove: () => void; onProps: (p: Record<string, unknown>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id, disabled: pinned });
  const props = (block.props ?? {}) as { label?: string; href?: string; limit?: number };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${pinned ? "border-brand/60 bg-brand/5" : "bg-white"} ${isDragging ? "opacity-60 shadow-lg" : ""}`}
    >
      {!pinned && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Move ${BLOCK_LABELS[block.type]}`}
          className="cursor-grab rounded px-1.5 py-1 text-graphite hover:bg-shade focus:outline focus:outline-2 focus:outline-ink"
        >
          ⠿
        </button>
      )}
      {pinned && <span className="px-1.5 text-brand" title="Main content — always present">📌</span>}
      <span className="font-medium text-ink">
        {BLOCK_LABELS[block.type]}
        {adNumber !== undefined && <span className="ml-1 font-normal text-graphite">#{adNumber} — rotation decides what shows</span>}
      </span>
      {block.type === "back_link" && (
        <span className="flex gap-1.5">
          <input value={props.label ?? ""} onChange={(e) => onProps({ label: e.target.value })} placeholder="Label" aria-label="Back link label" className="w-28 rounded border px-2 py-0.5 text-xs" />
          <input value={props.href ?? ""} onChange={(e) => onProps({ href: e.target.value })} placeholder="/news" aria-label="Back link URL" className="w-24 rounded border px-2 py-0.5 text-xs" />
        </span>
      )}
      {/* member_news has no count: it's a carousel of the member's latest 12, with "See more" past that */}
      {block.type === "latest_news" && (
        <label className="flex items-center gap-1 text-xs text-graphite">
          cards
          <input
            type="number" min={1} max={8} value={props.limit ?? 4}
            onChange={(e) => onProps({ limit: Number(e.target.value) })}
            className="w-14 rounded border px-2 py-0.5"
          />
        </label>
      )}
      {!pinned && (
        <button type="button" onClick={onRemove} aria-label="Remove block" className="ml-auto rounded px-2 py-0.5 text-ink/70 hover:bg-danger/10 hover:text-danger">
          ✕
        </button>
      )}
    </li>
  );
}

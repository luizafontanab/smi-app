"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type CategoryOption = { slug: string; name: string; href: string };

/**
 * Type-ahead category filter. The member directory has ~69 categories, which as a
 * flat pill row buried the member cards below the fold.
 *
 * Hrefs are precomputed by the page's qs() builder rather than assembled here: a
 * server component can't pass a function prop, and duplicating the merge rules would
 * be how the ?q= search term quietly gets dropped on a category change.
 *
 * Options are <li role="option"> driven by router.push, not links — role="listbox"
 * forbids nested interactive children, and aria-activedescendant (focus stays in the
 * filter input while arrows move the highlight) is impossible with real anchors. The
 * cost is no cmd-click-to-new-tab; the resulting URL is still shareable.
 */
export function CategoryCombobox({
  options,
  allHref,
  selected,
  allLabel = "All categories",
}: {
  options: CategoryOption[];
  allHref: string;
  selected?: string;
  allLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const all: CategoryOption = { slug: "", name: allLabel, href: allHref };
  const needle = term.trim().toLowerCase();
  const matches = [all, ...options].filter((o) => o.name.toLowerCase().includes(needle));
  const currentName = options.find((o) => o.slug === selected)?.name ?? allLabel;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setTerm("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close(refocus: boolean) {
    setOpen(false);
    setTerm("");
    if (refocus) triggerRef.current?.focus();
  }

  function choose(o: CategoryOption) {
    close(false);
    startTransition(() => router.push(o.href));
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(matches.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (matches[active]) choose(matches[active]);
    } else if (e.key === "Tab") {
      close(false);
    }
  }

  return (
    <div ref={rootRef} className="relative w-full sm:w-64">
      <div className={`flex items-center rounded-full border bg-white ${selected ? "border-ink" : ""}`}>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => (open ? close(false) : setOpen(true))}
          className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-full px-3 py-1.5 text-left text-sm ${pending ? "opacity-60" : ""}`}
        >
          <span className="truncate">{currentName}</span>
          <span aria-hidden className="text-gray-500">▾</span>
        </button>
        {selected && (
          <button
            type="button"
            aria-label="Clear category filter"
            onClick={() => choose(all)}
            className="px-2.5 py-1.5 text-sm text-gray-500 hover:text-ink"
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 max-w-[85vw] rounded-lg border bg-white p-2 shadow-lg">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
            aria-label="Filter categories"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setActive(0); // re-filtering invalidates the old highlight index
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Type to filter…"
            className="w-full rounded border px-2.5 py-1.5 text-sm"
          />
          {matches.length > 0 ? (
            <ul ref={listRef} id={listId} role="listbox" aria-label="Member categories" className="mt-1.5 max-h-72 overflow-y-auto">
              {matches.map((o, i) => {
                const isSelected = o.slug === (selected ?? "");
                return (
                  <li
                    key={o.slug || "__all"}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    data-active={i === active || undefined}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o)}
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded px-2.5 py-1.5 text-sm ${i === active ? "bg-paper" : ""} ${isSelected ? "font-semibold text-ink" : ""}`}
                  >
                    <span className="truncate">{o.name}</span>
                    {isSelected && <span aria-hidden className="text-brand">✓</span>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-2.5 py-3 text-sm text-gray-500">No categories match “{term.trim()}”.</p>
          )}
        </div>
      )}
    </div>
  );
}

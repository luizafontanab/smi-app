"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type MultiSelectOption = { slug: string; name: string; href: string };

/**
 * Multi-select sibling of CategoryCombobox (which stays single-select — news
 * still uses it that way). Options carry a precomputed href for their own
 * toggle, same reasoning as CategoryCombobox: the page already knows the
 * current selection when it renders, so it can work out each option's
 * "next" URL server-side rather than building it here.
 *
 * Unlike CategoryCombobox, choosing an option does not close the popup —
 * picking several is the point.
 */
export function MultiSelectCombobox({
  label,
  options,
  clearHref,
  selectedSlugs,
}: {
  label: string;
  options: MultiSelectOption[];
  clearHref: string;
  selectedSlugs: string[];
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

  const needle = term.trim().toLowerCase();
  const matches = options.filter((o) => o.name.toLowerCase().includes(needle));

  const selectedNames = options.filter((o) => selectedSlugs.includes(o.slug)).map((o) => o.name);
  const triggerLabel =
    selectedNames.length === 0 ? label : selectedNames.length === 1 ? selectedNames[0] : `${label} (${selectedNames.length})`;

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

  function toggle(o: MultiSelectOption) {
    startTransition(() => router.push(o.href));
  }

  // Same contract as CategoryCombobox: Escape hands focus back to the trigger
  // so a keyboard user isn't dropped on a now-unmounted input.
  function close(refocus: boolean) {
    setOpen(false);
    setTerm("");
    if (refocus) triggerRef.current?.focus();
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
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (matches[active]) toggle(matches[active]);
    }
  }

  return (
    <div data-part="filter-select" ref={rootRef} className="relative w-full sm:w-64">
      <div data-part="filter-select-control" className={`flex items-center rounded-full border bg-white ${selectedSlugs.length ? "border-ink" : ""}`}>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen((v) => !v)}
          className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-full px-3 py-1.5 text-left text-sm ${pending ? "opacity-60" : ""}`}
        >
          <span className="truncate">{triggerLabel}</span>
          <span aria-hidden className="text-graphite">▾</span>
        </button>
        {selectedSlugs.length > 0 && (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()} filter`}
            onClick={() => startTransition(() => router.push(clearHref))}
            className="px-2.5 py-1.5 text-sm text-graphite hover:text-ink"
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div data-part="filter-select-popup" className="absolute right-0 z-30 mt-1 w-72 max-w-[85vw] rounded-lg border bg-white p-2 shadow-lg">
          <input data-part="form-input"
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
            aria-label={`Filter ${label.toLowerCase()}`}
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Type to filter…"
            className="w-full rounded border px-2.5 py-1.5 text-sm"
          />
          {matches.length > 0 ? (
            <ul ref={listRef} id={listId} role="listbox" aria-multiselectable="true" aria-label={label} className="mt-1.5 max-h-72 overflow-y-auto">
              {matches.map((o, i) => {
                const isSelected = selectedSlugs.includes(o.slug);
                return (
                  <li data-part="filter-select-option"
                    key={o.slug}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    data-active={i === active || undefined}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggle(o)}
                    className={`flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-sm ${i === active ? "bg-paper" : ""} ${isSelected ? "font-semibold text-ink" : ""}`}
                  >
                    <input type="checkbox" checked={isSelected} readOnly tabIndex={-1} className="shrink-0" />
                    <span className="truncate">{o.name}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p data-part="empty-state" className="px-2.5 py-3 text-sm text-graphite">No {label.toLowerCase()} match “{term.trim()}”.</p>
          )}
        </div>
      )}
    </div>
  );
}

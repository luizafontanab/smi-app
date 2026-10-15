"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";

export type BiginCompanyOption = { id: string; name: string };

/**
 * Links a contact to an *existing* Bigin company (Companies are records in
 * Bigin, not free text, and we never create them from here). Posts two hidden
 * fields, bigin_company_id and bigin_company_name, which saveContact reads.
 *
 * Results come from Bigin itself through the `search` server action, so they
 * are always current — debounced, because each keystroke is an API credit.
 * Same listbox pattern as CategoryCombobox: focus stays in the input while
 * the arrows move aria-activedescendant.
 */
export function BiginCompanyPicker({
  initial,
  search,
  disabled = false,
}: {
  initial: BiginCompanyOption | null;
  search: (q: string) => Promise<BiginCompanyOption[]>;
  disabled?: boolean;
}) {
  const [linked, setLinked] = useState<BiginCompanyOption | null>(initial);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<BiginCompanyOption[]>([]);
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState(false);
  const [pending, startTransition] = useTransition();
  const listId = useId();
  const latest = useRef("");

  useEffect(() => {
    const q = term.trim();
    latest.current = q;
    if (q.length < 2) return; // onTermChange already cleared the list
    const timer = setTimeout(() => {
      startTransition(async () => {
        const found = await search(q);
        if (latest.current !== q) return; // a newer keystroke won
        setResults(found);
        setActive(0);
        setSearched(true);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [term, search]);

  function onTermChange(value: string) {
    setTerm(value);
    if (value.trim().length < 2) {
      setResults([]);
      setSearched(false);
    }
  }

  function choose(o: BiginCompanyOption) {
    setLinked(o);
    setTerm("");
    setResults([]);
    setSearched(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // never submit the contact form from the search box
      e.preventDefault();
      if (results[active]) choose(results[active]);
    } else if (e.key === "Escape") {
      onTermChange("");
    }
  }

  const open = results.length > 0 || (searched && !pending);

  return (
    <div className="relative sm:col-span-2">
      <input type="hidden" name="bigin_company_id" value={linked?.id ?? ""} />
      <input type="hidden" name="bigin_company_name" value={linked?.name ?? ""} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-graphite">Bigin company:</span>
        {linked ? (
          <span className="flex items-center gap-1 rounded-full border border-ink px-2.5 py-0.5 text-xs">
            {linked.name || linked.id}
            {!disabled && (
              <button type="button" aria-label="Unlink Bigin company" onClick={() => setLinked(null)} className="text-graphite hover:text-ink">
                ×
              </button>
            )}
          </span>
        ) : (
          <span className="text-xs text-graphite">not linked</span>
        )}
        {!disabled && (
          <input
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-label="Search existing Bigin companies"
            value={term}
            onChange={(e) => onTermChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={linked ? "change…" : "search Bigin companies…"}
            className={`min-w-0 flex-1 rounded border px-3 py-1.5 ${pending ? "opacity-60" : ""}`}
          />
        )}
      </div>
      {disabled && <p className="mt-1 text-xs text-graphite">Bigin isn&apos;t connected, so companies can&apos;t be looked up yet.</p>}
      {open && (
        <ul id={listId} role="listbox" aria-label="Bigin companies" className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border bg-white p-1 shadow-lg">
          {results.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              onPointerDown={(e) => {
                e.preventDefault(); // keep focus in the input until the choice lands
                choose(o);
              }}
              className={`cursor-pointer rounded px-2 py-1.5 text-sm ${i === active ? "bg-shade" : ""}`}
            >
              {o.name}
            </li>
          ))}
          {results.length === 0 && (
            <li role="option" aria-selected={false} aria-disabled className="px-2 py-1.5 text-sm text-graphite">
              No Bigin company matches — companies are only linked, never created from here.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

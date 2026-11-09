"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { MAX_CLOSING_LINKS, type ClosingLink } from "@/lib/company-link";

type Found = { id: string; name: string; website?: string | null };
type Row = ClosingLink & { key: number };

/**
 * The companies a story closes with, besides its featured members (Jas 13/10:
 * "ideally i would prefer to select from the BIGIN database, via a drop
 * down/select"). Search Bigin's Companies, pick one or several; each row keeps
 * an editable website box, filled from Bigin's Website when it has one, and
 * typed by hand when it doesn't. A company not in Bigin can be added by hand.
 *
 * Posts parallel fields per row (closing_link_bigin_id / _name / _url) plus
 * closing_links_sent, read by closingLinksFromForm. Featured members aren't
 * picked here: they get their member-page line automatically.
 *
 * Same listbox pattern as BiginCompanyPicker: focus stays in the input while
 * the arrows move aria-activedescendant; debounced, since each search is a
 * Bigin API credit.
 */
export function ClosingLinksPicker({
  initial,
  search,
  live,
}: {
  initial: ClosingLink[];
  search: (q: string) => Promise<Found[]>;
  /** Bigin connected: false hides the search, leaving hand-typed rows only. */
  live: boolean;
}) {
  const nextKey = useRef(initial.length);
  const [rows, setRows] = useState<Row[]>(() => initial.map((l, i) => ({ ...l, key: i })));
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState(false);
  const [pending, startTransition] = useTransition();
  const listId = useId();
  const hintId = useId();
  const latest = useRef("");
  const full = rows.length >= MAX_CLOSING_LINKS;

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

  function add(row: ClosingLink) {
    setRows((rs) => (rs.length >= MAX_CLOSING_LINKS ? rs : [...rs, { ...row, key: nextKey.current++ }]));
  }

  function choose(o: Found) {
    if (!rows.some((r) => r.bigin_id === o.id)) add({ bigin_id: o.id, name: o.name, url: o.website ?? "" });
    onTermChange("");
  }

  function update(key: number, patch: Partial<ClosingLink>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // never submit the story form from the search box
      e.preventDefault();
      if (results[active]) choose(results[active]);
    } else if (e.key === "Escape") {
      onTermChange("");
    }
  }

  const open = results.length > 0 || (searched && !pending);

  return (
    <fieldset>
      <legend className="text-sm font-medium">Company links at the end of the story</legend>
      <p id={hintId} className="mt-0.5 text-xs text-graphite">
        Featured members get a line to their member page automatically. Add other companies here: each becomes a line with its name, linking to its website.
      </p>
      <input type="hidden" name="closing_links_sent" value="1" />
      {rows.length > 0 && (
        <ul className="mt-2 space-y-2">
          {rows.map((r) => (
            <li key={r.key} className="grid gap-2 rounded border p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
              <input type="hidden" name="closing_link_bigin_id" value={r.bigin_id ?? ""} />
              <label className="text-xs font-medium">
                Company{r.bigin_id ? <span className="font-normal text-graphite"> (from Bigin)</span> : null}
                <input
                  name="closing_link_name"
                  value={r.name}
                  onChange={(e) => update(r.key, { name: e.target.value })}
                  required
                  maxLength={200}
                  className="mt-1 w-full rounded border px-3 py-1.5 text-sm font-normal"
                />
              </label>
              <label className="text-xs font-medium">
                Website
                <input
                  name="closing_link_url"
                  type="text"
                  inputMode="url"
                  value={r.url}
                  onChange={(e) => update(r.key, { url: e.target.value })}
                  required
                  placeholder={r.bigin_id ? "No Website in Bigin: type one" : "https://…"}
                  className="mt-1 w-full rounded border px-3 py-1.5 text-sm font-normal"
                />
              </label>
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                aria-label={`Remove ${r.name || "this company"}`}
                className="rounded border px-3 py-1.5 text-sm text-graphite hover:text-ink"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative mt-2 flex flex-wrap items-center gap-2">
        {live && !full && (
          <input
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-label="Search Bigin companies to add"
            aria-describedby={hintId}
            value={term}
            onChange={(e) => onTermChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="search Bigin companies…"
            className={`min-w-0 flex-1 rounded border px-3 py-1.5 text-sm ${pending ? "opacity-60" : ""}`}
          />
        )}
        {!full && (
          <button type="button" onClick={() => add({ bigin_id: null, name: "", url: "" })} className="rounded border px-3 py-1.5 text-sm text-graphite hover:text-ink">
            Add one by hand
          </button>
        )}
        {full && <p className="text-xs text-graphite">That&apos;s the most a story can have ({MAX_CLOSING_LINKS}).</p>}
        {open && (
          <ul id={listId} role="listbox" aria-label="Bigin companies" className="absolute top-full z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border bg-white p-1 shadow-lg">
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
                {!o.website && <span className="text-graphite"> (no website in Bigin)</span>}
              </li>
            ))}
            {results.length === 0 && (
              <li role="option" aria-selected={false} aria-disabled className="px-2 py-1.5 text-sm text-graphite">
                No Bigin company matches. Use &quot;Add one by hand&quot; instead.
              </li>
            )}
          </ul>
        )}
      </div>
      {!live && <p className="mt-1 text-xs text-graphite">Bigin isn&apos;t connected, so companies can only be added by hand for now.</p>}
    </fieldset>
  );
}

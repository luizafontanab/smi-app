"use client";

import { useId, useMemo, useState } from "react";

export type Service = { id: number; name: string };

/**
 * The Services multi-select, collapsed by default and filterable (fix list).
 *
 * The vocabulary is 69 terms, which as a flat two-column checkbox list was the
 * tallest thing on the company-page form by a wide margin — it pushed every
 * field below it off the screen, on a form where most visits are there to
 * change something else.
 *
 * Collapsed to a summary of what is currently selected, and it opens already
 * expanded when nothing is selected yet, which is the one time the member
 * definitely needs to act. Filtering is client-side over a list this size; the
 * boxes themselves stay mounted while filtered so a selection made under one
 * search term survives typing another — hidden, not unmounted, or the form
 * would silently drop it on submit.
 */
export function ServicesPicker({ services, selected, legendClass }: {
  services: Service[];
  selected: Set<number>;
  legendClass?: string;
}) {
  const [open, setOpen] = useState(selected.size === 0);
  const [term, setTerm] = useState("");
  // Controlled, so the collapsed summary reflects what is ticked right now
  // rather than what was last saved. Seeded from the server render.
  const [chosenIds, setChosenIds] = useState<Set<number>>(() => new Set(selected));
  const searchId = useId();

  const needle = term.trim().toLowerCase();
  const matches = useMemo(
    () => new Set(services.filter((s) => s.name.toLowerCase().includes(needle)).map((s) => s.id)),
    [services, needle],
  );

  const chosen = services.filter((s) => chosenIds.has(s.id));
  const summary = chosen.length === 0
    ? "None selected"
    : chosen.length <= 3
      ? chosen.map((s) => s.name).join(", ")
      : `${chosen.slice(0, 3).map((s) => s.name).join(", ")} +${chosen.length - 3} more`;

  return (
    <fieldset>
      <legend className={legendClass}>Services you offer</legend>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="tap rounded border px-2.5 py-1 text-sm font-medium text-graphite hover:border-ink hover:text-ink sm:text-xs"
        >
          {open ? "Hide" : "Choose services"}
        </button>
        <p className="min-w-0 text-xs text-graphite">{summary}</p>
      </div>

      <div className={open ? "mt-2" : "hidden"}>
        <label htmlFor={searchId} className="sr-only">Search services</label>
        <input
          id={searchId}
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search services…"
          className="w-full rounded border px-3 py-1.5 text-base sm:text-sm"
        />
        <p className="mt-1 text-xs text-graphite">
          Choose everything that applies — these are how buyers filter the member directory.
        </p>
        <div className="mt-2 max-h-72 overflow-y-auto rounded border p-2">
          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {services.map((s) => (
              <label
                key={s.id}
                // Hidden rather than unmounted: an unmounted checkbox leaves the
                // form, so filtering would quietly discard selections.
                hidden={!matches.has(s.id)}
                className="flex items-center gap-2 py-1 text-sm sm:py-0"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-ink [@media(pointer:coarse)]:h-5 [@media(pointer:coarse)]:w-5"
                  name="services"
                  value={s.id}
                  checked={chosenIds.has(s.id)}
                  onChange={(e) => setChosenIds((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(s.id); else next.delete(s.id);
                    return next;
                  })}
                />
                {s.name}
              </label>
            ))}
          </div>
          {matches.size === 0 && (
            <p className="px-1 py-2 text-sm text-graphite">Nothing matches “{term.trim()}”.</p>
          )}
        </div>
      </div>
    </fieldset>
  );
}

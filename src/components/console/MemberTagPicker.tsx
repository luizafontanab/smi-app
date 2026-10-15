"use client";

import { useEffect, useId, useState } from "react";

export type TagOption = { id: string; name: string; note?: string };

/**
 * "Also features" on the console story editor (Jas 13/10 item 12: a story can
 * feature several members, and every one must be tagged so it reaches their
 * profile, dashboard and stats). A filterable checkbox list, because the
 * directory runs past a hundred companies.
 *
 * Plain checkboxes named `tagged_member_ids`, so it posts with the form like
 * any field. Filtering only hides rows — a hidden, ticked box still submits —
 * so narrowing the list never drops a tag. The subject member chosen in the
 * select above is left out of the list (it's always tagged), tracked live so a
 * change of subject updates the list without a save.
 */
export function MemberTagPicker({ options, selected, primarySelectId }: {
  options: TagOption[];
  selected: string[];
  /** id of the subject-member <select>, whose value is excluded here. */
  primarySelectId: string;
}) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(selected));
  const [query, setQuery] = useState("");
  const [primary, setPrimary] = useState<string>("");
  const filterId = useId();

  useEffect(() => {
    const select = document.getElementById(primarySelectId) as HTMLSelectElement | null;
    if (!select) return;
    const sync = () => setPrimary(select.value);
    sync();
    select.addEventListener("change", sync);
    return () => select.removeEventListener("change", sync);
  }, [primarySelectId]);

  const toggle = (id: string, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const q = query.trim().toLowerCase();
  const chosen = options.filter((o) => ticked.has(o.id) && o.id !== primary);

  return (
    <fieldset>
      <legend className="text-sm font-medium">Also features (tag other members)</legend>
      <p className="mt-0.5 text-xs text-graphite">
        Every member ticked here gets this story on their company page, in their dashboard and stats, a notification when
        it goes live, and a tag in the social post. The subject member above is always included.
      </p>
      {chosen.length > 0 && (
        <ul aria-label="Tagged members" className="mt-2 flex flex-wrap gap-1.5">
          {chosen.map((o) => (
            <li key={o.id} className="flex items-center gap-1 rounded-full bg-ink/10 py-0.5 pl-2.5 pr-1 text-xs text-ink">
              {o.name}
              <button
                type="button"
                onClick={() => toggle(o.id, false)}
                aria-label={`Untag ${o.name}`}
                className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-ink/15"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor={filterId} className="sr-only">Find a member to tag</label>
      <input
        id={filterId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a member…"
        className="mt-2 w-full rounded border px-3 py-1.5 text-sm"
      />
      <div className="mt-1 max-h-48 overflow-y-auto rounded border p-2 text-sm">
        {options.map((o) => {
          const isPrimary = o.id === primary;
          const visible = !isPrimary && (!q || o.name.toLowerCase().includes(q));
          return (
            <label key={o.id} className={visible ? "flex items-center gap-2 py-0.5" : "hidden"}>
              <input
                type="checkbox"
                name="tagged_member_ids"
                value={o.id}
                // the primary is posted by its own select; never twice
                disabled={isPrimary}
                checked={ticked.has(o.id) && !isPrimary}
                onChange={(e) => toggle(o.id, e.target.checked)}
              />
              <span>
                {o.name}
                {o.note && <span className="ml-1 text-xs text-graphite">({o.note})</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

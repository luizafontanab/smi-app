"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { IssueContentResult } from "@/lib/newsletter-picker";

/**
 * The issue's stories and videos as one ordered list (gap review area 5): the
 * first is the lead story, and up/down set the order a reader sees. Posts one
 * hidden `items` field per pick, `story:<id>` / `video:<id>`, in order, which
 * updateIssue reads with parseIssueItems.
 *
 * Every pick is posted however old it is, so a save can't drop it. Adding
 * comes from the latest published items or, past those, from the `search`
 * server action by title and "published since" date, so nothing is out of
 * reach behind a fixed window.
 *
 * The list changes through buttons, not form inputs, so each change fires a
 * `change` on the form for UnsavedChangesGuard to see.
 */
export function IssueItemsPicker({
  initial,
  recent,
  search,
}: {
  initial: IssueContentResult[];
  recent: IssueContentResult[];
  search: (query: string, since: string) => Promise<IssueContentResult[]>;
}) {
  const [picked, setPicked] = useState(initial);
  const [term, setTerm] = useState("");
  const [since, setSince] = useState("");
  const [results, setResults] = useState<IssueContentResult[] | null>(null);
  const [pending, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef("");
  const touched = useRef(false);

  useEffect(() => {
    if (!touched.current) return;
    root.current?.closest("form")?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [picked]);

  useEffect(() => {
    const key = `${term.trim()}|${since}`;
    latest.current = key;
    if (!term.trim() && !since) return; // onFilter already cleared the results
    const timer = setTimeout(() => {
      startTransition(async () => {
        const found = await search(term.trim(), since);
        if (latest.current === key) setResults(found);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [term, since, search]);

  const keyOf = (item: IssueContentResult) => `${item.kind}:${item.id}`;
  const pickedKeys = new Set(picked.map(keyOf));
  const addable = (results ?? recent).filter((item) => !pickedKeys.has(keyOf(item)));

  function change(next: IssueContentResult[]) {
    touched.current = true;
    setPicked(next);
  }
  function move(index: number, by: -1 | 1) {
    const next = [...picked];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    change(next);
  }
  function onFilter(nextTerm: string, nextSince: string) {
    setTerm(nextTerm);
    setSince(nextSince);
    if (!nextTerm.trim() && !nextSince) setResults(null);
  }

  return (
    <div ref={root} className="space-y-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-graphite">In this issue ({picked.length}) — the first is the lead story</p>
        <ol className="mt-1 divide-y rounded border">
          {picked.map((item, i) => (
            <li key={keyOf(item)} className="flex items-center gap-2 px-2 py-1.5">
              <input type="hidden" name="items" value={keyOf(item)} />
              <span className="w-10 shrink-0 text-xs text-graphite">{i === 0 ? "Lead" : i + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                {item.title}
                {item.kind === "video" && <span className="text-xs text-graphite"> (video)</span>}
                {item.status !== "published" && <span className="text-xs text-danger"> not live</span>}
              </span>
              <span className="text-xs text-graphite">{item.published_at?.slice(0, 10)}</span>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${item.title} up`} className="rounded border px-1.5 text-xs disabled:opacity-30">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === picked.length - 1} aria-label={`Move ${item.title} down`} className="rounded border px-1.5 text-xs disabled:opacity-30">↓</button>
              <button type="button" onClick={() => change(picked.filter((_, j) => j !== i))} aria-label={`Remove ${item.title}`} className="text-xs text-danger hover:underline">remove</button>
            </li>
          ))}
          {!picked.length && <li className="px-2 py-1.5 text-xs text-graphite">Nothing picked yet.</li>}
        </ol>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-graphite">Add stories and videos</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            type="search"
            value={term}
            onChange={(e) => onFilter(e.target.value, since)}
            onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
            placeholder="Search by title"
            aria-label="Search stories and videos by title"
            className="min-w-0 flex-1 rounded border px-3 py-1.5"
          />
          <label className="flex items-center gap-1 text-xs text-graphite">
            Published since
            <input type="date" value={since} onChange={(e) => onFilter(term, e.target.value)} className="rounded border px-2 py-1 text-sm text-ink" />
          </label>
        </div>
        <p className="mt-1 text-xs text-graphite" aria-live="polite">
          {pending ? "Searching…" : results ? `${addable.length} found` : "The latest published, newest first. Search to reach older ones."}
        </p>
        <ul className="mt-1 max-h-56 divide-y overflow-y-auto rounded border">
          {addable.map((item) => (
            <li key={keyOf(item)} className="flex items-center gap-2 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate">
                {item.title}
                {item.kind === "video" && <span className="text-xs text-graphite"> (video)</span>}
              </span>
              <span className="text-xs text-graphite">{item.published_at?.slice(0, 10)}</span>
              <button type="button" onClick={() => change([...picked, item])} aria-label={`Add ${item.title}`} className="rounded bg-ink px-2 py-0.5 text-xs text-white">Add</button>
            </li>
          ))}
          {!addable.length && <li className="px-2 py-1.5 text-xs text-graphite">Nothing to add here.</li>}
        </ul>
      </div>
    </div>
  );
}

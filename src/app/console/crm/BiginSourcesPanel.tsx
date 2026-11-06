import type { BiginSourcesRun } from "@/lib/sources/bigin";

/**
 * What Bigin's company addresses last did to the story sources: the summary,
 * the addresses skipped or clashing ("fix in Bigin") and the misnamed-field
 * warning. Moved from Story Sources into CRM's Companies box (issue #51,
 * ADR 0002): CRM shows where an address comes from; Story Sources only how
 * it's read. No button of its own — "Sync companies" updates the sources.
 */

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

export function BiginSourcesPanel({ live, run }: { live: boolean; run: BiginSourcesRun | null }) {
  return (
    <section aria-labelledby="bigin-sources-heading" className="mt-3 rounded border border-graphite/20 p-3 text-sm">
      <h3 id="bigin-sources-heading" className="text-xs font-bold uppercase tracking-wide text-graphite">Story sources from Bigin</h3>
      <p className="mt-1 text-xs text-graphite">
        {!live
          ? "Bigin isn't connected, so story sources come from the imported list only."
          : run
            ? `Last updated ${day(run.at)}: ${run.companies} companies with an address${run.fromWebsite ? ` (${run.fromWebsite} using their Website)` : ""} — ${run.added} added, ${run.linked} linked, ${run.paused} paused${run.complete ? "" : " (Bigin stopped part-way; nothing was paused)"}.`
            : "Not updated from Bigin yet. Sync companies does it while the story crawler is on, and so does the daily sync."}
      </p>
      {live && run?.websiteFallbackWithheld && (
        <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-xs text-danger">
          No Bigin company came back with a News Page URL, so nothing was added from Websites either. Either the
          field is empty everywhere, or its name in Bigin isn&apos;t the one the app expects (News_Page_URL) — ask
          for it to be checked. Nothing already on the list was changed.
        </p>
      )}
      {live && run && run.skipped.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-danger">{run.skipped.length} Bigin address{run.skipped.length === 1 ? "" : "es"} skipped — fix in Bigin</summary>
          <ul className="mt-1 space-y-0.5 text-xs text-graphite">
            {run.skipped.map((x) => (
              <li key={`${x.company}-${x.url}`}>
                {x.company}: <span className="break-all">{x.url}</span> — {x.reason === "clash" ? "another company already lists this page" : "not a web address"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

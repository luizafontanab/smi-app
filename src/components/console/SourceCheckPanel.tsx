import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { checkSourcesNow } from "@/app/console/sources/actions";
import { isRunning, sourceCheckSummary, type SourceCheckRun } from "@/lib/sources/run";

/** What came back from a "Check sources now" click, read from `?sourcecheck=`. */
const FLASH: Record<string, { text: string; tone: "ok" | "warn" | "bad" }> = {
  done: { text: "Check finished.", tone: "ok" },
  busy: { text: "A check is already running, so this one didn't start. Try again in a minute.", tone: "warn" },
  off: { text: "The story crawler is off, so nothing was checked.", tone: "warn" },
  held: { text: "The check stopped at its time limit while a site was still answering. What it reached is saved; the next check can start in a few minutes.", tone: "warn" },
  failed: { text: "The check stopped with an error. Anything it checked before that is saved — please try again.", tone: "bad" },
  notstarted: { text: "The check couldn't start, so nothing was checked. Please try again.", tone: "bad" },
};
const TONE = { ok: "bg-success/10 text-success", warn: "bg-gold/25 text-ink", bad: "bg-danger/10 text-danger" };

/**
 * "Check sources now" plus the last source check's summary (issue #42). The
 * same panel on Command Centre and Story sources; `returnTo` is where the
 * click comes back to, and must be one the action allows.
 */
export function SourceCheckPanel({
  run, crawlerOn, returnTo, flash, flashRun, nowMs, className = "",
}: {
  run: SourceCheckRun | null;
  crawlerOn: boolean;
  returnTo: "/console" | "/console/sources" | "/console/sources?view=sources";
  flash?: string;
  /** `?checkrun=`: the run the click started. Its count is shown only while it's still the record's run. */
  flashRun?: string;
  nowMs: number;
  className?: string;
}) {
  const result = flash ? FLASH[flash] : undefined;
  const running = isRunning(run, nowMs);
  const ours = !!flashRun && run?.id === flashRun;
  const fresh = (flash === "done" || flash === "held") && ours && run && !run.error ? run.new_items ?? 0 : 0;
  return (
    <section id="source-check" aria-labelledby="source-check-title" className={`rounded-xl bg-white p-4 text-sm shadow-sm ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="source-check-title" className="font-bold text-ink">Source check</h2>
        {returnTo === "/console" && <Link href="/console/sources" className="text-xs text-graphite underline">Story sources →</Link>}
      </div>
      {result && (
        <p role="status" className={`mt-2 rounded p-2 ${TONE[result.tone]}`}>
          {result.text}
          {flash === "done" && flashRun && !ours && <> A newer check has run since; its summary is below.</>}
          {fresh > 0 && <> <Link href="/console/sources" className="underline">See the {fresh === 1 ? "new suggestion" : `${fresh} new suggestions`} →</Link></>}
        </p>
      )}
      <p className="mt-2 text-graphite">{sourceCheckSummary(run, nowMs)}</p>
      {crawlerOn ? (
        <form action={checkSourcesNow} className="mt-3">
          <input type="hidden" name="return" value={returnTo} />
          {/* Disabled while a check runs: a click would only come back "busy". */}
          {running ? (
            <button type="button" disabled className="rounded border px-3 py-1.5 text-sm opacity-50">Check sources now</button>
          ) : (
            <SubmitButton pendingLabel="Checking sources… (up to a minute)" className="rounded border px-3 py-1.5 text-sm disabled:opacity-50">
              Check sources now
            </SubmitButton>
          )}
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" disabled className="rounded border px-3 py-1.5 text-sm opacity-50">Check sources now</button>
          <span className="text-xs text-graphite">
            The story crawler is off. <Link href="/console/features" className="underline">Turn it on in Features</Link>.
          </span>
        </div>
      )}
    </section>
  );
}

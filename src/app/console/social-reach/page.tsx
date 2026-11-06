import { requireConsole } from "@/lib/auth";
import { connectedPlatforms } from "@/lib/adapters/social-followers";
import { serviceDb } from "@/lib/db/server";
import { must, mustList } from "@/lib/db/must";
import { newsletterAudience } from "@/lib/newsletter-audience";
import { socialChannel } from "@/lib/social";
import {
  DEFAULT_REACH_LABEL, REACH_LABEL_MAX, SOCIAL_REACH_FETCHED_KEY, SOCIAL_REACH_HOMEPAGE_KEY, SOCIAL_REACH_MANUAL_KEY, VIEWS_PERIOD_MAX,
  parseFetched, parseHomepageReach, parseManual, platformRows, rowTotals, type ReachRow,
} from "@/lib/social-reach";
import { SubmitButton } from "@/components/SubmitButton";
import { clearSocialReachHomepage, saveSocialReachHomepage, saveSocialReachPlatforms } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Social reach" };

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" });
const n = (v: number) => v.toLocaleString("en-GB");
const param = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

const INPUT = "w-full rounded border px-2 py-1.5 text-sm aria-[invalid=true]:border-danger";

/** Where a row's followers figure comes from, in words. */
function sourceText(row: ReachRow): string {
  const typed = row.followers.mode === "manual" && row.followers.at ? `Entered by hand, ${day(row.followers.at)}` : null;
  switch (row.status) {
    case "auto":
      return `Fetched automatically, updated ${day(row.followers.at!)}`;
    case "auto_stale":
      return `Fetched automatically, updated ${day(row.followers.at!)}. The latest fetch failed (${day(row.error!.at)}): ${row.error!.message}. Showing the last good value.`;
    case "failing":
      return `Fetch failing: enter by hand or reconnect. ${row.error ? `Last error (${day(row.error.at)}): ${row.error.message}` : ""}${typed ? ` ${typed}.` : ""}`;
    case "waiting":
      return `Connected: the first daily fetch hasn't run yet. Enter by hand meanwhile.${typed ? ` ${typed}.` : ""}`;
    case "manual":
      return typed ?? "Entered by hand";
    case "not_connected":
      return "Not connected: enter by hand";
  }
}

/**
 * Issue #4. The homepage stats band's third figure is typed in here, by a
 * person, with the per-platform numbers below as guidance. Nothing on this page
 * changes the homepage except saving (or removing) the homepage figure.
 */
export default async function SocialReachPage(props: PageProps<"/console/social-reach">) {
  await requireConsole();
  const sp = await props.searchParams;
  const db = serviceDb();
  const read = (key: string) => must(db.from("settings").select("value").eq("key", key).maybeSingle(), `console/social-reach ${key}`);
  const [homepageRow, manualRow, fetchedRow, { count: subscribers }] = await Promise.all([
    read(SOCIAL_REACH_HOMEPAGE_KEY),
    read(SOCIAL_REACH_MANUAL_KEY),
    read(SOCIAL_REACH_FETCHED_KEY),
    mustList(newsletterAudience(db), "console/social-reach subscriber count"),
  ]);

  const homepage = parseHomepageReach(homepageRow?.value);
  const manual = parseManual(manualRow?.value);
  const rows = platformRows({ manual, fetched: parseFetched(fetchedRow?.value), connected: connectedPlatforms(), now: new Date() });
  const totals = rowTotals(rows);

  const saved = param(sp.saved);
  const error = param(sp.error);
  const homeErr = { value: param(sp.e_value), label: param(sp.e_label) };
  const homeTyped = homeErr.value || homeErr.label;
  const platformErr = (field: string) => param(sp[`pe_${field}`]);
  const platformTyped = Object.keys(sp).some((k) => k.startsWith("pe_"));
  /** What a platform input shows: what was just typed after a refused save, else the stored figure. */
  const typedOr = (field: string, stored: string) => (platformTyped ? (param(sp[`pv_${field}`]) ?? "") : stored);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-bold text-ink">Social reach</h1>
      <p className="mt-1 text-sm text-graphite">
        The third figure in the homepage&apos;s dark stats band. You choose the number and its caption; the platform figures
        below are there to help you decide, and never reach the homepage on their own.
      </p>
      {error && <p role="alert" className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{error}</p>}

      {/* ── The homepage figure: the only thing the public sees ── */}
      <section id="homepage" aria-labelledby="homepage-h" className="mt-6 rounded-xl bg-white p-4 shadow-sm">
        <h2 id="homepage-h" className="font-bold text-ink">Homepage figure</h2>
        {saved === "homepage" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved. The homepage shows it from the next page load.</p>}
        {saved === "cleared" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Removed. The homepage now shows just the two counted figures.</p>}
        <p className="mt-1 text-sm text-graphite">
          {homepage
            ? <>Showing now: <strong className="text-ink">{n(homepage.value)}</strong> · {homepage.label}{homepage.as_of && <> (as of {day(homepage.as_of)})</>}.</>
            : <>Nothing saved, so the homepage shows only Published articles and Member companies.</>}
        </p>

        <form action={saveSocialReachHomepage} className="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-start" noValidate>
          <div>
            <label htmlFor="reach-value" className="block text-sm font-semibold text-ink">Number</label>
            <input
              id="reach-value" name="value" inputMode="numeric" autoComplete="off" required className={INPUT}
              defaultValue={homeTyped ? param(sp.value) : homepage ? String(homepage.value) : ""}
              aria-invalid={homeErr.value ? true : undefined} aria-describedby={homeErr.value ? "reach-value-err" : undefined}
            />
            {homeErr.value && <p id="reach-value-err" className="mt-1 text-xs text-danger">{homeErr.value}</p>}
          </div>
          <div>
            <label htmlFor="reach-label" className="block text-sm font-semibold text-ink">Caption under the number</label>
            <input
              id="reach-label" name="label" maxLength={REACH_LABEL_MAX} required className={INPUT}
              defaultValue={homeTyped ? param(sp.label) : homepage?.label ?? DEFAULT_REACH_LABEL}
              aria-invalid={homeErr.label ? true : undefined} aria-describedby={`reach-label-hint${homeErr.label ? " reach-label-err" : ""}`}
            />
            <p id="reach-label-hint" className="mt-1 text-xs text-graphite">Up to {REACH_LABEL_MAX} characters. The heading above the number stays &ldquo;Promote your business&rdquo;.</p>
            {homeErr.label && <p id="reach-label-err" className="mt-1 text-xs text-danger">{homeErr.label}</p>}
          </div>
          <div className="sm:pt-6">
            <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              Save to homepage
            </SubmitButton>
          </div>
        </form>
        {homepage && (
          <form action={clearSocialReachHomepage} className="mt-3">
            <SubmitButton pendingLabel="Removing…" className="text-sm font-semibold text-danger underline disabled:opacity-50">
              Remove from homepage
            </SubmitButton>
          </form>
        )}
      </section>

      {/* ── Guidance: per platform, hand-entered or fetched ── */}
      <section id="platforms" aria-labelledby="platforms-h" className="mt-6 rounded-xl bg-white p-4 shadow-sm">
        <h2 id="platforms-h" className="font-bold text-ink">Platform figures (guidance only)</h2>
        {saved === "platforms" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Platform figures saved. The homepage is unchanged.</p>}
        {platformTyped && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">Some figures need fixing. Nothing was saved.</p>}
        <p className="mt-1 text-sm text-graphite">
          Facebook, Instagram and YouTube follower counts are fetched once a day when they&apos;re connected; everything else
          is typed in from each platform&apos;s own analytics. Views count the same person many times, so treat them as a
          sense of activity, not of people.
        </p>

        <form action={saveSocialReachPlatforms} noValidate>
          {/* relative: the inputs' sr-only labels are absolutely positioned, and
              without a positioned box here they escape this scroller's clipping
              and widen the whole page on a phone (#33). */}
          <div className="relative mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-graphite">
                  <th scope="col" className="py-2 pr-3">Platform</th>
                  <th scope="col" className="py-2 pr-3">Followers / subscribers</th>
                  <th scope="col" className="py-2 pr-3">Views</th>
                  <th scope="col" className="py-2">Views period</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const label = socialChannel(row.platform)?.label ?? row.platform;
                  const f = `${row.platform}.followers`, v = `${row.platform}.views`, pd = `${row.platform}.period`;
                  return (
                    <tr key={row.platform} className="border-b align-top">
                      <th scope="row" className="py-3 pr-3 font-semibold text-ink">
                        {label}
                        {row.platform === "youtube" && (
                          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" className="mt-1 block text-xs font-normal text-graphite underline">
                            YouTube Terms of Service
                          </a>
                        )}
                      </th>
                      <td className="py-3 pr-3">
                        {row.followers.mode === "auto" ? (
                          <p className="font-semibold text-ink">{n(row.followers.value)}</p>
                        ) : (
                          <>
                            <label htmlFor={f} className="sr-only">{label} followers</label>
                            <input
                              id={f} name={f} inputMode="numeric" autoComplete="off" className={INPUT}
                              defaultValue={typedOr(f, row.followers.value === null ? "" : String(row.followers.value))}
                              aria-invalid={platformErr(f) ? true : undefined} aria-describedby={`${f}-src${platformErr(f) ? ` ${f}-err` : ""}`}
                            />
                            {platformErr(f) && <p id={`${f}-err`} className="mt-1 text-xs text-danger">{platformErr(f)}</p>}
                          </>
                        )}
                        <p id={`${f}-src`} className="mt-1 text-xs text-graphite">{sourceText(row)}</p>
                        {row.platform === "youtube" && row.followers.mode === "auto" && (
                          <p className="mt-1 text-xs text-graphite">YouTube rounds this down to three significant figures. Shown exactly as returned.</p>
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        <label htmlFor={v} className="sr-only">{label} views</label>
                        <input
                          id={v} name={v} inputMode="numeric" autoComplete="off" className={INPUT}
                          defaultValue={typedOr(v, row.views ? String(row.views.value) : "")}
                          aria-invalid={platformErr(v) ? true : undefined} aria-describedby={platformErr(v) ? `${v}-err` : undefined}
                        />
                        {platformErr(v) && <p id={`${v}-err`} className="mt-1 text-xs text-danger">{platformErr(v)}</p>}
                        {row.views && <p className="mt-1 text-xs text-graphite">Entered by hand, {day(row.views.at)}</p>}
                      </td>
                      <td className="py-3">
                        <label htmlFor={pd} className="sr-only">{label} views period</label>
                        <input
                          id={pd} name={pd} maxLength={VIEWS_PERIOD_MAX} placeholder="e.g. last 30 days" className={INPUT}
                          defaultValue={typedOr(pd, row.views?.period ?? "")}
                          aria-invalid={platformErr(pd) ? true : undefined} aria-describedby={platformErr(pd) ? `${pd}-err` : undefined}
                        />
                        {platformErr(pd) && <p id={`${pd}-err`} className="mt-1 text-xs text-danger">{platformErr(pd)}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-b">
                  <th scope="row" className="py-3 pr-3 font-semibold text-ink">Sum of the figures above (guidance only)</th>
                  <td className="py-3 pr-3 font-semibold text-ink">{n(totals.followers)}</td>
                  <td className="py-3 pr-3 font-semibold text-ink" colSpan={2}>{n(totals.views)}</td>
                </tr>
                <tr>
                  <th scope="row" className="py-3 pr-3 font-semibold text-ink">Newsletter subscribers</th>
                  <td className="py-3 pr-3 font-semibold text-ink">{n(subscribers ?? 0)}</td>
                  <td className="py-3 text-xs text-graphite" colSpan={2}>
                    For reference: currently subscribed, not unsubscribed and not bounced, the same count the newsletter
                    composer shows. Not included in either sum.
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="mt-4">
            <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              Save platform figures
            </SubmitButton>
          </div>
        </form>
      </section>
    </div>
  );
}

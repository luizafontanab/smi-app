import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { getCrmSync } from "@/lib/adapters/crm";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { readBiginSourcesRun } from "@/lib/sources/bigin";
import { Pagination } from "@/components/Pagination";
import { SubmitButton } from "@/components/SubmitButton";
import { lastPage, pagedList } from "../paged-list";
import {
  addSource, deleteSource, dismissSuggestion, recheckSource, setSourceActive, startStoryFromSuggestion, syncSourcesFromBigin, updateSourceUrl,
} from "./actions";

export const dynamic = "force-dynamic";
// "Start story" reads the article, its image and the third-person rewrite in one
// go (lib/sources/draft.ts) — up to about a minute on a slow site. A page's
// maxDuration is also its server actions' time limit.
export const maxDuration = 120;
export const metadata = { title: "Story sources" };

const PAGE_SIZE = 50;

/** What each `content_sources.access` value means, in words for the console. */
const ACCESS_LABEL: Record<string, string> = {
  unknown: "Not checked yet",
  ok: "Readable",
  blocked: "Blocked — site refuses automated reading",
  not_found: "News page gone (404)",
  unreachable: "Site unreachable",
  empty: "Nothing readable found",
};
const METHOD_LABEL: Record<string, string> = { feed: "Feed", wp_api: "WordPress API", html: "News page", sitemap: "Sitemap" };
const ACCESS_FILTERS = ["all", "ok", "unknown", "blocked", "not_found", "unreachable", "empty", "paused", "bigin"] as const;
const FILTER_LABEL: Record<string, string> = { all: "All", paused: "Paused", bigin: "From Bigin" };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "—");

export default async function SourcesPage(props: PageProps<"/console/sources">) {
  await requireConsole();
  const sp = await props.searchParams;
  const view = sp.view === "sources" ? "sources" : "suggested";
  const page = Math.max(1, Number(sp.page) || 1);
  const access = ACCESS_FILTERS.find((a) => a === sp.access) ?? "all";
  const db = serviceDb();

  const [suggestions, drafted, sources, statusRows, crawlerOn, biginRun] = await Promise.all([
    view === "suggested"
      ? pagedList(
          (from, to) => db.from("source_items")
            .select("id, url, title, published_at, first_seen_at, source:content_sources(domain, label, member:members(name))", { count: "exact" })
            .eq("state", "new")
            .order("first_seen_at", { ascending: false })
            .range(from, to),
          page, PAGE_SIZE, "console/sources suggestions",
        )
      : Promise.resolve(null),
    view === "suggested"
      ? must(db.from("source_items")
          .select("id, title, story_id, updated_at, story:stories(title, status)")
          .eq("state", "drafted").order("updated_at", { ascending: false }).limit(10), "console/sources drafted")
      : Promise.resolve(null),
    view === "sources"
      ? pagedList((from, to) => {
          let q = db.from("content_sources")
            .select("id, url, domain, label, active, method, method_url, access, last_checked_at, last_item_at, failure_count, last_error, bigin_account_id, bigin_account_name, bigin_from_website, member:members(name, slug)", { count: "exact" });
          if (access === "paused") q = q.eq("active", false);
          else if (access === "bigin") q = q.not("bigin_account_id", "is", null);
          else if (access !== "all") q = q.eq("access", access).eq("active", true);
          return q.order("domain").range(from, to);
        }, page, PAGE_SIZE, "console/sources list")
      : Promise.resolve(null),
    must(db.from("content_sources").select("access, active, bigin_account_id"), "console/sources counts"),
    isFeatureEnabled("story_crawler"),
    view === "sources" ? readBiginSourcesRun() : Promise.resolve(null),
  ]);
  const biginConnected = getCrmSync().live;

  const counts = new Map<string, number>();
  for (const row of statusRows ?? []) {
    const key = row.active ? row.access : "paused";
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (row.bigin_account_id) counts.set("bigin", (counts.get("bigin") ?? 0) + 1);
  }
  const total = statusRows?.length ?? 0;
  const href = (q: Record<string, string | number>) =>
    `/console/sources?${new URLSearchParams(Object.entries({ view, ...q }).map(([k, v]) => [k, String(v)])).toString()}`;
  const returnTo = new URLSearchParams({ access, page: String(page) }).toString();

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-ink">Story sources</h1>
      <p className="mt-1 text-sm text-graphite">
        Company news pages checked once a day for articles that weren&apos;t there before — the imported list plus each
        Bigin company&apos;s News Page URL (or its Website, when that&apos;s blank). A suggestion only becomes a story when you start one, and that story goes
        through approval like any other.
      </p>

      {!crawlerOn && (
        <p className="mt-3 rounded bg-gold/25 p-2 text-sm text-ink">
          The story crawler is off, so no sources are being checked.{" "}
          <Link href="/console/features" className="underline">Turn it on in Features</Link>.
        </p>
      )}

      {typeof sp.error === "string" && <p role="alert" className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      {sp.added && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Source added — it will be read on the next check.</p>}
      {sp.queued && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Queued — the next check works out how to read it again.</p>}
      {sp.removed && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Source removed.</p>}
      {sp.bigin === "synced" && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Synced from Bigin.</p>}

      <div className="mt-4 flex gap-1 border-b text-sm">
        {(["suggested", "sources"] as const).map((v) => (
          <Link
            key={v}
            href={`/console/sources${v === "sources" ? "?view=sources" : ""}`}
            aria-current={v === view ? "page" : undefined}
            className={`rounded-t px-4 py-2 ${v === view ? "border border-b-0 bg-white font-semibold text-ink" : "text-graphite hover:text-ink"}`}
          >
            {v === "suggested" ? `Suggested${suggestions ? ` (${suggestions.count})` : ""}` : `Sources (${total})`}
          </Link>
        ))}
      </div>

      {view === "suggested" && suggestions && (
        <>
          <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-sm">
            {suggestions.data.length === 0 && (
              <p className="p-5 text-sm text-graphite">
                Nothing new. A source&apos;s first check only records what&apos;s already there — suggestions start from the check after.
              </p>
            )}
            <ul className="divide-y">
              {suggestions.data.map((item) => (
                <li key={item.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink hover:underline">
                      {item.title}
                    </a>
                    <p className="mt-0.5 text-xs text-graphite">
                      {item.source?.label ?? item.source?.domain}
                      {item.source?.member && <> · tags {item.source.member.name}</>}
                      {item.published_at && <> · published {day(item.published_at)}</>}
                      {" · "}found {day(item.first_seen_at)}
                    </p>
                  </div>
                  <form action={startStoryFromSuggestion}>
                    <input type="hidden" name="id" value={item.id} />
                    <SubmitButton pendingLabel="Preparing draft…" className="rounded bg-ink px-3 py-1.5 text-sm text-white disabled:opacity-50">Start story</SubmitButton>
                  </form>
                  <form action={dismissSuggestion}>
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="return" value={`page=${suggestions.page}`} />
                    <button className="rounded border px-3 py-1.5 text-sm text-graphite hover:text-ink">Dismiss</button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
          <Pagination page={suggestions.page} pages={lastPage(suggestions.count, PAGE_SIZE)} hrefFor={(p) => href({ page: p })} />

          {(drafted ?? []).length > 0 && (
            <section className="mt-6">
              <h2 className="text-sm font-bold text-ink">Recently started</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {(drafted ?? []).map((d) => (
                  <li key={d.id}>
                    {d.story_id ? (
                      <Link href={`/console/stories/${d.story_id}`} className="text-ink underline">{d.story?.title ?? d.title}</Link>
                    ) : (
                      <span className="text-graphite">{d.title} (story deleted)</span>
                    )}
                    {d.story?.status && <span className="ml-2 text-xs text-graphite">{d.story.status.replace("_", " ")}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {view === "sources" && sources && (
        <>
          <form action={addSource} className="mt-4 flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 text-sm shadow-sm">
            <label className="flex min-w-64 flex-1 flex-col">
              News page address
              <input name="url" required placeholder="https://example.co.uk/news/" className="mt-1 rounded border px-2 py-1" />
            </label>
            <label className="flex flex-col">
              Name (optional)
              <input name="label" className="mt-1 rounded border px-2 py-1" />
            </label>
            <button className="rounded bg-ink px-4 py-2 text-white">Add source</button>
          </form>

          <section aria-labelledby="bigin-sync" className="mt-4 rounded-xl bg-white p-4 text-sm shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="bigin-sync" className="font-bold text-ink">From Bigin</h2>
              <p className="flex-1 text-graphite">
                {!biginConnected
                  ? "Bigin isn't connected, so only the imported list is used."
                  : biginRun
                    ? `Last synced ${day(biginRun.at)}: ${biginRun.companies} companies with an address${biginRun.fromWebsite ? ` (${biginRun.fromWebsite} using their Website)` : ""} — ${biginRun.added} added, ${biginRun.linked} linked, ${biginRun.paused} paused${biginRun.complete ? "" : " (Bigin stopped part-way; nothing was paused)"}.`
                    : "Not synced yet — it runs once a day while the story crawler is on."}
              </p>
              {biginConnected && (
                <form action={syncSourcesFromBigin}>
                  <button className="rounded border px-3 py-1.5 text-sm" disabled={!crawlerOn}>Sync from Bigin now</button>
                </form>
              )}
            </div>
            {biginRun?.websiteFallbackWithheld && (
              <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-xs text-danger">
                No Bigin company came back with a News Page URL, so nothing was added from Websites either. Either the
                field is empty everywhere, or its name in Bigin isn&apos;t the one the app expects (News_Page_URL) — ask
                for it to be checked. Nothing already on the list was changed.
              </p>
            )}
            {biginRun && biginRun.skipped.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-danger">{biginRun.skipped.length} Bigin address{biginRun.skipped.length === 1 ? "" : "es"} skipped — fix in Bigin</summary>
                <ul className="mt-1 space-y-0.5 text-xs text-graphite">
                  {biginRun.skipped.map((x) => (
                    <li key={`${x.company}-${x.url}`}>
                      {x.company}: <span className="break-all">{x.url}</span> — {x.reason === "clash" ? "another company already lists this page" : "not a web address"}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          <nav aria-label="Filter sources" className="mt-4 flex flex-wrap gap-2 text-xs">
            {ACCESS_FILTERS.map((a) => (
              <Link
                key={a}
                href={href({ access: a })}
                aria-current={a === access ? "page" : undefined}
                className={`rounded-full border px-3 py-1 ${a === access ? "bg-ink text-white" : "bg-white text-graphite hover:text-ink"}`}
              >
                {FILTER_LABEL[a] ?? ACCESS_LABEL[a]} ({a === "all" ? total : counts.get(a) ?? 0})
              </Link>
            ))}
          </nav>

          <div className="mt-3 overflow-hidden rounded-xl bg-white shadow-sm">
            {sources.data.length === 0 && <p className="p-5 text-sm text-graphite">No sources here.</p>}
            <ul className="divide-y">
              {sources.data.map((s) => (
                <li key={s.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink hover:underline">
                      {s.label ?? s.domain}
                    </a>
                    <span className={`text-xs ${s.access === "ok" ? "text-success" : s.access === "unknown" ? "text-graphite" : "text-danger"}`}>
                      {s.active ? ACCESS_LABEL[s.access] ?? s.access : "Paused"}
                    </span>
                    {s.method && <span className="text-xs text-graphite">via {METHOD_LABEL[s.method] ?? s.method}</span>}
                    {s.bigin_account_id && (
                      <span className="rounded bg-shade px-1.5 py-0.5 text-xs text-ink">Bigin{s.bigin_account_name ? ` · ${s.bigin_account_name}` : ""}</span>
                    )}
                    {s.bigin_account_id && s.bigin_from_website && (
                      <span className="rounded border border-shade px-1.5 py-0.5 text-xs text-graphite">from website</span>
                    )}
                    {s.member && <span className="text-xs text-graphite">member: {s.member.name}</span>}
                    <span className="ml-auto text-xs text-graphite">
                      checked {day(s.last_checked_at)} · latest post {day(s.last_item_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 break-all text-xs text-graphite">{s.url}</p>
                  {s.last_error && <p className="mt-1 text-xs text-danger">{s.last_error}</p>}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-graphite hover:text-ink">Manage</summary>
                    <div className="mt-2 flex flex-wrap items-end gap-3">
                      {s.bigin_account_id ? (
                        <p className="text-xs text-graphite">
                          {s.bigin_from_website
                            ? "The address is the company's Website in Bigin, used because its News Page URL is blank — fill in the News Page URL there to replace it."
                            : "The address comes from Bigin — change or clear it there."}
                        </p>
                      ) : (
                        <form action={updateSourceUrl} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="id" value={s.id} />
                          <label className="flex flex-col text-xs">
                            Address
                            <input name="url" defaultValue={s.url} className="mt-1 w-80 rounded border px-2 py-1 text-sm" />
                          </label>
                          <button className="rounded border px-3 py-1 text-xs">Change address</button>
                        </form>
                      )}
                      <form action={recheckSource}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="return" value={returnTo} />
                        <button className="rounded border px-3 py-1 text-xs">Re-check</button>
                      </form>
                      <form action={setSourceActive}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="active" value={s.active ? "0" : "1"} />
                        <input type="hidden" name="return" value={returnTo} />
                        <button className="rounded border px-3 py-1 text-xs">{s.active ? "Pause" : "Resume"}</button>
                      </form>
                      {!s.bigin_account_id && (
                        <form action={deleteSource} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={s.id} />
                          <label className="flex items-center gap-1 text-xs">
                            <input type="checkbox" name="confirm" value="1" /> confirm
                          </label>
                          <button className="rounded border border-danger px-3 py-1 text-xs text-danger">Remove</button>
                        </form>
                      )}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </div>
          <Pagination page={sources.page} pages={lastPage(sources.count, PAGE_SIZE)} hrefFor={(p) => href({ access, page: p })} />
        </>
      )}
    </div>
  );
}

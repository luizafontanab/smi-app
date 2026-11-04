import type { SocialKey } from "./social";

/**
 * The homepage's "Social media reach" figure, and the guidance shown beside it
 * on /console/social-reach (issue #4; research in docs/social-reach.md).
 *
 * The public figure is a person's decision, not a computed one: an admin types
 * the number and its caption. Follower and view counts per platform sit beside
 * it as guidance only. Nothing here sums them into the homepage figure, because
 * views count the same person many times and Jas called a big follower number
 * "a bit of a sales gimmick".
 *
 * Four `settings` rows, one per writer, so a save never overwrites what another
 * writer just stored:
 *   · HOMEPAGE — the admin's number, caption and as-of date. All the public sees.
 *   · MANUAL   — the admin's per-platform followers and views.
 *   · FETCHED  — the daily job's per-platform follower counts (lib/adapters/social-followers).
 *   · INSTAGRAM_AUTH — the job's refreshed Instagram token. Never read by a page.
 *
 * Pure: parsing, validation and the row model. Reads and writes live with their callers.
 */

export const SOCIAL_REACH_HOMEPAGE_KEY = "social_reach_homepage";
export const SOCIAL_REACH_MANUAL_KEY = "social_reach_manual";
export const SOCIAL_REACH_FETCHED_KEY = "social_reach_fetched";
export const SOCIAL_REACH_INSTAGRAM_AUTH_KEY = "social_reach_instagram_auth";

export const DEFAULT_REACH_LABEL = "Social media reach";
export const REACH_LABEL_MAX = 60;
export const REACH_VALUE_MAX = 1_000_000_000;
export const VIEWS_PERIOD_MAX = 40;

/** The order rows appear in on the console page. */
export const REACH_PLATFORMS = ["linkedin", "facebook", "instagram", "youtube", "x", "tiktok"] as const satisfies readonly SocialKey[];
export type ReachPlatform = (typeof REACH_PLATFORMS)[number];

/** Platforms whose follower count the daily job can fetch. The rest are always typed in (docs/social-reach.md). */
export const AUTO_PLATFORMS = ["facebook", "instagram", "youtube"] as const satisfies readonly ReachPlatform[];
export type AutoPlatform = (typeof AUTO_PLATFORMS)[number];

const isAuto = (p: ReachPlatform): p is AutoPlatform => (AUTO_PLATFORMS as readonly string[]).includes(p);

/**
 * YouTube's Developer Policies III.E.4.b: a subscriber count may not be stored
 * for more than 30 days. Past that it is dropped, never shown.
 */
export const YOUTUBE_MAX_AGE_MS = 30 * 864e5;

export type HomepageReach = { value: number; label: string; as_of: string };
export type Dated = { value: number; at: string };
export type DatedViews = { value: number; period: string; at: string };
export type ManualEntry = { followers: Dated | null; views: DatedViews | null };
export type ManualValues = Record<ReachPlatform, ManualEntry>;
export type FetchError = { message: string; at: string };
/** The last good fetch (`value`/`at`, null if none) and the latest failure since it, if any. */
export type FetchedEntry = { value: number | null; at: string | null; error: FetchError | null };
export type FetchedValues = Partial<Record<AutoPlatform, FetchedEntry>>;

/* ---------- reading stored values (tolerant: malformed → empty) ---------- */

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const count = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const isoDate = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The homepage figure, or null — in which case the homepage hides the stat. */
export function parseHomepageReach(stored: unknown): HomepageReach | null {
  const r = record(stored);
  const value = count(r.value);
  if (value === null) return null;
  return { value, label: text(r.label, REACH_LABEL_MAX) || DEFAULT_REACH_LABEL, as_of: isoDate(r.as_of) ?? "" };
}

function parseDated(v: unknown): Dated | null {
  const r = record(v);
  const value = count(r.value);
  const at = isoDate(r.at);
  return value === null || !at ? null : { value, at };
}

function parseDatedViews(v: unknown): DatedViews | null {
  const dated = parseDated(v);
  return dated ? { ...dated, period: text(record(v).period, VIEWS_PERIOD_MAX) } : null;
}

export function parseManual(stored: unknown): ManualValues {
  const r = record(stored);
  return Object.fromEntries(
    REACH_PLATFORMS.map((p) => {
      const entry = record(r[p]);
      return [p, { followers: parseDated(entry.followers), views: parseDatedViews(entry.views) }];
    }),
  ) as ManualValues;
}

export function parseFetched(stored: unknown): FetchedValues {
  const r = record(stored);
  const out: FetchedValues = {};
  for (const p of AUTO_PLATFORMS) {
    if (!(p in r)) continue;
    const entry = record(r[p]);
    const value = count(entry.value);
    const at = isoDate(entry.at);
    const err = record(entry.error);
    const errAt = isoDate(err.at);
    out[p] = {
      value: value !== null && at ? value : null,
      at: value !== null && at ? at : null,
      error: typeof err.message === "string" && errAt ? { message: err.message.slice(0, 300), at: errAt } : null,
    };
  }
  return out;
}

/**
 * Drops a YouTube count older than YOUTUBE_MAX_AGE_MS. Used on both sides: the
 * job clears it from storage, and the page never shows one even if the job has
 * stopped running. A dropped count with no recorded failure gets one, so the
 * row reads "failing" rather than "waiting for the first fetch".
 */
export function freshFetched(fetched: FetchedValues, now: Date): FetchedValues {
  const yt = fetched.youtube;
  if (!yt?.at || now.getTime() - Date.parse(yt.at) <= YOUTUBE_MAX_AGE_MS) return fetched;
  return {
    ...fetched,
    youtube: { value: null, at: null, error: yt.error ?? { message: "No successful fetch in the last 30 days.", at: now.toISOString() } },
  };
}

/* ---------- console forms ---------- */

type NumberRead = { ok: true; value: number | null } | { ok: false };

/** "" → null; "12,500" → 12500; anything else not a whole number 0…MAX → refused. */
function readCount(raw: FormDataEntryValue | null): NumberRead {
  const s = String(raw ?? "").replace(/[,\s]/g, "");
  if (s === "") return { ok: true, value: null };
  if (!/^\d+$/.test(s)) return { ok: false };
  const n = Number(s);
  return n <= REACH_VALUE_MAX ? { ok: true, value: n } : { ok: false };
}

const COUNT_ERROR = `Enter a whole number of 0 or more (up to ${REACH_VALUE_MAX.toLocaleString("en-GB")}).`;

export function homepageReachFromForm(formData: FormData, now: Date): { value: HomepageReach } | { errors: Partial<Record<"value" | "label", string>> } {
  const errors: Partial<Record<"value" | "label", string>> = {};
  const n = readCount(formData.get("value"));
  if (!n.ok) errors.value = COUNT_ERROR;
  else if (n.value === null) errors.value = "Enter the number to show on the homepage.";
  const label = String(formData.get("label") ?? "").replace(/\s+/g, " ").trim();
  if (!label) errors.label = "Enter the caption to show under the number.";
  else if (label.length > REACH_LABEL_MAX) errors.label = `Keep the caption to ${REACH_LABEL_MAX} characters.`;
  if (errors.value || errors.label || !n.ok || n.value === null) return { errors };
  return { value: { value: n.value, label, as_of: now.toISOString() } };
}

/**
 * The guidance table's form → stored values. Field names are `<platform>.followers`,
 * `<platform>.views` and `<platform>.period`; errors are keyed the same way. A
 * figure keeps its old date when it is unchanged, so "Entered by hand, <date>"
 * says when the number was last typed, not when the form was last saved.
 */
export function manualFromForm(formData: FormData, previous: ManualValues, now: Date): { value: ManualValues } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const stamp = now.toISOString();
  const value = {} as ManualValues;
  for (const p of REACH_PLATFORMS) {
    const followers = readCount(formData.get(`${p}.followers`));
    const views = readCount(formData.get(`${p}.views`));
    const period = String(formData.get(`${p}.period`) ?? "").replace(/\s+/g, " ").trim();
    if (!followers.ok) errors[`${p}.followers`] = COUNT_ERROR;
    if (!views.ok) errors[`${p}.views`] = COUNT_ERROR;
    else if (views.value === null && period) errors[`${p}.views`] = "Add the views figure for that period, or clear the period.";
    if (period.length > VIEWS_PERIOD_MAX) errors[`${p}.period`] = `Keep the period to ${VIEWS_PERIOD_MAX} characters.`;
    if (!followers.ok || !views.ok) continue;
    const prev = previous[p];
    value[p] = {
      // A fetched row renders no followers input, so the field is absent, not
      // blank: keep the typed figure for when fetching stops.
      followers: !formData.has(`${p}.followers`) ? prev.followers
        : followers.value === null ? null
        : { value: followers.value, at: prev.followers?.value === followers.value ? prev.followers.at : stamp },
      views: views.value === null ? null
        : { value: views.value, period, at: prev.views?.value === views.value && prev.views.period === period ? prev.views.at : stamp },
    };
  }
  return Object.keys(errors).length ? { errors } : { value };
}

/* ---------- the console page's rows ---------- */

/**
 * What a row's followers column shows and where the figure came from:
 *   not_connected — no credentials (or a platform we never fetch): typed in.
 *   manual        — as above, with a typed-in figure.
 *   waiting       — credentials set, no fetch has run yet: typed in meanwhile.
 *   auto          — fetched, latest fetch succeeded.
 *   auto_stale    — fetched, but the latest fetch failed: last good value shown.
 *   failing       — credentials set, fetch failing, nothing good to show.
 */
export type RowStatus = "not_connected" | "manual" | "waiting" | "auto" | "auto_stale" | "failing";

export type ReachRow = {
  platform: ReachPlatform;
  status: RowStatus;
  followers: { mode: "auto"; value: number; at: string } | { mode: "manual"; value: number | null; at: string | null };
  views: DatedViews | null;
  error: FetchError | null;
};

export function platformRows({ manual, fetched, connected, now }: {
  manual: ManualValues;
  fetched: FetchedValues;
  connected: Record<AutoPlatform, boolean>;
  now: Date;
}): ReachRow[] {
  const fresh = freshFetched(fetched, now);
  return REACH_PLATFORMS.map((platform) => {
    const typed = manual[platform];
    const byHand = { mode: "manual" as const, value: typed.followers?.value ?? null, at: typed.followers?.at ?? null };
    const base = { platform, views: typed.views };
    if (!isAuto(platform) || !connected[platform]) {
      return { ...base, status: typed.followers ? "manual" : "not_connected", followers: byHand, error: null };
    }
    const f = fresh[platform];
    if (f?.value != null && f.at) {
      return { ...base, status: f.error ? "auto_stale" : "auto", followers: { mode: "auto", value: f.value, at: f.at }, error: f.error };
    }
    return { ...base, status: f?.error ? "failing" : "waiting", followers: byHand, error: f?.error ?? null };
  });
}

/** Column sums, as guidance only — the page labels them so. */
export function rowTotals(rows: ReachRow[]): { followers: number; views: number } {
  return rows.reduce(
    (t, r) => ({ followers: t.followers + (r.followers.value ?? 0), views: t.views + (r.views?.value ?? 0) }),
    { followers: 0, views: 0 },
  );
}

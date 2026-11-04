import { createHash } from "node:crypto";
import type { serviceDb } from "../db/server";
import type { Json } from "../db/types";
import {
  AUTO_PLATFORMS, SOCIAL_REACH_FETCHED_KEY, SOCIAL_REACH_INSTAGRAM_AUTH_KEY, freshFetched, parseFetched,
  type AutoPlatform, type FetchedValues,
} from "../social-reach";

/**
 * Follower counts for the console's Social reach page (issue #4), fetched once a
 * day by the `social_followers` job. Endpoints, scopes and token lifetimes are
 * in docs/social-reach.md. Each platform is inert while its env vars are unset:
 * no request goes out and its row on the page says "Not connected".
 *
 *   Facebook  — FACEBOOK_PAGE_ID + FACEBOOK_PAGE_ACCESS_TOKEN (long-lived Page token, no fixed expiry)
 *   Instagram — INSTAGRAM_ACCESS_TOKEN (Instagram Login, 60 days; refreshed here)
 *   YouTube   — YOUTUBE_API_KEY (+ optional YOUTUBE_CHANNEL_ID, defaulting to SMI's)
 *
 * Only follower counts. Views and impressions stay hand-entered: they count the
 * same person repeatedly, and Meta has renamed them twice since 2024.
 *
 * A platform's failure comes back as a value, never a throw, and its message
 * never carries a token or key (it only quotes the platform's own error text).
 * A failed read or write of our own `settings` rows does throw, so the job retries.
 */

type Env = Record<string, string | undefined>;
type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
type Db = ReturnType<typeof serviceDb>;

/** null = not configured. */
export type FollowerResult = { ok: true; value: number } | { ok: false; error: string } | null;

/** Graph API version. Meta retires each about two years after release; bump it then. */
export const GRAPH_VERSION = "v25.0";
/** SMI's channel (src/lib/social.ts SMI_SOCIAL_URLS). */
export const SMI_YOUTUBE_CHANNEL_ID = "UCwg7Css79gc_adlmO3_fVxA";
/**
 * Instagram tokens last 60 days and can only be refreshed once at least a day
 * old. Refreshing weekly leaves seven missed daily runs' slack before anything
 * is at risk, and 50+ days for someone to act on a failure.
 */
export const INSTAGRAM_REFRESH_AFTER_MS = 7 * 864e5;
export const INSTAGRAM_TOKEN_LIFETIME_MS = 60 * 864e5;
const TIMEOUT_MS = 15_000;

export function connectedPlatforms(env: Env = process.env): Record<AutoPlatform, boolean> {
  return {
    facebook: Boolean(env.FACEBOOK_PAGE_ID && env.FACEBOOK_PAGE_ACCESS_TOKEN),
    instagram: Boolean(env.INSTAGRAM_ACCESS_TOKEN),
    youtube: Boolean(env.YOUTUBE_API_KEY),
  };
}

/** GET a JSON body, folding HTTP, network and platform errors into one message. */
async function getJson(url: URL, fetchFn: FetchFn): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetchFn(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch (e) {
    return { ok: false, error: `Request failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const platformError = (body.error as { message?: unknown } | undefined)?.message;
  if (!res.ok || platformError) {
    return { ok: false, error: `HTTP ${res.status}${typeof platformError === "string" ? `: ${platformError}` : ""}`.slice(0, 300) };
  }
  return { ok: true, body };
}

const asCount = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
};

export async function fetchFacebookFollowers(env: Env, fetchFn: FetchFn = fetch): Promise<FollowerResult> {
  if (!env.FACEBOOK_PAGE_ID || !env.FACEBOOK_PAGE_ACCESS_TOKEN) return null;
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(env.FACEBOOK_PAGE_ID)}`);
  url.searchParams.set("fields", "followers_count");
  url.searchParams.set("access_token", env.FACEBOOK_PAGE_ACCESS_TOKEN);
  const r = await getJson(url, fetchFn);
  if (!r.ok) return r;
  const value = asCount(r.body.followers_count);
  return value === null ? { ok: false, error: "Facebook returned no followers_count." } : { ok: true, value };
}

export async function fetchInstagramFollowers(token: string, fetchFn: FetchFn = fetch): Promise<FollowerResult> {
  const url = new URL("https://graph.instagram.com/me");
  url.searchParams.set("fields", "followers_count");
  url.searchParams.set("access_token", token);
  const r = await getJson(url, fetchFn);
  if (!r.ok) return r;
  const value = asCount(r.body.followers_count);
  return value === null ? { ok: false, error: "Instagram returned no followers_count." } : { ok: true, value };
}

/**
 * `statistics.subscriberCount`, which YouTube rounds down to three significant
 * figures before returning. Returned as given: Developer Policies III.E.4.f/h
 * forbid showing anything but the API's own figure.
 */
export async function fetchYoutubeSubscribers(env: Env, fetchFn: FetchFn = fetch): Promise<FollowerResult> {
  if (!env.YOUTUBE_API_KEY) return null;
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "statistics");
  url.searchParams.set("id", env.YOUTUBE_CHANNEL_ID || SMI_YOUTUBE_CHANNEL_ID);
  url.searchParams.set("key", env.YOUTUBE_API_KEY);
  const r = await getJson(url, fetchFn);
  if (!r.ok) return r;
  const items = Array.isArray(r.body.items) ? (r.body.items as Array<{ statistics?: Record<string, unknown> }>) : [];
  const stats = items[0]?.statistics;
  if (!stats) return { ok: false, error: "YouTube channel not found." };
  if (stats.hiddenSubscriberCount === true) return { ok: false, error: "The channel's subscriber count is hidden on YouTube." };
  const value = asCount(stats.subscriberCount);
  return value === null ? { ok: false, error: "YouTube returned no subscriberCount." } : { ok: true, value };
}

/* ---------- Instagram token upkeep ---------- */

type InstagramAuth = { token: string; obtained_at: string; env_fingerprint: string };

/** Identifies which pasted env token a stored one descends from, without storing the env token's value twice. */
const fingerprint = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 16);

function parseAuth(v: unknown): InstagramAuth | null {
  const r = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return typeof r.token === "string" && typeof r.obtained_at === "string" && typeof r.env_fingerprint === "string"
    ? { token: r.token, obtained_at: r.obtained_at, env_fingerprint: r.env_fingerprint }
    : null;
}

async function readSetting(db: Db, key: string): Promise<unknown> {
  const { data, error } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(`social_followers: reading ${key}: ${error.message}`);
  return data?.value ?? null;
}

async function writeSetting(db: Db, key: string, value: unknown) {
  const { error } = await db.from("settings").upsert({ key, value: value as Json });
  if (error) throw new Error(`social_followers: saving ${key}: ${error.message}`);
}

/**
 * The token to read Instagram with, refreshing it when due. A stored token
 * belongs to the env token it descends from: paste a new INSTAGRAM_ACCESS_TOKEN
 * and the stored chain is dropped for it. A newly adopted token is assumed
 * fresh (HUMAN-TODO says to paste one straight after generating it).
 */
async function instagramToken(db: Db, envToken: string, fetchFn: FetchFn, now: Date): Promise<{ token: string; problem: string | null }> {
  const fp = fingerprint(envToken);
  const stored = parseAuth(await readSetting(db, SOCIAL_REACH_INSTAGRAM_AUTH_KEY));
  let auth = stored?.env_fingerprint === fp ? stored : null;
  if (!auth) {
    auth = { token: envToken, obtained_at: now.toISOString(), env_fingerprint: fp };
    await writeSetting(db, SOCIAL_REACH_INSTAGRAM_AUTH_KEY, auth);
    return { token: auth.token, problem: null };
  }
  const age = now.getTime() - Date.parse(auth.obtained_at);
  if (!(age >= INSTAGRAM_REFRESH_AFTER_MS)) return { token: auth.token, problem: null };

  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", auth.token);
  const r = await getJson(url, fetchFn);
  const fresh = r.ok && typeof r.body.access_token === "string" ? r.body.access_token : null;
  if (!fresh) {
    const daysLeft = Math.max(0, Math.floor((Date.parse(auth.obtained_at) + INSTAGRAM_TOKEN_LIFETIME_MS - now.getTime()) / 864e5));
    const why = r.ok ? "no access_token in the response" : r.error;
    return {
      token: auth.token,
      problem: `Instagram token refresh failed (${why}). It expires in about ${daysLeft} days; after that, generate a new one and set INSTAGRAM_ACCESS_TOKEN.`,
    };
  }
  await writeSetting(db, SOCIAL_REACH_INSTAGRAM_AUTH_KEY, { token: fresh, obtained_at: now.toISOString(), env_fingerprint: fp });
  return { token: fresh, problem: null };
}

/* ---------- the daily job ---------- */

/**
 * Fetch every configured platform and store the results. A failure keeps the
 * platform's last good value and records the error beside it, except that a
 * YouTube count is dropped once 30 days old (freshFetched) — which also runs
 * when YouTube is no longer configured, so a stored count never outlives it.
 *
 * Returns the Instagram refresh problem, if any, for the job to raise: a dying
 * token has to reach a person, not just a log line.
 */
export async function refreshSocialFollowers({ db, env = process.env, fetchFn = fetch, now = new Date() }: {
  db: Db;
  env?: Env;
  fetchFn?: FetchFn;
  now?: Date;
}): Promise<{ instagramProblem: string | null }> {
  const connected = connectedPlatforms(env);
  const before = parseFetched(await readSetting(db, SOCIAL_REACH_FETCHED_KEY));
  if (!AUTO_PLATFORMS.some((p) => connected[p]) && !Object.keys(before).length) return { instagramProblem: null };

  let instagramProblem: string | null = null;
  const results: Partial<Record<AutoPlatform, FollowerResult>> = {
    facebook: await fetchFacebookFollowers(env, fetchFn),
    youtube: await fetchYoutubeSubscribers(env, fetchFn),
  };
  if (env.INSTAGRAM_ACCESS_TOKEN) {
    const { token, problem } = await instagramToken(db, env.INSTAGRAM_ACCESS_TOKEN, fetchFn, now);
    instagramProblem = problem;
    results.instagram = await fetchInstagramFollowers(token, fetchFn);
  }

  const next: FetchedValues = { ...before };
  const at = now.toISOString();
  for (const p of AUTO_PLATFORMS) {
    const r = results[p];
    if (!r) continue;
    next[p] = r.ok
      ? { value: r.value, at, error: null }
      : { value: before[p]?.value ?? null, at: before[p]?.at ?? null, error: { message: r.error, at } };
  }
  const kept = freshFetched(next, now);
  if (JSON.stringify(kept) !== JSON.stringify(before)) await writeSetting(db, SOCIAL_REACH_FETCHED_KEY, kept);
  return { instagramProblem };
}

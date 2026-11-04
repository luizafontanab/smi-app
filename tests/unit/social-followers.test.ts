import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INSTAGRAM_REFRESH_AFTER_MS, connectedPlatforms, fetchFacebookFollowers, fetchInstagramFollowers, fetchYoutubeSubscribers,
  refreshSocialFollowers,
} from "@/lib/adapters/social-followers";
import { SOCIAL_REACH_FETCHED_KEY, SOCIAL_REACH_INSTAGRAM_AUTH_KEY, YOUTUBE_MAX_AGE_MS } from "@/lib/social-reach";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";

const NOW = new Date("2026-11-04T03:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const DAY = 864e5;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A fetch stub routed by host + path, so a test names exactly the calls it expects. */
function http(routes: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const route = routes[`${url.host}${url.pathname}`];
    if (!route) throw new Error(`unexpected fetch ${url.host}${url.pathname}`);
    return route();
  });
}

const FB = { FACEBOOK_PAGE_ID: "123", FACEBOOK_PAGE_ACCESS_TOKEN: "fb-secret" };
const YT = { YOUTUBE_API_KEY: "yt-secret" };
const IG = { INSTAGRAM_ACCESS_TOKEN: "ig-env-secret" };

afterEach(() => vi.restoreAllMocks());

describe("connectedPlatforms", () => {
  it("is all false with no env set", () => {
    expect(connectedPlatforms({})).toEqual({ facebook: false, instagram: false, youtube: false });
  });

  it("needs both the Page id and its token for Facebook", () => {
    expect(connectedPlatforms({ FACEBOOK_PAGE_ID: "123" }).facebook).toBe(false);
    expect(connectedPlatforms({ ...FB, ...IG, ...YT })).toEqual({ facebook: true, instagram: true, youtube: true });
  });
});

describe("fetchFacebookFollowers", () => {
  it("is inert (null, no request) without credentials", async () => {
    const f = http({});
    expect(await fetchFacebookFollowers({}, f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("reads followers_count from the Page node", async () => {
    const f = http({ "graph.facebook.com/v25.0/123": () => json({ followers_count: 2310, id: "123" }) });
    expect(await fetchFacebookFollowers(FB, f)).toEqual({ ok: true, value: 2310 });
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.searchParams.get("fields")).toBe("followers_count");
  });

  it("reports Graph's error message — and never the token", async () => {
    const f = http({ "graph.facebook.com/v25.0/123": () => json({ error: { message: "Error validating access token", code: 190 } }, 400) });
    const result = await fetchFacebookFollowers(FB, f);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("Error validating access token") });
    expect(JSON.stringify(result)).not.toContain("fb-secret");
  });

  it("treats a network failure as an error, not a throw", async () => {
    const f = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await fetchFacebookFollowers(FB, f)).toEqual({ ok: false, error: expect.stringContaining("fetch failed") });
  });
});

describe("fetchInstagramFollowers", () => {
  it("reads followers_count for the token's own account", async () => {
    const f = http({ "graph.instagram.com/me": () => json({ followers_count: 870 }) });
    expect(await fetchInstagramFollowers("tok", f)).toEqual({ ok: true, value: 870 });
  });

  it("an answer with no count is an error", async () => {
    const f = http({ "graph.instagram.com/me": () => json({ id: "1" }) });
    expect(await fetchInstagramFollowers("tok", f)).toEqual({ ok: false, error: expect.any(String) });
  });
});

describe("fetchYoutubeSubscribers", () => {
  it("is inert without an API key", async () => {
    const f = http({});
    expect(await fetchYoutubeSubscribers({}, f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("returns subscriberCount exactly as YouTube gives it (already rounded down to 3 significant figures)", async () => {
    const f = http({
      "www.googleapis.com/youtube/v3/channels": () => json({ items: [{ statistics: { subscriberCount: "1230", hiddenSubscriberCount: false } }] }),
    });
    expect(await fetchYoutubeSubscribers(YT, f)).toEqual({ ok: true, value: 1230 });
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.searchParams.get("part")).toBe("statistics");
    expect(url.searchParams.get("id")).toBe("UCwg7Css79gc_adlmO3_fVxA");
  });

  it("uses YOUTUBE_CHANNEL_ID when set", async () => {
    const f = http({ "www.googleapis.com/youtube/v3/channels": () => json({ items: [{ statistics: { subscriberCount: "5" } }] }) });
    await fetchYoutubeSubscribers({ ...YT, YOUTUBE_CHANNEL_ID: "UCother" }, f);
    expect(new URL(String(f.mock.calls[0][0])).searchParams.get("id")).toBe("UCother");
  });

  it("a hidden count or a missing channel is an error", async () => {
    const hidden = http({ "www.googleapis.com/youtube/v3/channels": () => json({ items: [{ statistics: { hiddenSubscriberCount: true } }] }) });
    expect(await fetchYoutubeSubscribers(YT, hidden)).toEqual({ ok: false, error: expect.stringMatching(/hidden/i) });
    const missing = http({ "www.googleapis.com/youtube/v3/channels": () => json({ items: [] }) });
    expect(await fetchYoutubeSubscribers(YT, missing)).toEqual({ ok: false, error: expect.stringMatching(/not found/i) });
  });

  it("reports the API's error without the key", async () => {
    const f = http({ "www.googleapis.com/youtube/v3/channels": () => json({ error: { message: "API key not valid" } }, 400) });
    const result = await fetchYoutubeSubscribers(YT, f);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("API key not valid") });
    expect(JSON.stringify(result)).not.toContain("yt-secret");
  });
});

/* ---------- the daily job ---------- */

/** settings rows by key, plus a spy on every upsert. */
function settingsDb(rows: Record<string, unknown>, opts: { upsertError?: string } = {}) {
  const upserts: Array<{ key: string; value: unknown }> = [];
  const db = mockDb({
    from: fromByTable({
      settings: () => {
        const b = queryBuilder(() => {
          const eq = (b.eq as ReturnType<typeof vi.fn>).mock.calls.at(-1);
          const key = eq?.[1] as string | undefined;
          return dbOk(key && key in rows ? { value: rows[key] } : null);
        });
        (b as Record<string, unknown>).upsert = vi.fn((row: { key: string; value: unknown }) => {
          upserts.push(row);
          return queryBuilder(opts.upsertError ? dbError(opts.upsertError) : dbOk(null));
        });
        return b;
      },
    }),
  });
  return { db: asDb(db), upserts };
}
const written = (upserts: Array<{ key: string; value: unknown }>, key: string) => upserts.filter((u) => u.key === key).at(-1)?.value;

describe("refreshSocialFollowers", () => {
  it("does nothing at all with no credentials set", async () => {
    const { db, upserts } = settingsDb({});
    const f = http({});
    expect(await refreshSocialFollowers({ db, env: {}, fetchFn: f, now: NOW })).toEqual({ instagramProblem: null });
    expect(f).not.toHaveBeenCalled();
    expect(upserts).toEqual([]);
  });

  it("stores each configured platform's count with the time it was taken", async () => {
    const { db, upserts } = settingsDb({});
    const f = http({
      "graph.facebook.com/v25.0/123": () => json({ followers_count: 2310 }),
      "www.googleapis.com/youtube/v3/channels": () => json({ items: [{ statistics: { subscriberCount: "1230" } }] }),
    });
    await refreshSocialFollowers({ db, env: { ...FB, ...YT }, fetchFn: f, now: NOW });
    expect(written(upserts, SOCIAL_REACH_FETCHED_KEY)).toEqual({
      facebook: { value: 2310, at: NOW.toISOString(), error: null },
      youtube: { value: 1230, at: NOW.toISOString(), error: null },
    });
  });

  it("an API error keeps the last good value and records the error beside it", async () => {
    const before = { facebook: { value: 2300, at: ago(2 * DAY), error: null } };
    const { db, upserts } = settingsDb({ [SOCIAL_REACH_FETCHED_KEY]: before });
    const f = http({ "graph.facebook.com/v25.0/123": () => json({ error: { message: "Service temporarily unavailable" } }, 503) });
    await refreshSocialFollowers({ db, env: FB, fetchFn: f, now: NOW });
    expect(written(upserts, SOCIAL_REACH_FETCHED_KEY)).toEqual({
      facebook: { value: 2300, at: ago(2 * DAY), error: { message: expect.stringContaining("Service temporarily unavailable"), at: NOW.toISOString() } },
    });
  });

  it("a success after a failure clears the error", async () => {
    const before = { facebook: { value: 2300, at: ago(2 * DAY), error: { message: "x", at: ago(DAY) } } };
    const { db, upserts } = settingsDb({ [SOCIAL_REACH_FETCHED_KEY]: before });
    const f = http({ "graph.facebook.com/v25.0/123": () => json({ followers_count: 2320 }) });
    await refreshSocialFollowers({ db, env: FB, fetchFn: f, now: NOW });
    expect(written(upserts, SOCIAL_REACH_FETCHED_KEY)).toEqual({ facebook: { value: 2320, at: NOW.toISOString(), error: null } });
  });

  it("a failing YouTube fetch keeps a count under 30 days old", async () => {
    const at = ago(YOUTUBE_MAX_AGE_MS - DAY);
    const { db, upserts } = settingsDb({ [SOCIAL_REACH_FETCHED_KEY]: { youtube: { value: 1230, at, error: null } } });
    const f = http({ "www.googleapis.com/youtube/v3/channels": () => json({ error: { message: "quotaExceeded" } }, 403) });
    await refreshSocialFollowers({ db, env: YT, fetchFn: f, now: NOW });
    expect(written(upserts, SOCIAL_REACH_FETCHED_KEY)).toEqual({ youtube: { value: 1230, at, error: expect.objectContaining({ at: NOW.toISOString() }) } });
  });

  it("a failing YouTube fetch past 30 days clears the stored count instead of keeping it", async () => {
    const { db, upserts } = settingsDb({ [SOCIAL_REACH_FETCHED_KEY]: { youtube: { value: 1230, at: ago(YOUTUBE_MAX_AGE_MS + DAY), error: null } } });
    const f = http({ "www.googleapis.com/youtube/v3/channels": () => json({ error: { message: "quotaExceeded" } }, 403) });
    await refreshSocialFollowers({ db, env: YT, fetchFn: f, now: NOW });
    expect(written(upserts, SOCIAL_REACH_FETCHED_KEY)).toEqual({ youtube: { value: null, at: null, error: expect.objectContaining({ message: expect.stringContaining("quotaExceeded") }) } });
  });

  it("clears a YouTube count past 30 days even once the API key has been removed", async () => {
    const { db, upserts } = settingsDb({ [SOCIAL_REACH_FETCHED_KEY]: { youtube: { value: 1230, at: ago(YOUTUBE_MAX_AGE_MS + DAY), error: null } } });
    await refreshSocialFollowers({ db, env: {}, fetchFn: http({}), now: NOW });
    expect(written(upserts, SOCIAL_REACH_FETCHED_KEY)).toEqual({ youtube: { value: null, at: null, error: expect.any(Object) } });
  });

  it("throws when the fetched values can't be saved, so the job retries", async () => {
    const { db } = settingsDb({}, { upsertError: "db down" });
    const f = http({ "graph.facebook.com/v25.0/123": () => json({ followers_count: 1 }) });
    await expect(refreshSocialFollowers({ db, env: FB, fetchFn: f, now: NOW })).rejects.toThrow(/db down/);
  });

  describe("Instagram's 60-day token", () => {
    it("adopts a newly pasted env token without refreshing it yet", async () => {
      const { db, upserts } = settingsDb({});
      const f = http({ "graph.instagram.com/me": () => json({ followers_count: 870 }) });
      await refreshSocialFollowers({ db, env: IG, fetchFn: f, now: NOW });
      expect(f.mock.calls.map(([u]) => new URL(String(u)).pathname)).toEqual(["/me"]);
      const auth = written(upserts, SOCIAL_REACH_INSTAGRAM_AUTH_KEY) as Record<string, unknown>;
      expect(auth).toMatchObject({ token: "ig-env-secret", obtained_at: NOW.toISOString() });
      expect(written(upserts, SOCIAL_REACH_FETCHED_KEY)).toEqual({ instagram: { value: 870, at: NOW.toISOString(), error: null } });
    });

    it("refreshes a token once it's due, stores the new one and reads with it", async () => {
      const first = settingsDb({});
      await refreshSocialFollowers({ db: first.db, env: IG, fetchFn: http({ "graph.instagram.com/me": () => json({ followers_count: 1 }) }), now: new Date(NOW.getTime() - INSTAGRAM_REFRESH_AFTER_MS) });
      const stored = written(first.upserts, SOCIAL_REACH_INSTAGRAM_AUTH_KEY);

      const { db, upserts } = settingsDb({ [SOCIAL_REACH_INSTAGRAM_AUTH_KEY]: stored });
      const f = http({
        "graph.instagram.com/refresh_access_token": () => json({ access_token: "ig-new", token_type: "bearer", expires_in: 5_184_000 }),
        "graph.instagram.com/me": () => json({ followers_count: 880 }),
      });
      expect(await refreshSocialFollowers({ db, env: IG, fetchFn: f, now: NOW })).toEqual({ instagramProblem: null });
      const refreshUrl = new URL(String(f.mock.calls[0][0]));
      expect(refreshUrl.searchParams.get("grant_type")).toBe("ig_refresh_token");
      expect(refreshUrl.searchParams.get("access_token")).toBe("ig-env-secret");
      expect(new URL(String(f.mock.calls[1][0])).searchParams.get("access_token")).toBe("ig-new");
      expect(written(upserts, SOCIAL_REACH_INSTAGRAM_AUTH_KEY)).toMatchObject({ token: "ig-new", obtained_at: NOW.toISOString() });
    });

    it("doesn't refresh a token that isn't due", async () => {
      const first = settingsDb({});
      await refreshSocialFollowers({ db: first.db, env: IG, fetchFn: http({ "graph.instagram.com/me": () => json({ followers_count: 1 }) }), now: new Date(NOW.getTime() - DAY) });
      const { db } = settingsDb({ [SOCIAL_REACH_INSTAGRAM_AUTH_KEY]: written(first.upserts, SOCIAL_REACH_INSTAGRAM_AUTH_KEY) });
      const f = http({ "graph.instagram.com/me": () => json({ followers_count: 2 }) });
      await refreshSocialFollowers({ db, env: IG, fetchFn: f, now: NOW });
      expect(f).toHaveBeenCalledTimes(1);
    });

    it("reports a failed refresh as a problem (the job turns it into a visible failure), still reading with the old token", async () => {
      const first = settingsDb({});
      await refreshSocialFollowers({ db: first.db, env: IG, fetchFn: http({ "graph.instagram.com/me": () => json({ followers_count: 1 }) }), now: new Date(NOW.getTime() - INSTAGRAM_REFRESH_AFTER_MS) });
      const { db, upserts } = settingsDb({ [SOCIAL_REACH_INSTAGRAM_AUTH_KEY]: written(first.upserts, SOCIAL_REACH_INSTAGRAM_AUTH_KEY) });
      const f = http({
        "graph.instagram.com/refresh_access_token": () => json({ error: { message: "Session has expired" } }, 400),
        "graph.instagram.com/me": () => json({ followers_count: 875 }),
      });
      const result = await refreshSocialFollowers({ db, env: IG, fetchFn: f, now: NOW });
      expect(result.instagramProblem).toMatch(/Session has expired/);
      expect(result.instagramProblem).not.toContain("ig-env-secret");
      expect(new URL(String(f.mock.calls[1][0])).searchParams.get("access_token")).toBe("ig-env-secret");
      expect(written(upserts, SOCIAL_REACH_FETCHED_KEY)).toEqual({ instagram: { value: 875, at: NOW.toISOString(), error: null } });
    });

    it("starts over from a new env token when someone pastes a different one", async () => {
      const { db, upserts } = settingsDb({
        [SOCIAL_REACH_INSTAGRAM_AUTH_KEY]: { token: "ig-refreshed-old", obtained_at: ago(3 * DAY), env_fingerprint: "not-this-one" },
      });
      const f = http({ "graph.instagram.com/me": () => json({ followers_count: 1 }) });
      await refreshSocialFollowers({ db, env: { INSTAGRAM_ACCESS_TOKEN: "ig-pasted-new" }, fetchFn: f, now: NOW });
      expect(new URL(String(f.mock.calls[0][0])).searchParams.get("access_token")).toBe("ig-pasted-new");
      expect(written(upserts, SOCIAL_REACH_INSTAGRAM_AUTH_KEY)).toMatchObject({ token: "ig-pasted-new" });
    });
  });
});

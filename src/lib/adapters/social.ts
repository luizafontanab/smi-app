/**
 * SocialPublisher adapter (TECH-DECISIONS #10): Buffer bridge for v1,
 * direct platform APIs channel-by-channel later. Local dev: logging stub.
 *
 * GAPS B4.4: this talks to Buffer's *current* GraphQL API (`api.buffer.com`).
 * It used to POST the v1 REST endpoint `api.bufferapp.com/1/updates/create.json`,
 * which has been closed to new developer credentials since 2019 — that path
 * could never have authenticated, and it had never been run (BUFFER_ACCESS_TOKEN
 * has never been set in any environment). Two consequences worth knowing:
 *
 *   - GraphQL returns failures as a *typed union with HTTP 200*, so `res.ok` is
 *     not a success check. `publishToChannel` discriminates positively on
 *     `__typename` — anything else is a failure. Getting this wrong means every
 *     failed post silently marks its job `done` and increments the daily cap.
 *   - `profile_ids[]` is gone: one mutation per channel, so `publish()` fans out.
 *
 * GAPS B4.2: `tagHandles` is populated from `members.social` — there is no
 * separate CRM-stored handle field anywhere in the schema, despite this
 * file's original docstring implying one. `members.social` IS the
 * CRM-stored handle: every call site (`jobs.ts`'s story/video social push)
 * reads it from the member row, never hand-typed at post time.
 *
 * ⚠ `mediaUrl()` builds on NEXT_PUBLIC_SUPABASE_URL, which locally is 127.0.0.1.
 * Buffer requires a *publicly accessible* asset URL, so running this against a
 * real key from a dev machine now fails loudly. That's the fix working, not a
 * regression — the old code swallowed it.
 */

import { socialHandle, socialHref } from "@/lib/social";
import { mediaUrl, serviceDb } from "../db/server";
import { readSocialChannels } from "../social-channels";

const BUFFER_API = "https://api.buffer.com";

/**
 * Our own queue owns the timing: `publish_scheduled` enqueues `social_push` at
 * +caps.delay_minutes and `social_push` defers past the daily cap itself
 * (`jobs.ts`). Buffer must therefore post at the moment we call and add no
 * schedule of its own — a queue-shaped mode would stack Buffer's delay on top
 * of ours, break the "live → posted ~30 min later" expectation, and make the
 * cap accounting fiction (it counts jobs that handed off, not posts that went out).
 * For the same reason we send no `dueAt`.
 *
 * ⚠ UNVERIFIED: these two enum literals have not been checked against a live
 * schema — no API key exists yet (HUMAN-TODO). Confirm by introspection on the
 * first real key. They are consts so there is exactly one place to correct.
 */
const SHARE_MODE = "shareNow";
const SCHEDULING_TYPE = "custom";

const CREATE_POST = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id } }
      ... on MutationError { message }
    }
  }`;

export type SocialPost = {
  text: string;
  imagePath: string | null;
  tagHandles: Record<string, string>; // { linkedin: "company/x", x: "handle", ... }
};

export interface SocialPublisher {
  publish(post: SocialPost): Promise<void>;
}

/**
 * "channel:handle" pairs, readable in the dev-log stub. Also the fallback
 * for a real post's text body (GAPS B4.1/B4.3): Buffer *does* support real
 * LinkedIn @-mentions via `metadata.linkedin.annotations[]`, but each one needs
 * a `urn:li:organization:<id>` we don't store and can't derive from the vanity
 * name in `members.social`. Until that data exists, tags ride along in the text
 * rather than silently vanishing. See GAPS B4.3 for what closing it needs.
 */
function formatTags(tagHandles: Record<string, string>): string {
  return Object.entries(tagHandles)
    .map(([ch, h]) => {
      const href = socialHref(ch, h);
      return `${ch}:${(href && socialHandle(ch, href)) ?? h}`;
    })
    .join(" ");
}

class LoggingSocialStub implements SocialPublisher {
  async publish(post: SocialPost): Promise<void> {
    const tags = formatTags(post.tagHandles);
    console.log(`[social] would post (${tags || "no tags"}): ${post.text.split("\n")[0].slice(0, 80)}`);
  }
}

/** Which connected Buffer channels a post goes to — one createPost mutation each. */
async function bufferChannels(): Promise<{ channelIds: string[]; legacyProfileIds: string[] }> {
  const { data } = await serviceDb().from("settings").select("value").eq("key", "social_channels").maybeSingle();
  return readSocialChannels(data?.value);
}

type ChannelInput = {
  text: string;
  channelId: string;
  mode: string;
  schedulingType: string;
  assets?: { image: { url: string } }[];
};

class BufferPublisher implements SocialPublisher {
  constructor(private token: string) {}

  async publish(post: SocialPost): Promise<void> {
    const { channelIds, legacyProfileIds } = await bufferChannels();
    if (!channelIds.length) {
      // Fail closed rather than let Buffer reject a channel-less request with a
      // cryptic error — same posture as the other adapters (A7.5, B3.1).
      const stale = legacyProfileIds.length
        ? " The stored ids are Buffer v1 profile ids, which the current API does not accept — re-enter them as channel ids."
        : "";
      throw new Error(`[social] no Buffer channel configured — set channel ids in /console/stories.${stale}`);
    }

    const tags = formatTags(post.tagHandles);
    const text = tags ? `${post.text}\n\n${tags}` : post.text;
    const image = mediaUrl(post.imagePath);

    // Every channel is attempted: one bad channel must not stop the others.
    //
    // ⚠ Buffer exposes no idempotency key, so a job that succeeds on channel A
    // and fails on B will repost to A when the job retries — bounded at
    // max_attempts (3). Nil in practice at the 1-2 channels SMI will configure.
    // The real fix is per-channel job fan-out in jobs.ts (one social_push job
    // per {story_id, channel_id}), so a retry is scoped to the channel that
    // failed. Out of scope here; recorded in GAPS B4.4.
    const failures: string[] = [];
    for (const channelId of channelIds) {
      const input: ChannelInput = { text, channelId, mode: SHARE_MODE, schedulingType: SCHEDULING_TYPE };
      if (image) input.assets = [{ image: { url: image } }];

      const result = await this.publishToChannel(input);
      if (!result.ok) failures.push(`${channelId}: ${result.error}`);
    }

    if (failures.length) {
      // job retries; dead-letter surfaces in Needs You Today
      throw new Error(
        `[social] Buffer publish failed for ${failures.length} of ${channelIds.length} channel(s) — ${failures.join("; ")}`,
      );
    }
  }

  /**
   * Five distinct failure modes, in order. Only the last two are new with
   * GraphQL, and they are the ones the old `!res.ok` check could not see.
   */
  private async publishToChannel(input: ChannelInput): Promise<{ ok: true } | { ok: false; error: string }> {
    let res: Response;
    try {
      res = await fetch(BUFFER_API, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: CREATE_POST, variables: { input } }),
      });
    } catch (e) {
      // 1. Transport: DNS, connection reset, abort.
      console.error("[social] buffer publish failed:", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    // 2. HTTP-level: 401 on a bad key, 429 on the request quota, 5xx.
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const error = `Buffer rejected the request (${res.status}): ${detail.slice(0, 300)}`;
      console.error("[social] buffer publish failed:", error);
      return { ok: false, error };
    }

    // 3. Body isn't JSON at all — an HTML error page from a proxy must not read
    //    as success just because it parsed to undefined.
    let body: { data?: { createPost?: { __typename?: string; message?: string } }; errors?: { message?: string }[] };
    try {
      body = await res.json();
    } catch {
      const error = "Buffer returned a non-JSON response";
      console.error("[social] buffer publish failed:", error);
      return { ok: false, error };
    }

    // 4. Top-level GraphQL errors — document or validation failures, HTTP 200.
    if (body.errors?.length) {
      const error = `Buffer GraphQL error: ${body.errors.map((e) => e.message ?? "unknown").join("; ")}`;
      console.error("[social] buffer publish failed:", error);
      return { ok: false, error };
    }

    // 5. The typed union. Discriminate positively: anything that is not an
    //    explicit success is a failure, including a shape we don't recognise.
    const payload = body.data?.createPost;
    if (payload?.__typename !== "PostActionSuccess") {
      const error = payload?.message ?? `Buffer returned an unexpected payload (${payload?.__typename ?? "no data"})`;
      console.error("[social] buffer publish failed:", error);
      return { ok: false, error };
    }

    return { ok: true };
  }
}

export function getSocialPublisher(): SocialPublisher {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  return token ? new BufferPublisher(token) : new LoggingSocialStub();
}

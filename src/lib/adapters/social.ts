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
 *   - `profile_ids[]` is gone: one mutation per channel (`publishChannel`).
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
import type { ChannelPost } from "../social-confirm";

const BUFFER_API = "https://api.buffer.com";

/**
 * Our own queue owns the timing: every publish path queues `social_push` for
 * the item's own `social_at`, or publication + caps.delay_minutes
 * (`social-push.ts`), and `social_push` defers past the daily cap itself
 * (`jobs.ts`). Buffer must therefore post at the moment we call and add no
 * schedule of its own — a queue-shaped mode would stack Buffer's delay on top
 * of ours, make the time the editor shows untrue, and make the cap accounting
 * fiction (it counts each channel's `social_channel_posts.posted_at`, stamped
 * when this call returns).
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
      ... on PostActionSuccess { post { id channelService status externalLink } }
      ... on MutationError { message }
    }
  }`;

/**
 * One sent post, looked up later for its live URL. `externalLink` is "the
 * external URL of the post at the destination service" (Buffer's reference),
 * filled once the post is `sent`; `status` runs sending → sent, or error.
 * ⚠ UNVERIFIED against a live account, like the enums above.
 */
const GET_POST = `
  query GetPost($input: PostInput!) {
    post(input: $input) { id channelService status externalLink }
  }`;

/** A post Buffer accepted: its id, which network it went to, and its live URL once Buffer has one. */
export type SentPost = { id: string; service: string; status: string; link: string | null };

export type SocialPost = {
  text: string;
  imagePath: string | null;
  tagHandles: Record<string, string>; // { linkedin: "company/x", x: "handle", ... }
  /** The other members a story features (Jas 13/10 item 12), after the primary. */
  extraTagHandles?: Record<string, string>[];
};

/**
 * At most this many co-featured members are tagged on top of the primary. A
 * story can feature a dozen members, and every tag lands in the post's text
 * (see channelText) — past a handful an X post overruns 280 characters and a
 * LinkedIn post reads as a list of handles rather than a story.
 */
export const MAX_EXTRA_TAGGED_MEMBERS = 4;

export interface SocialPublisher {
  /**
   * Which network each connected channel is, so its post can be shaped for it.
   * "unknown" when there is nothing to look up (no organisation id stored, or
   * the local stub); "failed" when the lookup itself went wrong.
   */
  channelNetworks(): Promise<ChannelNetworks>;
  /**
   * Posts exactly this text and image to one channel — the text an admin
   * confirmed (issue #43), so nothing here reshapes it. Throws on any failure.
   * The post is null when Buffer took it without returning one.
   */
  publishChannel(send: ChannelPost): Promise<SentPost | null>;
  /** Re-reads posts by id for their status and live URL. Ids Buffer can't find are left out. */
  postLinks(ids: string[]): Promise<SentPost[]>;
}

export type ChannelNetworks =
  | { kind: "known"; services: Map<string, string> }
  | { kind: "unknown" }
  | { kind: "failed" };

/*
 * Tags ride along in the text body as "channel:handle" pairs (GAPS
 * B4.1/B4.3): Buffer *does* support real LinkedIn @-mentions via
 * `metadata.linkedin.annotations[]`, but each one needs a
 * `urn:li:organization:<id>` we don't store and can't derive from the vanity
 * name in `members.social`. Until that data exists, tags ride along in the
 * text rather than silently vanishing. See GAPS B4.3 for what closing it needs.
 */

/**
 * The tags in order, the primary member's first, so trimming from the end
 * drops the co-featured members before the one the story is about. With
 * `network`, only that network's handles (GAPS B4.5: an X post used to carry
 * every member's LinkedIn and Facebook handles too).
 */
export function tagList(post: Pick<SocialPost, "tagHandles" | "extraTagHandles">, network?: string): string[] {
  const sets = [post.tagHandles, ...(post.extraTagHandles ?? []).slice(0, MAX_EXTRA_TAGGED_MEMBERS)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const handles of sets) {
    for (const [ch, h] of Object.entries(handles ?? {})) {
      if (typeof h !== "string") continue;
      if (network !== undefined && ch !== network) continue;
      const href = socialHref(ch, h);
      const tag = `${ch}:${(href && socialHandle(ch, href)) ?? h}`;
      // the same company tagged twice (primary and extra, or two branches sharing a handle) reads once
      if (seen.has(tag.toLowerCase())) continue;
      seen.add(tag.toLowerCase());
      out.push(tag);
    }
  }
  return out;
}

/** X's limit, and what it counts any link as (t.co wraps every URL to this length). */
export const X_MAX_LENGTH = 280;
const X_URL_LENGTH = 23;

/**
 * A post's length as X counts it, near enough: every link is 23, everything
 * else one per character (code point). X weighs some scripts and emoji as 2;
 * SMI's posts are English, and the budget below leaves the lead-in its full 200.
 */
export function xLength(text: string): number {
  return [...text.replace(/https?:\/\/\S+/g, "x".repeat(X_URL_LENGTH))].length;
}

/**
 * The body, then as many tags as fit in X's 280, in order. The body itself
 * (lead-in ≤ 200 + link 23) always fits, so only tags are ever dropped.
 */
export function fitTagsToX(body: string, tags: string[]): string {
  let text = body;
  for (const tag of tags) {
    const next = `${text}${text === body ? "\n\n" : " "}${tag}`;
    if (xLength(next) > X_MAX_LENGTH) break;
    text = next;
  }
  return text;
}

/** Buffer's channel `service` names → the `members.social` key whose handles belong in that post. */
const SERVICE_TAG_KEY: Partial<Record<string, string>> = {
  twitter: "x", x: "x", linkedin: "linkedin", facebook: "facebook", instagram: "instagram", youtube: "youtube", tiktok: "tiktok",
};

/**
 * One channel's text (GAPS B4.5). Known network: that network's tags only,
 * fitted to 280 on X. Unknown — the lookup failed, or no organisation id is
 * stored — every tag, fitted to X's 280, since any channel might be X: a
 * shorter post everywhere beats one X refuses.
 */
export function channelText(post: SocialPost, service: string | null): string {
  if (service === null) return fitTagsToX(post.text, tagList(post));
  const key = SERVICE_TAG_KEY[service.toLowerCase()];
  const tags = key ? tagList(post, key) : [];
  if (key === "x") return fitTagsToX(post.text, tags);
  return tags.length ? `${post.text}\n\n${tags.join(" ")}` : post.text;
}

/**
 * What each connected channel would receive (issue #43): the preview an admin
 * confirms, and the post built again just before sending to compare with it.
 * A network not known — nothing to look up, or the lookup failed — gets the
 * one X-fitted text every channel falls back to.
 */
export function channelPosts(post: SocialPost, channelIds: string[], networks: ChannelNetworks): { post: ChannelPost; network: string | null }[] {
  return channelIds.map((channelId) => {
    const network = networks.kind === "known" ? networks.services.get(channelId) ?? null : null;
    return { post: { channelId, text: channelText(post, network), imagePath: post.imagePath }, network };
  });
}

const NETWORK_LABEL: Partial<Record<string, string>> = {
  linkedin: "LinkedIn", twitter: "X", x: "X", facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok",
};

/** "LinkedIn", "X", … for a Buffer service name; the channel id when the network isn't known. */
export function channelLabel(channelId: string, network: string | null): string {
  return (network && NETWORK_LABEL[network.toLowerCase()]) ?? `Channel ${channelId}`;
}

class LoggingSocialStub implements SocialPublisher {
  async channelNetworks(): Promise<ChannelNetworks> {
    return { kind: "unknown" };
  }

  async publishChannel(send: ChannelPost): Promise<null> {
    console.log(`[social] would post to ${send.channelId}: ${send.text.split("\n")[0].slice(0, 80)}`);
    return null;
  }

  async postLinks(): Promise<SentPost[]> {
    return [];
  }
}

/** The stored Buffer organisation id — what the channel lookup needs. */
async function bufferOrganizationId(): Promise<string | undefined> {
  const { data } = await serviceDb().from("settings").select("value").eq("key", "social_channels").maybeSingle();
  return readSocialChannels(data?.value).organizationId;
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

  async publishChannel(send: ChannelPost): Promise<SentPost | null> {
    const input: ChannelInput = { text: send.text, channelId: send.channelId, mode: SHARE_MODE, schedulingType: SCHEDULING_TYPE };
    const image = mediaUrl(send.imagePath);
    if (image) input.assets = [{ image: { url: image } }];
    const result = await this.publishToChannel(input);
    if (!result.ok) throw new Error(`[social] Buffer publish failed for channel ${send.channelId} — ${result.error}`);
    return result.post;
  }

  /**
   * GAPS B4.5. "unknown" with no organisation id stored: every channel then
   * gets the one X-fitted text, consistently, so a confirmation still holds.
   * "failed" on any error — the caller must not fall back then, or a passing
   * Buffer outage would change every channel's text and undo its confirmation.
   *
   * ⚠ UNVERIFIED against a live account, like the enums above: the query
   * shape and the `service` values ("twitter", "linkedin", …) follow Buffer's
   * GraphQL reference. The organisation id is inlined as a string literal so
   * a wrong guess at the input type's name can't fail the query.
   */
  async channelNetworks(): Promise<ChannelNetworks> {
    try {
      const organizationId = await bufferOrganizationId();
      if (!organizationId) return { kind: "unknown" };
      const res = await fetch(BUFFER_API, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: `query { channels(input: { organizationId: ${JSON.stringify(organizationId)} }) { id service } }` }),
      });
      if (!res.ok) return { kind: "failed" };
      const body = (await res.json()) as { data?: { channels?: { id?: unknown; service?: unknown }[] }; errors?: unknown[] };
      if (body.errors?.length || !Array.isArray(body.data?.channels)) return { kind: "failed" };
      const services = new Map<string, string>();
      for (const c of body.data.channels) {
        if (typeof c.id === "string" && typeof c.service === "string") services.set(c.id, c.service);
      }
      return { kind: "known", services };
    } catch (e) {
      console.error("[social] buffer channel lookup failed:", e);
      return { kind: "failed" };
    }
  }

  async postLinks(ids: string[]): Promise<SentPost[]> {
    const out: SentPost[] = [];
    for (const id of ids) {
      // Same transport/HTTP/GraphQL checks as a publish, condensed: any failure
      // just leaves this id out, and the caller asks again later.
      try {
        const res = await fetch(BUFFER_API, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: GET_POST, variables: { input: { id } } }),
        });
        if (!res.ok) continue;
        const body = (await res.json()) as { data?: { post?: RawPost | null }; errors?: unknown[] };
        if (body.errors?.length || !body.data?.post) continue;
        const post = sentPost(body.data.post);
        if (post) out.push(post);
      } catch (e) {
        console.error("[social] buffer post lookup failed:", e);
      }
    }
    return out;
  }

  /**
   * Five distinct failure modes, in order. Only the last two are new with
   * GraphQL, and they are the ones the old `!res.ok` check could not see.
   */
  private async publishToChannel(input: ChannelInput): Promise<{ ok: true; post: SentPost | null } | { ok: false; error: string }> {
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
    let body: { data?: { createPost?: { __typename?: string; message?: string; post?: RawPost } }; errors?: { message?: string }[] };
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

    // The post itself is a bonus — a success without it is still a success.
    return { ok: true, post: payload.post ? sentPost(payload.post) : null };
  }
}

type RawPost = { id?: unknown; channelService?: unknown; status?: unknown; externalLink?: unknown };

function sentPost(raw: RawPost): SentPost | null {
  if (typeof raw.id !== "string" || !raw.id) return null;
  return {
    id: raw.id,
    service: typeof raw.channelService === "string" ? raw.channelService : "",
    status: typeof raw.status === "string" ? raw.status : "",
    link: typeof raw.externalLink === "string" && raw.externalLink ? raw.externalLink : null,
  };
}

/**
 * True when posts really go to Buffer. Without a token the logging stub
 * "publishes", and the item must not then be marked as posted — the editor
 * would claim a post that never happened.
 */
export function isSocialLive(): boolean {
  return !!process.env.BUFFER_ACCESS_TOKEN;
}

export function getSocialPublisher(): SocialPublisher {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  return token ? new BufferPublisher(token) : new LoggingSocialStub();
}

const NETWORKS_TTL_MS = 5 * 60_000;
let networksCache: { at: number; value: ChannelNetworks } | null = null;

/**
 * Which network each channel is, remembered for a few minutes, for the
 * editor and its Confirm: they ask on every load, and a slow Buffer would
 * otherwise slow every editor page. Confirm uses the same answer the preview
 * was built from. A failed lookup is never remembered. The social_push job
 * asks Buffer directly: what it posts is compared with the confirmed
 * snapshot, so a stale answer here can only hold a post back, never change it.
 */
export async function cachedChannelNetworks(now = Date.now()): Promise<ChannelNetworks> {
  if (networksCache && now - networksCache.at < NETWORKS_TTL_MS) return networksCache.value;
  const value = await getSocialPublisher().channelNetworks();
  networksCache = value.kind === "failed" ? null : { at: now, value };
  return value;
}

/** For tests. */
export function clearChannelNetworksCache() {
  networksCache = null;
}

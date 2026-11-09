import { createHash } from "node:crypto";
import type { serviceDb } from "./db/server";
import type { ChannelDetails, ChannelNetworks, SocialPost } from "./adapters/social";
import { excerptFromHtml } from "./sanitize";
import { isMemberLinkable } from "./member-visibility";
import { londonDayStart } from "./london-time";
import { readSocialChannels } from "./social-channels";
import { siteUrl } from "./site-url";
import { taggedMembers } from "./story-members";
import { storyImage, type StoryImageSource } from "./story-image";
import { composeSocialText } from "./social-text";
import { channelState, channelStatusLines, type ChannelPost, type ChannelRecord, type ChannelView } from "./social-confirm";
import { logError } from "./log";

/**
 * The database side of per-channel social posts (issue #43): building what
 * an item would post, and reading and writing each channel's row in
 * `social_channel_posts`. The editor preview and the social_push job both
 * build the post here, so what an admin confirms and what is compared just
 * before posting can't drift apart. The rules themselves are pure, in
 * social-confirm.ts.
 */

type Db = ReturnType<typeof serviceDb>;

export type SocialTarget = { story_id: string } | { video_id: string };

export function targetOf(t: SocialTarget): { table: "stories" | "videos"; key: "story_id" | "video_id"; id: string } {
  return "story_id" in t
    ? { table: "stories", key: "story_id", id: t.story_id }
    : { table: "videos", key: "video_id", id: t.video_id };
}

/** The item's columns on a `social_channel_posts` row: its own id, the other null. */
function ownerOf(t: SocialTarget): { story_id: string; video_id: null } | { story_id: null; video_id: string } {
  return "story_id" in t ? { story_id: t.story_id, video_id: null } : { story_id: null, video_id: t.video_id };
}

/** A story or video in the one shape social posting needs, so the two can't drift apart. */
export type SocialItem = {
  status: string;
  title: string;
  social_at: string | null;
  social_skip: boolean;
  published_at: string | null;
  /** The post before it is shaped per channel: lead-in, link, every member's tags, the image. */
  post: SocialPost;
};

type LinkableMember = { social: unknown; status: string; archived_at: string | null } | null;

/** A video row as social posting reads it. The editor builds it from the row it already has. */
export type SocialVideoRow = {
  title: string; slug: string; description: string | null; thumbnail_path: string | null; status: string;
  social_at: string | null; social_text: string | null; social_skip: boolean; published_at: string | null;
  member: LinkableMember;
};

export function videoSocialItem(video: SocialVideoRow): SocialItem {
  return {
    status: video.status,
    title: video.title,
    social_at: video.social_at,
    social_skip: video.social_skip,
    published_at: video.published_at,
    post: {
      text: composeSocialText(video.social_text || excerptFromHtml(video.description) || video.title, `${siteUrl()}/video/${video.slug}`),
      imagePath: video.thumbnail_path,
      // Same rule as a story's tags below: no tag for a member without a public page.
      tagHandles: (video.member && isMemberLinkable(video.member) ? video.member.social ?? {} : {}) as Record<string, string>,
    },
  };
}

/** A story row as social posting reads it. `summary` is the story_summary column. */
export type SocialStoryRow = {
  id: string; title: string; slug: string; cover_path: string | null; cover_use_logo?: boolean | null; member_id: string | null; status: string;
  social_at: string | null; social_text: string | null; social_skip: boolean; published_at: string | null;
  summary: string | null; member: (NonNullable<LinkableMember> & NonNullable<StoryImageSource["member"]>) | null;
};

/**
 * `tagged` is every member the story features (lib/story-members
 * taggedMembers). Every other member is tagged too (Jas 13/10 item 12). Same
 * rule for the primary and the extras: only a member with a public page
 * (isMemberLinkable — not archived, active or grace) is tagged. ask-jas 14
 * (archived members in social posts) is still open; until Jas answers, the
 * safe default is not to put a company that has left — or been archived —
 * into a public post. Applies alike to both.
 */
export function storySocialItem(story: SocialStoryRow, tagged: { id: string; social: unknown; status: string; archived_at: string | null }[]): SocialItem {
  const extras = tagged.filter((m) => m.id !== story.member_id && isMemberLinkable(m));
  return {
    status: story.status,
    title: story.title,
    social_at: story.social_at,
    social_skip: story.social_skip,
    published_at: story.published_at,
    post: {
      // The editor's lead-in, else the summary (the excerpt, or the opening of the body), else the title.
      text: composeSocialText(story.social_text || story.summary || story.title, `${siteUrl()}/news/${story.slug}`),
      // The member's logo when there's no cover, or when an admin chose it
      // (lib/story-image, which applies isMemberLinkable itself).
      imagePath: storyImage(story)?.path ?? null,
      // @-tag from the CRM-stored handle — never hand-typed
      tagHandles: (story.member && isMemberLinkable(story.member) ? story.member.social ?? {} : {}) as Record<string, string>,
      extraTagHandles: extras.map((m) => (m.social ?? {}) as Record<string, string>),
    },
  };
}

export async function loadSocialItem(db: Db, t: SocialTarget): Promise<SocialItem | null> {
  if ("video_id" in t) {
    const { data: video } = await db
      .from("videos")
      .select("id, title, slug, description, thumbnail_path, status, social_at, social_text, social_skip, published_at, member:members(name, social, status, archived_at)")
      .eq("id", t.video_id)
      .maybeSingle();
    return video ? videoSocialItem(video) : null;
  }
  const { data: story } = await db
    .from("stories")
    // FK named: story_members makes a bare `members` embed ambiguous here.
    .select("id, title, slug, cover_path, cover_use_logo, member_id, status, social_at, social_text, social_skip, published_at, summary:story_summary, member:members!stories_member_id_fkey(name, social, status, archived_at, logo_path)")
    .eq("id", t.story_id)
    .maybeSingle();
  if (!story) return null;
  return storySocialItem(story, await taggedMembers(db, story.id, story.member_id));
}

/**
 * A short fingerprint of what a channel would receive. The editor sends the
 * one it showed with Confirm, so a post that changed after the page loaded —
 * another admin's save, a member's new handle — is refused, not confirmed
 * unseen.
 */
export function postFingerprint(p: Pick<ChannelPost, "text" | "imagePath">): string {
  return createHash("sha256").update(JSON.stringify([p.text, p.imagePath ?? null])).digest("hex").slice(0, 32);
}

/** The Buffer channels posts go to, from settings `social_channels`. */
export async function connectedChannelIds(db: Db): Promise<string[]> {
  const { data } = await db.from("settings").select("value").eq("key", "social_channels").maybeSingle();
  return readSocialChannels(data?.value).channelIds;
}

export type StoredChannel = ChannelRecord & { confirmedBy: string | null };

/** Each channel's stored row for the item, by channel id. A channel with no row is unconfirmed. */
export async function readChannelRecords(db: Db, t: SocialTarget): Promise<Map<string, StoredChannel>> {
  const { key, id } = targetOf(t);
  const { data } = await db
    .from("social_channel_posts")
    .select("channel_id, skip, confirmed_text, confirmed_image, confirmed_at, posted_at, confirmer:profiles(display_name)")
    .eq(key, id);
  return new Map((data ?? []).map((r) => [r.channel_id, {
    channel_id: r.channel_id,
    skip: r.skip,
    confirmed_text: r.confirmed_text,
    confirmed_image: r.confirmed_image,
    confirmed_at: r.confirmed_at,
    posted_at: r.posted_at,
    confirmedBy: r.confirmer?.display_name ?? null,
  }]));
}

/**
 * Confirm what these channels would receive now, from the saved item: the
 * snapshot the post is compared with just before it goes out. A channel
 * already posted or marked Don't post is left alone. `seen` is each channel's
 * postFingerprint as the admin's page showed it: if any channel to be
 * confirmed would now receive something else (or wasn't shown at all),
 * nothing is confirmed and those channels come back as `stale`.
 */
export async function confirmChannels(
  db: Db,
  t: SocialTarget,
  o: { posts: ChannelPost[]; only: string[] | "all"; userId: string; seen: Record<string, string> },
): Promise<{ confirmed: string[]; stale: string[] }> {
  const { key } = targetOf(t);
  const records = await readChannelRecords(db, t);
  const now = new Date().toISOString();
  const chosen = o.posts
    .filter((p) => o.only === "all" || o.only.includes(p.channelId))
    .filter((p) => channelState({ post: p, record: records.get(p.channelId) ?? null }, false) === "waiting");
  const stale = chosen.filter((p) => o.seen[p.channelId] !== postFingerprint(p)).map((p) => p.channelId);
  if (stale.length) return { confirmed: [], stale };
  const rows = chosen
    .map((p) => ({
      ...ownerOf(t),
      channel_id: p.channelId,
      confirmed_text: p.text,
      confirmed_image: p.imagePath,
      confirmed_by: o.userId,
      confirmed_at: now,
      updated_at: now,
    }));
  if (!rows.length) return { confirmed: [], stale: [] };
  const { error } = await db.from("social_channel_posts").upsert(rows, { onConflict: `${key},channel_id` });
  if (error) throw new Error(`[social] confirming failed: ${error.message}`);
  return { confirmed: rows.map((r) => r.channel_id), stale: [] };
}

/** The post changed since it was confirmed: the channel waits for confirmation again. */
export async function clearConfirmations(db: Db, t: SocialTarget, channelIds: string[]): Promise<void> {
  const { key, id } = targetOf(t);
  const { error } = await db
    .from("social_channel_posts")
    .update({ confirmed_text: null, confirmed_image: null, confirmed_at: null, confirmed_by: null, updated_at: new Date().toISOString() })
    .eq(key, id)
    .in("channel_id", channelIds);
  // Before anything is posted: failing here retries the job, so a changed post can't slip out.
  if (error) throw new Error(`[social] clearing a stale confirmation failed: ${error.message}`);
}

/**
 * Claim one channel just before it is sent to Buffer: posted_at is stamped
 * only if it is still empty, the channel is still confirmed with exactly this
 * text, and not marked Don't post — one atomic update. False means another
 * run took it first, or it changed since the plan; it is not sent.
 *
 * Stamping before sending, not after, is what stops a double post. Buffer has
 * no idempotency key, so a stamp that failed after a post went out would let
 * a later run post it again; this way a failure can only ever leave a channel
 * not posted. A failed claim throws, so nothing is sent.
 */
export async function claimChannelPost(db: Db, t: SocialTarget, post: ChannelPost): Promise<boolean> {
  const { key, id } = targetOf(t);
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("social_channel_posts")
    .update({ posted_at: now, updated_at: now })
    .eq(key, id)
    .eq("channel_id", post.channelId)
    .is("posted_at", null)
    .eq("skip", false)
    .eq("confirmed_text", post.text)
    .select("channel_id");
  if (error) throw new Error(`[social] couldn't claim ${post.channelId} before posting: ${error.message}`);
  return !!data?.length;
}

/** Buffer refused the post: hand the claim back, so a retry can send it. */
export async function releaseChannelPost(db: Db, t: SocialTarget, channelId: string): Promise<void> {
  const { key, id } = targetOf(t);
  const { error } = await db
    .from("social_channel_posts")
    .update({ posted_at: null, updated_at: new Date().toISOString() })
    .eq(key, id)
    .eq("channel_id", channelId);
  if (error) {
    // Shows as posted though it wasn't: never a double post, but someone needs to know.
    logError({ source: "db", area: "job:social_push", error: `${channelId} wasn't posted but is marked posted: ${error.message}`, context: { [key]: id, channel_id: channelId } });
  }
}

/** Buffer took it: keep its post id. Losing this only loses the id, so a failure is logged, not thrown. */
export async function recordBufferPostId(db: Db, t: SocialTarget, channelId: string, bufferPostId: string): Promise<void> {
  const { key, id } = targetOf(t);
  const { error } = await db
    .from("social_channel_posts")
    .update({ buffer_post_id: bufferPostId, updated_at: new Date().toISOString() })
    .eq(key, id)
    .eq("channel_id", channelId);
  if (error) {
    logError({ source: "db", area: "job:social_push", error: `posted on ${channelId}, Buffer post id not recorded: ${error.message}`, context: { [key]: id, channel_id: channelId } });
  }
}

/**
 * The editor's per-channel "Don't post" boxes. `shown` is every channel the
 * form listed, so an unticked box clears its skip; a channel the form didn't
 * list is left as it is.
 */
export async function saveChannelSkips(db: Db, t: SocialTarget, o: { shown: string[]; skipped: string[] }): Promise<void> {
  if (!o.shown.length) return;
  const { key } = targetOf(t);
  const now = new Date().toISOString();
  const rows = o.shown.map((channel_id) => ({ ...ownerOf(t), channel_id, skip: o.skipped.includes(channel_id), updated_at: now }));
  const { error } = await db.from("social_channel_posts").upsert(rows, { onConflict: `${key},channel_id` });
  if (error) throw new Error(`[social] saving "Don't post" failed: ${error.message}`);
}

/** Posts each channel has had since London midnight, stories and videos together: the daily limit is per channel. */
export async function postedTodayByChannel(db: Db, channelIds: string[]): Promise<Record<string, number>> {
  const { data } = await db
    .from("social_channel_posts")
    .select("channel_id")
    .in("channel_id", channelIds)
    .gte("posted_at", londonDayStart(new Date()).toISOString());
  const counts: Record<string, number> = {};
  for (const r of data ?? []) counts[r.channel_id] = (counts[r.channel_id] ?? 0) + 1;
  return counts;
}

/** What the editor's "Social post" section shows for a saved item. */
export type SocialPanel = {
  /** "failed": Buffer couldn't say which network each channel is, so nothing can be confirmed just now. */
  networks: ChannelNetworks["kind"];
  /** `fingerprint` goes back with Confirm (postFingerprint). */
  channels: (ChannelView & { network: string | null; state: ReturnType<typeof channelState>; fingerprint: string })[];
  lines: string[];
};

/** `item` is the editor's own row, built with storySocialItem / videoSocialItem, so the page doesn't read it twice. */
export async function loadSocialPanel(
  db: Db,
  t: SocialTarget,
  deps: {
    networks: () => Promise<ChannelNetworks>;
    /** Names for the labels only; defaults to the cached Buffer lookup. */
    details?: () => Promise<ChannelDetails>;
    delayMinutes: number;
    now?: Date;
    item?: SocialItem;
  },
): Promise<SocialPanel | null> {
  const [item, channelIds] = await Promise.all([deps.item ?? loadSocialItem(db, t), connectedChannelIds(db)]);
  if (!item) return null;
  if (!channelIds.length) return { networks: "unknown", channels: [], lines: [] };
  const adapter = await import("./adapters/social");
  const { channelPosts, channelLabel } = adapter;
  const [records, networks, details] = await Promise.all([
    readChannelRecords(db, t),
    deps.networks(),
    (deps.details ?? (() => adapter.cachedChannelDetails()))(),
  ]);
  const channels = channelPosts(item.post, channelIds, networks).map(({ post, network }) => {
    const record = records.get(post.channelId) ?? null;
    return {
      label: channelLabel(post.channelId, network, details.kind === "known" ? details.channels.get(post.channelId) : null),
      network,
      post,
      record,
      confirmedBy: record?.confirmedBy ?? null,
      state: channelState({ post, record }, item.social_skip),
      fingerprint: postFingerprint(post),
    };
  });
  const lines = channelStatusLines({
    now: deps.now ?? new Date(),
    delayMinutes: deps.delayMinutes,
    item: { status: item.status, socialAt: item.social_at, publishedAt: item.published_at, skip: item.social_skip },
    channels,
  });
  return { networks: networks.kind, channels, lines };
}

/** One Live item with channels still waiting for confirmation after its post time. */
export type WaitingItem = { kind: "story" | "video"; id: string; title: string; waiting: number; total: number; href: string };

/**
 * For Needs You Today and the admin digest: Live items, not marked Don't
 * post, whose post time has passed while a connected channel still has no
 * confirmation. Read from the stored rows only — a confirmation that no
 * longer matches is cleared by the social_push job once it is due, and
 * counts from then on.
 *
 * Worked out in the database (social_waiting_items, migration
 * 20261105000003), which returns only the items with a channel waiting: the
 * result stays as small as the list on screen however many items are Live.
 * A failed read is logged and lists nothing, never everything as waiting.
 */
export async function socialWaiting(db: Db, o: { delayMinutes: number; now?: Date }): Promise<WaitingItem[]> {
  const channelIds = await connectedChannelIds(db);
  if (!channelIds.length) return [];
  const { data, error } = await db.rpc("social_waiting_items", {
    p_channel_ids: channelIds,
    p_delay_minutes: o.delayMinutes,
    p_now: (o.now ?? new Date()).toISOString(),
  });
  if (error) {
    logError({ source: "db", area: "social:waiting", error: `social_waiting_items failed: ${error.message}` });
    return [];
  }
  return (data ?? []).map((r) => {
    const kind = r.kind === "video" ? "video" : "story";
    const table = kind === "video" ? "videos" : "stories";
    return { kind, id: r.id, title: r.title, waiting: r.waiting, total: channelIds.length, href: `/console/${table}/${r.id}#social` };
  });
}

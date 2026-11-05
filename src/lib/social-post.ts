import type { serviceDb } from "./db/server";
import type { ChannelNetworks, SocialPost } from "./adapters/social";
import { excerptFromHtml } from "./sanitize";
import { isMemberLinkable } from "./member-visibility";
import { londonDayStart } from "./london-time";
import { readSocialChannels } from "./social-channels";
import { siteUrl } from "./site-url";
import { taggedMembers } from "./story-members";
import { composeSocialText } from "./social-text";
import { channelState, channelStatusLines, postTimeOf, type ChannelPost, type ChannelRecord, type ChannelView } from "./social-confirm";
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

export async function loadSocialItem(db: Db, t: SocialTarget): Promise<SocialItem | null> {
  if ("video_id" in t) {
    const { data: video } = await db
      .from("videos")
      .select("id, title, slug, description, thumbnail_path, status, social_at, social_text, social_skip, published_at, member:members(name, social, status, archived_at)")
      .eq("id", t.video_id)
      .maybeSingle();
    if (!video) return null;
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
        tagHandles: (isMemberLinkable(video.member) ? video.member.social ?? {} : {}) as Record<string, string>,
      },
    };
  }
  const { data: story } = await db
    .from("stories")
    // FK named: story_members makes a bare `members` embed ambiguous here.
    .select("id, title, slug, cover_path, member_id, status, social_at, social_text, social_skip, published_at, summary:story_summary, member:members!stories_member_id_fkey(name, social, status, archived_at)")
    .eq("id", t.story_id)
    .maybeSingle();
  if (!story) return null;
  // Every other member the story features is tagged too (Jas 13/10 item
  // 12). Same rule for the primary and the extras: only a member with a
  // public page (isMemberLinkable — not archived, active or grace) is
  // tagged. ask-jas 14 (archived members in social posts) is still open;
  // until Jas answers, the safe default is not to put a company that has
  // left — or been archived — into a public post. Applies alike to both.
  const extras = (await taggedMembers(db, story.id, story.member_id))
    .filter((m) => m.id !== story.member_id && isMemberLinkable(m));
  return {
    status: story.status,
    title: story.title,
    social_at: story.social_at,
    social_skip: story.social_skip,
    published_at: story.published_at,
    post: {
      // The editor's lead-in, else the summary (the excerpt, or the opening of the body), else the title.
      text: composeSocialText(story.social_text || story.summary || story.title, `${siteUrl()}/news/${story.slug}`),
      imagePath: story.cover_path,
      // @-tag from the CRM-stored handle — never hand-typed
      tagHandles: (isMemberLinkable(story.member) ? story.member.social ?? {} : {}) as Record<string, string>,
      extraTagHandles: extras.map((m) => (m.social ?? {}) as Record<string, string>),
    },
  };
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
 * already posted or marked Don't post is left alone. Returns the channels
 * confirmed.
 */
export async function confirmChannels(
  db: Db,
  t: SocialTarget,
  o: { posts: ChannelPost[]; only: string[] | "all"; userId: string },
): Promise<string[]> {
  const { key } = targetOf(t);
  const records = await readChannelRecords(db, t);
  const now = new Date().toISOString();
  const rows = o.posts
    .filter((p) => o.only === "all" || o.only.includes(p.channelId))
    .filter((p) => channelState({ post: p, record: records.get(p.channelId) ?? null }, false) === "waiting")
    .map((p) => ({
      ...ownerOf(t),
      channel_id: p.channelId,
      confirmed_text: p.text,
      confirmed_image: p.imagePath,
      confirmed_by: o.userId,
      confirmed_at: now,
      updated_at: now,
    }));
  if (!rows.length) return [];
  const { error } = await db.from("social_channel_posts").upsert(rows, { onConflict: `${key},channel_id` });
  if (error) throw new Error(`[social] confirming failed: ${error.message}`);
  return rows.map((r) => r.channel_id);
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
 * Buffer took this channel's post. Stamped at once, so a retry of the job
 * never posts it twice. A failed stamp is logged rather than thrown: throwing
 * would fail the job and its retry would post the channel a second time.
 */
export async function markChannelPosted(db: Db, t: SocialTarget, channelId: string, bufferPostId: string | null): Promise<void> {
  const { key, id } = targetOf(t);
  const now = new Date().toISOString();
  const { error } = await db
    .from("social_channel_posts")
    .update({ posted_at: now, buffer_post_id: bufferPostId, updated_at: now })
    .eq(key, id)
    .eq("channel_id", channelId);
  if (error) {
    logError({ source: "db", area: "job:social_push", error: `posted on ${channelId} but not recorded: ${error.message}`, context: { [key]: id, channel_id: channelId } });
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
  channels: (ChannelView & { network: string | null; state: ReturnType<typeof channelState> })[];
  lines: string[];
};

export async function loadSocialPanel(
  db: Db,
  t: SocialTarget,
  deps: { networks: () => Promise<ChannelNetworks>; delayMinutes: number; now?: Date },
): Promise<SocialPanel | null> {
  const [item, channelIds] = await Promise.all([loadSocialItem(db, t), connectedChannelIds(db)]);
  if (!item) return null;
  if (!channelIds.length) return { networks: "unknown", channels: [], lines: [] };
  const [records, networks, { channelPosts, channelLabel }] = await Promise.all([
    readChannelRecords(db, t),
    deps.networks(),
    import("./adapters/social"),
  ]);
  const channels = channelPosts(item.post, channelIds, networks).map((p) => {
    const record = records.get(p.channelId) ?? null;
    const post = { channelId: p.channelId, text: p.text, imagePath: p.imagePath };
    return {
      label: channelLabel(p.channelId, p.network),
      network: p.network,
      post,
      record,
      confirmedBy: record?.confirmedBy ?? null,
      state: channelState({ post, record }, item.social_skip),
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
 */
export async function socialWaiting(db: Db, o: { delayMinutes: number; now?: Date }): Promise<WaitingItem[]> {
  const channelIds = await connectedChannelIds(db);
  if (!channelIds.length) return [];
  const now = (o.now ?? new Date()).getTime();
  const out: WaitingItem[] = [];
  for (const [kind, table, key] of [["story", "stories", "story_id"], ["video", "videos", "video_id"]] as const) {
    const { data: items } = await db
      .from(table)
      .select("id, title, social_at, published_at")
      .eq("status", "published")
      .eq("social_skip", false);
    const due = (items ?? []).filter((r) =>
      r.published_at && postTimeOf({ socialAt: r.social_at, publishedAt: r.published_at, delayMinutes: o.delayMinutes }) <= now);
    if (!due.length) continue;
    const { data: rows } = await db
      .from("social_channel_posts")
      .select("story_id, video_id, channel_id, skip, confirmed_at, posted_at")
      .in(key, due.map((r) => r.id));
    const settled = new Set(
      (rows ?? []).filter((r) => r.skip || r.posted_at || r.confirmed_at).map((r) => `${r[key]}:${r.channel_id}`),
    );
    for (const r of due) {
      const waiting = channelIds.filter((c) => !settled.has(`${r.id}:${c}`)).length;
      if (waiting) out.push({ kind, id: r.id, title: r.title, waiting, total: channelIds.length, href: `/console/${table}/${r.id}#social` });
    }
  }
  return out;
}

/**
 * Handing social posts to Buffer (issue #101, docs/adr/0003-buffer-holds-scheduled-social-posts.md).
 *
 * A channel an admin scheduled or published-now is handed to Buffer once its
 * item is Live — never before, because Buffer sends at its time whether or not
 * the story is public. Buffer then holds the post and sends it. Because the
 * app is no longer there when it goes out, anything that would change the post
 * takes it back out of Buffer first (pullBack, reconcileHeldPosts).
 *
 * Each hand-off is claimed (handed_at stamped, only if still empty and still
 * exactly what was confirmed) just before the Buffer call, and the claim
 * handed back if Buffer refuses. Buffer has no idempotency key, so the claim
 * is what stops two runs handing the same post over twice.
 */

import type { serviceDb } from "./db/server";
import type { ChannelNetworks, SendAs, SocialPublisher } from "./adapters/social";
import type { JobKind } from "./jobs";
import { londonAt, londonDayStart } from "./london-time";
import { logError } from "./log";
import { postTimeOf, snapshotMatches, type ChannelRecord, type SendMode } from "./social-confirm";
import {
  clearConfirmations, connectedChannelIds, leadsOf, loadSocialItem, readChannelRecords, targetOf,
  type SocialItem, type SocialTarget,
} from "./social-post";
import { readSocialCaps } from "./social-push";

type Db = ReturnType<typeof serviceDb>;
type Enqueue = (kind: JobKind, payload?: Record<string, unknown>, dueAt?: Date) => Promise<void>;

/** Within this of now counts as now: a time a moment away isn't worth scheduling. */
const SLACK_MS = 60_000;

/**
 * When Buffer should send one channel's post: now for Publish now; for
 * Schedule, the item's own post time (`social_at`, or publication + delay),
 * or now if that has passed.
 */
export function handOffTime(o: { mode: SendMode; socialAt: string | null; publishedAt: string; delayMinutes: number; now: Date }): Date {
  if (o.mode === "now") return o.now;
  const t = postTimeOf({ socialAt: o.socialAt, publishedAt: o.publishedAt, delayMinutes: o.delayMinutes });
  return t <= o.now.getTime() + SLACK_MS ? o.now : new Date(t);
}

/**
 * The daily limit, per channel and UK day: a post whose day already has
 * `perDay` posts for this channel moves to the next day with room, at 09:00
 * plus one delay step per post already there. `taken` is this channel's other
 * handed-over posts' send times.
 */
export function capSlot(o: { desired: Date; taken: Date[]; perDay: number; delayMinutes: number }): Date {
  const onDay = (start: Date) => {
    const end = londonAt(start, 1, 0);
    return o.taken.filter((t) => t >= start && t < end).length;
  };
  let day = londonDayStart(o.desired);
  if (onDay(day) < o.perDay) return o.desired;
  // A year of full days would be a bug elsewhere; stop rather than loop.
  for (let i = 1; i <= 366; i++) {
    day = londonAt(day, 1, 0);
    const n = onDay(day);
    if (n < o.perDay) return new Date(londonAt(day, 0, 9).getTime() + n * o.delayMinutes * 60_000);
  }
  return o.desired;
}

/** How a channel goes to Buffer, from when it should go. */
function sendAs(at: Date, now: Date): SendAs {
  return at.getTime() <= now.getTime() + SLACK_MS ? { kind: "now" } : { kind: "scheduled", dueAt: at };
}

/** This channel's posts already with Buffer from the start of today (UK), for the daily limit. */
async function takenSlots(db: Db, channelId: string, now: Date, except?: string): Promise<Date[]> {
  let q = db
    .from("social_channel_posts")
    .select("id, due_at")
    .eq("channel_id", channelId)
    .not("handed_at", "is", null)
    .gte("due_at", londonDayStart(now).toISOString());
  if (except) q = q.neq("id", except);
  const { data, error } = await q;
  if (error) throw new Error(`[social] reading ${channelId}'s posts for the daily limit failed: ${error.message}`);
  return (data ?? []).flatMap((r) => (r.due_at ? [new Date(r.due_at)] : []));
}

/** A channel that's been scheduled or published-now and isn't with Buffer yet. */
function ready(r: ChannelRecord | undefined): r is ChannelRecord & { send_mode: SendMode } {
  return !!r?.confirmed_at && !!r.send_mode && !r.skip && !r.handed_at && !r.posted_at;
}

export type HandOffResult = { handed: string[]; unconfirmed: string[]; failed: { channelId: string; error: string }[] };

/**
 * Hand every ready channel of a Live item to Buffer. Changed since it was
 * confirmed: the channel waits again instead. Not Live, "Don't post", or the
 * logging stub (no Buffer key): nothing is handed over or stamped.
 */
export async function handOffChannels(
  db: Db,
  t: SocialTarget,
  deps: { publisher: SocialPublisher; live: boolean; enqueue: Enqueue; now?: Date; item?: SocialItem | null },
): Promise<HandOffResult> {
  const result: HandOffResult = { handed: [], unconfirmed: [], failed: [] };
  const now = deps.now ?? new Date();
  const item = deps.item ?? (await loadSocialItem(db, t));
  if (!item || item.status !== "published" || item.social_skip || !item.published_at) return result;
  const [channelIds, records] = await Promise.all([connectedChannelIds(db), readChannelRecords(db, t)]);
  if (!channelIds.some((c) => ready(records.get(c)))) return result;

  // A passing lookup failure must not change every channel's text (the
  // fallback is one X-fitted text) and so cancel its confirmation. Retry.
  const networks: ChannelNetworks = await deps.publisher.channelNetworks();
  if (networks.kind === "failed") throw new Error("[social] couldn't look up which network each Buffer channel is; trying again rather than handing over");

  const caps = await readSocialCaps(db);
  const { channelPosts } = await import("./adapters/social");
  const { key, id } = targetOf(t);
  for (const { post } of channelPosts(item.post, channelIds, networks, leadsOf(records))) {
    const record = records.get(post.channelId);
    if (!ready(record)) continue;
    if (!snapshotMatches(record, post)) {
      result.unconfirmed.push(post.channelId);
      continue;
    }
    const desired = handOffTime({ mode: record.send_mode, socialAt: item.social_at, publishedAt: item.published_at, delayMinutes: caps.delay_minutes, now });
    const at = capSlot({ desired, taken: await takenSlots(db, post.channelId, now), perDay: caps.per_day, delayMinutes: caps.delay_minutes });
    const as = sendAs(at, now);
    const opts = { aiAssisted: !!record.lead_ai && !!record.lead_text };
    if (!deps.live) {
      // The logging stub: says what it would do, stamps nothing, so the editor never claims a post that didn't happen.
      await deps.publisher.publishChannel(post, as, opts);
      continue;
    }

    const stamp = new Date().toISOString();
    const { data: claimed, error: claimError } = await db
      .from("social_channel_posts")
      .update({ handed_at: stamp, due_at: at.toISOString(), updated_at: stamp })
      .eq(key, id)
      .eq("channel_id", post.channelId)
      .is("handed_at", null)
      .is("posted_at", null)
      .eq("skip", false)
      .eq("confirmed_text", post.text)
      .select("channel_id");
    if (claimError) throw new Error(`[social] couldn't claim ${post.channelId} before handing it to Buffer: ${claimError.message}`);
    if (!claimed?.length) continue; // another run took it, or it changed since

    try {
      const sent = await deps.publisher.publishChannel(post, as, opts);
      const { error } = await db
        .from("social_channel_posts")
        .update({ buffer_post_id: sent?.id ?? null, buffer_status: sent?.status || null, updated_at: new Date().toISOString() })
        .eq(key, id)
        .eq("channel_id", post.channelId);
      if (error) {
        // Buffer has it; only its id is lost, so a pull-back would need doing by hand.
        logError({ source: "db", area: "social:hand-off", error: `${post.channelId} is with Buffer but its post id wasn't recorded: ${error.message}`, context: { [key]: id, channel_id: post.channelId } });
      }
      result.handed.push(post.channelId);
      if (sent?.id) await enqueueStatusCheck(deps.enqueue, t, [sent.id], at);
      if (record.draft_post_id) await dropDraft(db, t, post.channelId, record.draft_post_id, deps.publisher);
    } catch (e) {
      await db
        .from("social_channel_posts")
        .update({ handed_at: null, due_at: null, updated_at: new Date().toISOString() })
        .eq(key, id)
        .eq("channel_id", post.channelId);
      result.failed.push({ channelId: post.channelId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (result.unconfirmed.length) await clearConfirmations(db, t, result.unconfirmed);
  return result;
}

/** Ask Buffer how the post went shortly after it's due: the social_links job records sent / error and the live link. */
async function enqueueStatusCheck(enqueue: Enqueue, t: SocialTarget, postIds: string[], due: Date) {
  const at = new Date(Math.max(due.getTime(), Date.now()) + 2 * 60_000);
  await enqueue("social_links", { ...t, post_ids: postIds, tries: 0 }, at);
}

/** The real post is with Buffer: its check draft goes. A failed delete leaves the draft for someone to clear by hand. */
async function dropDraft(db: Db, t: SocialTarget, channelId: string, draftId: string, publisher: SocialPublisher) {
  if (!(await publisher.deletePost(draftId))) return;
  const { key, id } = targetOf(t);
  await db
    .from("social_channel_posts")
    .update({ draft_post_id: null, draft_text: null, draft_image: null, draft_at: null, updated_at: new Date().toISOString() })
    .eq(key, id)
    .eq("channel_id", channelId);
}

export type PullBackResult = { pulled: string[]; failed: string[] };

/**
 * Take channels' unsent posts back out of Buffer. `keepConfirmation`: the post
 * itself is still right (the item left Live, or its time moved) so it's handed
 * over again when it can be; otherwise the channel waits to be scheduled again.
 * A post Buffer couldn't delete stays recorded as with Buffer and is reported:
 * it may still go out, and someone has to delete it in Buffer.
 */
export async function pullBack(
  db: Db,
  t: SocialTarget,
  o: { channels: string[] | "all"; keepConfirmation: boolean },
  deps: { publisher: SocialPublisher },
): Promise<PullBackResult> {
  const out: PullBackResult = { pulled: [], failed: [] };
  const records = await readChannelRecords(db, t);
  const { key, id } = targetOf(t);
  for (const r of records.values()) {
    if (!r.handed_at || r.posted_at) continue;
    if (o.channels !== "all" && !o.channels.includes(r.channel_id)) continue;
    if (r.buffer_post_id && !(await deps.publisher.deletePost(r.buffer_post_id))) {
      out.failed.push(r.channel_id);
      continue;
    }
    const now = new Date().toISOString();
    const { error } = await db
      .from("social_channel_posts")
      .update({
        handed_at: null, due_at: null, buffer_post_id: null, buffer_status: null, updated_at: now,
        ...(o.keepConfirmation ? {} : { confirmed_text: null, confirmed_image: null, confirmed_at: null, confirmed_by: null, send_mode: null }),
      })
      .eq(key, id)
      .eq("channel_id", r.channel_id);
    if (error) {
      logError({ source: "db", area: "social:pull-back", error: `deleted from Buffer but still marked as with it: ${error.message}`, context: { [key]: id, channel_id: r.channel_id } });
    }
    out.pulled.push(r.channel_id);
  }
  return out;
}

export type ReconcileResult = { pulled: string[]; rescheduled: string[]; failed: string[]; unchecked: boolean };

/**
 * After an item is saved: a post Buffer holds that no longer matches what was
 * scheduled (text, image) is taken back out and the channel waits again; one
 * whose send time moved is taken out and handed over again at the new time.
 * Done here, at save time, because Buffer — not the app — sends it later.
 * `unchecked`: Buffer couldn't say which network each channel is, so nothing
 * could be compared; held posts were left as they are.
 */
export async function reconcileHeldPosts(
  db: Db,
  t: SocialTarget,
  deps: { publisher: SocialPublisher; live: boolean; enqueue: Enqueue; now?: Date },
): Promise<ReconcileResult> {
  const out: ReconcileResult = { pulled: [], rescheduled: [], failed: [], unchecked: false };
  const records = await readChannelRecords(db, t);
  const held = [...records.values()].filter((r) => r.handed_at && !r.posted_at);
  if (!held.length) return out;
  const item = await loadSocialItem(db, t);
  if (!item) return out;
  if (item.status !== "published" || item.social_skip) {
    const p = await pullBack(db, t, { channels: "all", keepConfirmation: true }, deps);
    return { ...out, pulled: p.pulled, failed: p.failed };
  }
  const networks = await deps.publisher.channelNetworks();
  if (networks.kind === "failed") return { ...out, unchecked: true };

  const now = deps.now ?? new Date();
  const caps = await readSocialCaps(db);
  const channelIds = await connectedChannelIds(db);
  const { channelPosts } = await import("./adapters/social");
  const changed: string[] = [];
  const moved: string[] = [];
  for (const { post } of channelPosts(item.post, channelIds, networks, leadsOf(records))) {
    const r = records.get(post.channelId);
    if (!r?.handed_at || r.posted_at) continue;
    if (r.skip || !snapshotMatches(r, post)) {
      changed.push(post.channelId);
      continue;
    }
    if (r.send_mode !== "schedule" || !r.due_at || !item.published_at) continue;
    const desired = handOffTime({ mode: "schedule", socialAt: item.social_at, publishedAt: item.published_at, delayMinutes: caps.delay_minutes, now });
    const { data: row } = await db.from("social_channel_posts").select("id").eq(targetOf(t).key, targetOf(t).id).eq("channel_id", post.channelId).maybeSingle();
    const at = capSlot({ desired, taken: await takenSlots(db, post.channelId, now, row?.id), perDay: caps.per_day, delayMinutes: caps.delay_minutes });
    const due = new Date(r.due_at);
    // Already going out (its time has passed): moving it now would only race Buffer.
    if (due.getTime() > now.getTime() + SLACK_MS && Math.abs(at.getTime() - due.getTime()) > SLACK_MS) moved.push(post.channelId);
  }
  // A channel dropped from the settings keeps its Buffer post: nothing here can rebuild it to compare.
  if (changed.length) {
    const p = await pullBack(db, t, { channels: changed, keepConfirmation: false }, deps);
    out.pulled.push(...p.pulled);
    out.failed.push(...p.failed);
  }
  if (moved.length) {
    const p = await pullBack(db, t, { channels: moved, keepConfirmation: true }, deps);
    out.failed.push(...p.failed);
    if (p.pulled.length) {
      const h = await handOffChannels(db, t, { ...deps, now, item });
      out.rescheduled.push(...h.handed);
    }
  }
  return out;
}

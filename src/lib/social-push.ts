import type { serviceDb } from "./db/server";
import type { ChannelNetworks, SentPost } from "./adapters/social";
import type { HandOffResult, ReconcileResult } from "./social-handoff";
import type { SendMode } from "./social-confirm";
import { logError } from "./log";
import type { JobKind } from "./jobs";
import { storyPostUrl, type StoryPostChannel } from "./social";
import { parseLondonInput } from "./london-time";
import { DEFAULT_SOCIAL_CAPS, type SocialCaps } from "./social-caps";
import { SOCIAL_LEAD_MAX } from "./social-text";
export { seenFromForm } from "./social-confirm";
import { confirmChannels, connectedChannelIds, leadsOf, loadSocialItem, readChannelRecords, targetOf, type SocialTarget } from "./social-post";

export { SOCIAL_LEAD_MAX, composeSocialText, trimLead } from "./social-text";
export type { SocialTarget } from "./social-post";

type Db = ReturnType<typeof serviceDb>;
type Enqueue = (kind: JobKind, payload?: Record<string, unknown>, dueAt?: Date) => Promise<void>;

/**
 * When a published story or video goes to social (Area 3 of Jas's 16 Oct flow
 * chart; issue #43 for confirmation).
 *
 * A channel posts at the latest of its post time (the item's own `social_at`,
 * or publication plus the global `social_caps.delay_minutes`), the item going
 * Live, and an admin confirming it (social-confirm.ts channelDueAt). One
 * social_push job per item covers all its channels; it is queued for the
 * earliest confirmed channel and queues itself again for the next.
 *
 * Every path that can change that — going Live, confirming, saving the editor
 * — calls queueSocialPush, so the rule lives once. A job exists only while a
 * confirmed channel is still to post: nothing is queued for an item nobody
 * confirmed, so saving a story that went Live years ago never posts it.
 *
 * `enqueue` is passed in, as with enqueueStoryLive: jobs.ts imports this
 * module, so importing jobs.ts back would be a cycle. Every caller passes the
 * real one, so a due job runs at once in development whichever path queued it.
 */

/** The global settings, falling back to the defaults for anything not yet edited. */
export async function readSocialCaps(db: Db): Promise<SocialCaps> {
  const { data } = await db.from("settings").select("value").eq("key", "social_caps").maybeSingle();
  return { ...DEFAULT_SOCIAL_CAPS, ...(data?.value as Partial<SocialCaps> | undefined) };
}

export type SocialFields = { social_text: string | null; social_at: string | null; social_skip: boolean };

/**
 * The editor's "Social post" fieldset. Absent entirely (a direct POST without
 * it) → undefined, leaving the stored values alone. A lead-in left as the
 * prefill (`social_text_default`) or blank is stored as null, so it keeps
 * following the summary when that is edited.
 */
export function socialFieldsFromForm(formData: FormData): { value?: SocialFields } | { error: string } {
  if (!formData.has("social_at")) return {};
  const text = String(formData.get("social_text") ?? "").replace(/\s+/g, " ").trim();
  const prefill = String(formData.get("social_text_default") ?? "").replace(/\s+/g, " ").trim();
  if (text.length > SOCIAL_LEAD_MAX) {
    return { error: `Keep the social lead-in to ${SOCIAL_LEAD_MAX} characters — it is ${text.length}.` };
  }
  const rawAt = String(formData.get("social_at") ?? "").trim();
  const at = rawAt ? parseLondonInput(rawAt) : null;
  if (rawAt && !at) return { error: "That social post time isn't a date and time we can read." };
  return {
    value: {
      social_text: text && text !== prefill ? text : null,
      social_at: at ? at.toISOString() : null,
      social_skip: formData.get("social_skip") === "on",
    },
  };
}

/**
 * The editor's per-channel "Don't post" boxes: every channel the form listed
 * (`social_channel`), and those ticked (`social_skip_channel`). Undefined when
 * the form listed none, leaving the stored choices alone.
 */
export function channelSkipsFromForm(formData: FormData): { shown: string[]; skipped: string[] } | undefined {
  const shown = formData.getAll("social_channel").map(String).filter(Boolean);
  if (!shown.length) return undefined;
  const skipped = formData.getAll("social_skip_channel").map(String).filter((c) => shown.includes(c));
  return { shown, skipped };
}

/** The editor's per-channel wording box (issue #101), named this plus the channel id. */
export const LEAD_FIELD = "social_lead:";

/**
 * Each listed channel's wording from the editor form. Only channels the form
 * listed (`social_channel`) are read, so a channel it didn't show is left as
 * it is; an empty box means the item's own lead-in.
 */
export function channelLeadsFromForm(formData: FormData): Map<string, string> | undefined {
  const shown = formData.getAll("social_channel").map(String).filter(Boolean);
  if (!shown.length) return undefined;
  const leads = new Map<string, string>();
  for (const c of shown) {
    const v = formData.get(`${LEAD_FIELD}${c}`);
    if (typeof v === "string") leads.set(c, v.replace(/\r\n/g, "\n").trim());
  }
  return leads;
}

/**
 * Whether a Live item has a channel scheduled or published-now that isn't
 * with Buffer yet (issue #101). Its time no longer matters here: Buffer is
 * told the time at hand-off and holds the post until then.
 */
async function hasChannelToHandOver(db: Db, t: SocialTarget, hold: string[]): Promise<boolean> {
  const { table, key, id } = targetOf(t);
  const { data: row } = await db.from(table).select("status, social_skip").eq("id", id).maybeSingle();
  if (!row || row.status !== "published" || row.social_skip) return false;
  const [channels, { data: records }] = await Promise.all([
    connectedChannelIds(db),
    db.from("social_channel_posts").select("channel_id, skip, confirmed_at, send_mode, handed_at, posted_at").eq(key, id),
  ]);
  return (records ?? []).some((r) =>
    channels.includes(r.channel_id) && !hold.includes(r.channel_id) && r.confirmed_at && r.send_mode && !r.skip && !r.handed_at && !r.posted_at);
}

/**
 * Bring the item's pending push in line with its channels: one job now when a
 * Live item has a channel to hand to Buffer, none otherwise. The clicks that
 * cause a hand-off also try it straight away (handOffNow); this job is the
 * backstop and the retry. `hold` leaves out channels a failed run is already
 * retrying. `_caps` is unused since Buffer applies the time; kept so callers
 * needn't change.
 */
export async function queueSocialPush(
  db: Db,
  t: SocialTarget,
  enqueue: Enqueue,
  _caps?: SocialCaps,
  o: { hold?: string[] } = {},
): Promise<Date | null> {
  const { key, id } = targetOf(t);
  const due = (await hasChannelToHandOver(db, t, o.hold ?? [])) ? new Date() : null;
  await cancelSocialPush(db, t);
  if (!due) return null;
  await enqueue("social_push", { [key]: id }, due);
  return due;
}

/**
 * Hand the item's ready channels to Buffer now, from a click (Schedule,
 * Publish now, Publish, Approve) rather than waiting for the job runner.
 * Never throws: a failure is logged and the queued social_push job retries.
 */
export async function handOffNow(db: Db, t: SocialTarget, enqueue: Enqueue): Promise<HandOffResult | null> {
  try {
    const [{ getSocialPublisher, isSocialLive }, { handOffChannels }] = await Promise.all([import("./adapters/social"), import("./social-handoff")]);
    return await handOffChannels(db, t, { publisher: getSocialPublisher(), live: isSocialLive(), enqueue });
  } catch (e) {
    logError({ source: "server", area: "social:hand-off", error: e, context: { ...t } });
    return null;
  }
}

/**
 * The item was saved, or left Live: take back out of Buffer anything that no
 * longer matches (issue #101, ADR 0003). Never throws; the result says what
 * happened so the caller can tell the admin.
 */
export async function reconcileNow(db: Db, t: SocialTarget, enqueue: Enqueue): Promise<ReconcileResult | null> {
  try {
    const [{ getSocialPublisher, isSocialLive }, { reconcileHeldPosts }] = await Promise.all([import("./adapters/social"), import("./social-handoff")]);
    const result = await reconcileHeldPosts(db, t, { publisher: getSocialPublisher(), live: isSocialLive(), enqueue });
    if (result.failed.length) {
      logError({ source: "server", area: "social:pull-back", error: `Buffer couldn't delete the held post for ${result.failed.join(", ")}: it may still go out`, context: { ...t } });
    }
    return result;
  } catch (e) {
    logError({ source: "server", area: "social:pull-back", error: e, context: { ...t } });
    return null;
  }
}

/** The item left "published": drop its pending push, so the editor doesn't show a post that won't happen. */
export async function cancelSocialPush(db: Db, t: SocialTarget): Promise<void> {
  const { key, id } = targetOf(t);
  await db.from("jobs").delete().eq("kind", "social_push").eq("status", "pending").filter(`payload->>${key}`, "eq", id);
}

export const CONFIRM_MESSAGES = {
  notFound: "That item isn't there any more.",
  noChannels: "No social channels are connected, so there is nothing to confirm.",
  lookupFailed: "Buffer couldn't say which network each channel is just now, so nothing was confirmed. Try again in a minute.",
  nothingWaiting: "Nothing was waiting for confirmation.",
  changed: "The post changed after this page loaded, so nothing was confirmed. Check the preview below and confirm again.",
} as const;

/**
 * An admin confirms one channel, or every channel still waiting ("all"):
 * what each would receive is built from the saved item — never from the
 * form — and stored as the snapshot, but only if it is what the admin's page
 * showed (`seen`, each channel's postFingerprint); otherwise nothing is
 * confirmed. Then the push is queued, so confirming a Live item that has
 * never been posted shares it (an explicit act, unlike a plain save). Works
 * in any status; it never posts before the item is Live.
 */
export async function confirmSocialPost(
  db: Db,
  t: SocialTarget,
  o: { only: string[] | "all"; userId: string; seen: Record<string, string>; mode?: SendMode },
  deps: { networks: () => Promise<ChannelNetworks>; enqueue: Enqueue; handOff?: (t: SocialTarget) => Promise<unknown> },
): Promise<{ ok: true; confirmed: string[] } | { ok: false; error: string }> {
  const [item, channelIds] = await Promise.all([loadSocialItem(db, t), connectedChannelIds(db)]);
  if (!item) return { ok: false, error: CONFIRM_MESSAGES.notFound };
  if (!channelIds.length) return { ok: false, error: CONFIRM_MESSAGES.noChannels };
  // Confirming the fallback text while Buffer is briefly unreachable would
  // store a snapshot the real post never matches.
  const networks = await deps.networks();
  if (networks.kind === "failed") return { ok: false, error: CONFIRM_MESSAGES.lookupFailed };
  if (item.social_skip) return { ok: false, error: CONFIRM_MESSAGES.nothingWaiting };
  const [{ channelPosts }, records] = await Promise.all([import("./adapters/social"), readChannelRecords(db, t)]);
  const posts = channelPosts(item.post, channelIds, networks, leadsOf(records)).map((c) => c.post);
  const { confirmed, stale } = await confirmChannels(db, t, { posts, only: o.only, userId: o.userId, seen: o.seen, mode: o.mode ?? "schedule" });
  if (stale.length) return { ok: false, error: CONFIRM_MESSAGES.changed };
  if (!confirmed.length) return { ok: false, error: CONFIRM_MESSAGES.nothingWaiting };
  await queueSocialPush(db, t, deps.enqueue);
  // A Live item goes to Buffer now rather than at the next job run (issue #101).
  if (item.status === "published") await (deps.handOff ?? ((x) => handOffNow(db, x, deps.enqueue)))(t);
  return { ok: true, confirmed };
}

export type SocialJob = { due_at: string; status: string } | null;

/** The latest social_push job for an item: the editor says so when it failed. */
export async function latestSocialJob(db: Db, t: SocialTarget): Promise<SocialJob> {
  const { key, id } = targetOf(t);
  const { data } = await db
    .from("jobs")
    .select("due_at, status")
    .eq("kind", "social_push")
    .filter(`payload->>${key}`, "eq", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/** Buffer's service names → the story's post-link fields. Other networks have no field. */
const POST_FIELD: Partial<Record<string, StoryPostChannel>> = { linkedin: "linkedin", facebook: "facebook", twitter: "x" };

/** Minutes before each look-up of a post's live link: Buffer sends "now", but asynchronously. */
export const SOCIAL_LINK_BACKOFF = [2, 10, 30, 120, 360];

/**
 * Write the live URLs of SMI's own posts into the story's post-link fields,
 * so nobody copies them from Buffer by hand. A field that already holds a link
 * is left alone — that one was pasted on purpose. Links go through the same
 * storyPostUrl check as a pasted one. Returns the posts still without a link
 * that are worth asking about again.
 */
export async function fillStoryPostLinks(db: Db, storyId: string, posts: SentPost[]): Promise<SentPost[]> {
  const found: Partial<Record<StoryPostChannel, string>> = {};
  const waiting: SentPost[] = [];
  for (const p of posts) {
    const field = POST_FIELD[p.service];
    if (!field) continue;
    const url = p.link ? storyPostUrl(field, p.link) : null;
    if (url) found[field] ??= url;
    // asked about again only while it has no link yet — a bad link won't improve
    else if (!p.link && p.status !== "error") waiting.push(p);
  }
  if (Object.keys(found).length) {
    const { data } = await db.from("stories").select("social_posts").eq("id", storyId).maybeSingle();
    const stored = (data?.social_posts && typeof data.social_posts === "object" && !Array.isArray(data.social_posts)
      ? data.social_posts
      : {}) as Record<string, string>;
    const add = Object.fromEntries(Object.entries(found).filter(([k]) => !stored[k]));
    if (Object.keys(add).length) {
      await db.from("stories").update({ social_posts: { ...stored, ...add } }).eq("id", storyId);
    }
  }
  return waiting;
}

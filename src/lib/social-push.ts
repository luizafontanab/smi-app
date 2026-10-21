import type { serviceDb } from "./db/server";
import type { SentPost } from "./adapters/social";
import type { JobKind } from "./jobs";
import { storyPostUrl, type StoryPostChannel } from "./social";
import { formatLondon, parseLondonInput } from "./london-time";
import { DEFAULT_SOCIAL_CAPS, type SocialCaps } from "./social-caps";

type Db = ReturnType<typeof serviceDb>;
type Enqueue = (kind: JobKind, payload?: Record<string, unknown>, dueAt?: Date) => Promise<void>;

/**
 * When a published story or video goes to social, and what it says (Area 3 of
 * Jas's 16 Oct flow chart: the admin manager sets the social timing per
 * story; the post carries a lead-in from the article).
 *
 * Every path that publishes queues its push through queueSocialPush, so the
 * rule lives once: the item's own `social_at` if set, otherwise publication
 * plus the global `social_caps.delay_minutes` — and never before it is live.
 * Six console paths used to hard-code 30 minutes instead.
 *
 * `enqueue` is passed in, as with enqueueStoryLive: jobs.ts imports this
 * module, so importing jobs.ts back would be a cycle.
 */

export type SocialTarget = { story_id: string } | { video_id: string };

/** The lead-in's length budget: leaves an X post room for the link (23) and a few tags. */
export const SOCIAL_LEAD_MAX = 200;

function targetOf(t: SocialTarget): { table: "stories" | "videos"; key: "story_id" | "video_id"; id: string } {
  return "story_id" in t
    ? { table: "stories", key: "story_id", id: t.story_id }
    : { table: "videos", key: "video_id", id: t.video_id };
}

/** The global settings, falling back to the defaults for anything not yet edited. */
export async function readSocialCaps(db: Db): Promise<SocialCaps> {
  const { data } = await db.from("settings").select("value").eq("key", "social_caps").maybeSingle();
  return { ...DEFAULT_SOCIAL_CAPS, ...(data?.value as Partial<SocialCaps> | undefined) };
}

/** When the push should run: the item's own time or publication + delay, and never in the past. */
export function socialDueAt(o: { socialAt: string | null; publishedAt: Date; delayMinutes: number; now?: Date }): Date {
  const now = o.now ?? new Date();
  const wanted = o.socialAt ? new Date(o.socialAt) : new Date(o.publishedAt.getTime() + o.delayMinutes * 60_000);
  return wanted.getTime() > now.getTime() ? wanted : now;
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

/** Cut to the lead-in budget on a word boundary. */
export function trimLead(text: string, max = SOCIAL_LEAD_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/** The post: the lead-in, then the link. The adapter appends tags after this. */
export function composeSocialText(lead: string, url: string): string {
  return `${trimLead(lead)}\n\n${url}`;
}

/**
 * Queue the push for an item that has just gone live. Replaces any push
 * already pending for it, and does nothing if it has already been posted.
 * Queued even when "don't post" is ticked: the flag is read when the job runs,
 * so unticking it before then still posts.
 */
export async function queueSocialPush(db: Db, t: SocialTarget, enqueue: Enqueue, caps?: SocialCaps): Promise<Date | null> {
  const { table, key, id } = targetOf(t);
  const { data: row } = await db
    .from(table)
    .select("social_at, social_posted_at, published_at")
    .eq("id", id)
    .maybeSingle();
  if (row?.social_posted_at) return null;
  const { delay_minutes } = caps ?? (await readSocialCaps(db));
  const due = socialDueAt({
    socialAt: row?.social_at ?? null,
    publishedAt: row?.published_at ? new Date(row.published_at) : new Date(),
    delayMinutes: delay_minutes,
  });
  await cancelSocialPush(db, t);
  await enqueue("social_push", { [key]: id }, due);
  return due;
}

/**
 * After the item's social fields are edited: move an already-pending push to
 * the new time. Never creates one — saving a story that went live years ago
 * must not post it now.
 */
export async function rescheduleSocialPush(db: Db, t: SocialTarget): Promise<Date | null> {
  const { table, key, id } = targetOf(t);
  const { data: jobs } = await db
    .from("jobs")
    .select("id")
    .eq("kind", "social_push")
    .eq("status", "pending")
    .filter(`payload->>${key}`, "eq", id);
  if (!jobs?.length) return null;
  const { data: row } = await db.from(table).select("social_at, published_at").eq("id", id).maybeSingle();
  if (!row?.published_at) return null;
  const { delay_minutes } = await readSocialCaps(db);
  const due = socialDueAt({ socialAt: row.social_at, publishedAt: new Date(row.published_at), delayMinutes: delay_minutes });
  await db
    .from("jobs")
    .update({ due_at: due.toISOString(), updated_at: new Date().toISOString() })
    .in("id", jobs.map((j) => j.id));
  return due;
}

/** The item left "published": drop its pending push, so the editor doesn't show a post that won't happen. */
export async function cancelSocialPush(db: Db, t: SocialTarget): Promise<void> {
  const { key, id } = targetOf(t);
  await db.from("jobs").delete().eq("kind", "social_push").eq("status", "pending").filter(`payload->>${key}`, "eq", id);
}

export type SocialJob = { due_at: string; status: string } | null;

/** The latest social_push job for an item, for the editor's status line. */
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

/**
 * One line saying where an item's social post stands. Times are UK time.
 * `live` is false where no Buffer token is set: there, nothing goes out.
 */
export function socialStatusLine(o: {
  status: string;
  social_at: string | null;
  social_skip: boolean;
  social_posted_at: string | null;
  scheduled_at: string | null;
  job: SocialJob;
  caps: SocialCaps;
  live: boolean;
}): string {
  if (o.social_posted_at) return `Posted to social on ${formatLondon(o.social_posted_at)}.`;
  const offline = o.live ? "" : " Buffer isn't connected here, so nothing will actually be posted.";
  if (o.status !== "published") {
    if (o.social_skip) return "Won't be posted to social: “Don't post” is ticked.";
    if (!o.social_at) return `Posts to social ${o.caps.delay_minutes} minutes after it goes live.${offline}`;
    const early = o.scheduled_at && new Date(o.social_at) < new Date(o.scheduled_at)
      ? " That's before its publish time, so it posts as soon as it goes live."
      : "";
    return `Posts to social on ${formatLondon(o.social_at)}, or as soon as it goes live if that's later.${early}${offline}`;
  }
  switch (o.job?.status) {
    case "pending":
      return o.social_skip
        ? `Won't be posted to social: “Don't post” is ticked. Untick it before ${formatLondon(o.job.due_at)} to post it.`
        : `Posts to social on ${formatLondon(o.job.due_at)}. The daily limit of ${o.caps.per_day} can move it to the next morning.${offline}`;
    case "running":
      return "Posting to social now.";
    case "dead":
      return "The social post failed. It's listed in Needs You Today.";
    case "done":
    case "failed":
      if (o.social_skip) return "Not posted to social: “Don't post” was ticked.";
      return o.live ? "Not posted to social." : "Not posted to social: Buffer isn't connected here.";
    default:
      return "Not queued for social.";
  }
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

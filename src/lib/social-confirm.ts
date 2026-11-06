/**
 * Per-channel confirmation of social posts (issue #43,
 * docs/adr/0001-social-posts-need-per-channel-confirmation.md). Nothing goes
 * out on a social channel until an admin has seen exactly what that channel
 * will receive and confirmed it.
 *
 * Confirmation is a snapshot, not a flag: it stores the text and image the
 * channel would receive. Just before posting, the post is built again and
 * compared, so any change — the lead-in, the link, the image, or one
 * network's tags after a member edits a handle — holds that channel back
 * until someone confirms it again.
 */

import { formatLondonShort } from "./london-time";

/**
 * The editor's Confirm sends each channel's fingerprint as it was shown, in a
 * field named this plus the channel id (social-post postFingerprint).
 */
export const SEEN_FIELD = "social_seen:";

/** Each channel's fingerprint as the editor showed it, from the Confirm form. */
export function seenFromForm(formData: FormData): Record<string, string> {
  const seen: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (name.startsWith(SEEN_FIELD) && typeof value === "string") seen[name.slice(SEEN_FIELD.length)] = value;
  }
  return seen;
}

/** What one channel would receive. */
export type ChannelPost = { channelId: string; text: string; imagePath: string | null };

/** The stored confirmation, as `social_channel_posts` holds it. */
export type ChannelSnapshot = { confirmed_text: string | null; confirmed_image: string | null; confirmed_at: string | null };

/** True only when the channel was confirmed and would receive exactly that now. */
export function snapshotMatches(snap: ChannelSnapshot | null, post: Pick<ChannelPost, "text" | "imagePath">): boolean {
  if (!snap?.confirmed_at || snap.confirmed_text === null) return false;
  return snap.confirmed_text === post.text && (snap.confirmed_image ?? null) === (post.imagePath ?? null);
}

/**
 * When a confirmed channel posts: the latest of its post time (the item's own
 * `social_at`, or publication plus the global delay), the item going Live,
 * and the confirmation. Null when it can't post yet — not Live, or not
 * confirmed. Confirming never makes a post go out early.
 */
/** The item's own post time, or publication plus the global delay. */
export function postTimeOf(o: { socialAt: string | null; publishedAt: string; delayMinutes: number }): number {
  return o.socialAt ? new Date(o.socialAt).getTime() : new Date(o.publishedAt).getTime() + o.delayMinutes * 60_000;
}

export function channelDueAt(o: {
  socialAt: string | null;
  publishedAt: string | null;
  confirmedAt: string | null;
  delayMinutes: number;
}): Date | null {
  if (!o.publishedAt || !o.confirmedAt) return null;
  const postTime = postTimeOf({ socialAt: o.socialAt, publishedAt: o.publishedAt, delayMinutes: o.delayMinutes });
  return new Date(Math.max(postTime, new Date(o.publishedAt).getTime(), new Date(o.confirmedAt).getTime()));
}

/** One channel's stored state for an item. No row at all means unconfirmed. */
export type ChannelRecord = ChannelSnapshot & { channel_id: string; skip: boolean; posted_at: string | null };

export type SocialPushPlan = {
  /** Post these now, each with exactly this text. */
  send: ChannelPost[];
  /** Changed since confirmed: clear the confirmation, so the channel waits again. */
  unconfirm: string[];
  /** Due, but the channel already had its daily limit today. */
  overCap: string[];
  /** The earliest confirmed channel still to come, if any. */
  nextAt: Date | null;
};

/**
 * What one run of the social_push job does for one item. Channels are
 * independent: one waiting for confirmation, marked Don't post or over its
 * own daily limit never holds back another. The snapshot is compared only once
 * a channel is due, just before it would post.
 */
export function planSocialPush(o: {
  now: Date;
  item: { socialAt: string | null; publishedAt: string | null; skip: boolean };
  delayMinutes: number;
  perDay: number;
  channels: { post: ChannelPost; record: ChannelRecord | null }[];
  /** Posts each channel has had since London midnight. */
  postedToday: Record<string, number>;
}): SocialPushPlan {
  const plan: SocialPushPlan = { send: [], unconfirm: [], overCap: [], nextAt: null };
  if (o.item.skip || !o.item.publishedAt) return plan;
  for (const { post, record } of o.channels) {
    if (!record?.confirmed_at || record.skip || record.posted_at) continue;
    const due = channelDueAt({
      socialAt: o.item.socialAt,
      publishedAt: o.item.publishedAt,
      confirmedAt: record.confirmed_at,
      delayMinutes: o.delayMinutes,
    });
    if (!due) continue;
    // a minute's slack, so a run that starts a moment early doesn't re-queue itself
    if (due.getTime() > o.now.getTime() + 60_000) {
      if (!plan.nextAt || due < plan.nextAt) plan.nextAt = due;
      continue;
    }
    if (!snapshotMatches(record, post)) plan.unconfirm.push(post.channelId);
    else if ((o.postedToday[post.channelId] ?? 0) >= o.perDay) plan.overCap.push(post.channelId);
    else plan.send.push(post);
  }
  return plan;
}

/** One channel as the editor shows it. */
export type ChannelView = {
  /** "LinkedIn", "X", … or the channel id when its network isn't known. */
  label: string;
  post: ChannelPost;
  record: ChannelRecord | null;
  /** The confirming admin's display name, when there is one. */
  confirmedBy: string | null;
};

/** Where this channel stands, for the editor and the confirm buttons. */
export function channelState(v: Pick<ChannelView, "post" | "record">, itemSkip: boolean): "posted" | "skipped" | "confirmed" | "waiting" {
  if (v.record?.posted_at) return "posted";
  if (itemSkip || v.record?.skip) return "skipped";
  return snapshotMatches(v.record, v.post) ? "confirmed" : "waiting";
}

/**
 * One line per channel saying where its post stands, e.g.
 * "LinkedIn: confirmed by Jas 5 Nov 14:02, posts 15:00" / "X: waiting for
 * confirmation" / "Facebook: posted 5 Nov 15:00". UK times.
 */
export function channelStatusLines(o: {
  now: Date;
  delayMinutes: number;
  item: { status: string; socialAt: string | null; publishedAt: string | null; skip: boolean };
  channels: ChannelView[];
}): string[] {
  const at = (iso: string) => formatLondonShort(iso);
  const upcoming = (iso: string | Date) => formatLondonShort(iso, o.now);
  return o.channels.map((v) => {
    const { label, record } = v;
    const by = v.confirmedBy ?? "an admin";
    switch (channelState(v, o.item.skip)) {
      case "posted":
        return `${label}: posted ${at(record!.posted_at!)}`;
      case "skipped":
        return `${label}: won't be posted (“Don't post” is ticked)`;
      case "waiting":
        return record?.confirmed_at
          ? `${label}: waiting for confirmation — the post changed after ${by} confirmed it`
          : `${label}: waiting for confirmation`;
      case "confirmed": {
        const confirmed = `${label}: confirmed by ${by} ${at(record!.confirmed_at!)}`;
        if (o.item.status !== "published") {
          return o.item.socialAt
            ? `${confirmed}, posts ${upcoming(o.item.socialAt)}, or as soon as it goes live if that's later`
            : `${confirmed}, posts ${o.delayMinutes} minutes after it goes live`;
        }
        const due = channelDueAt({ socialAt: o.item.socialAt, publishedAt: o.item.publishedAt, confirmedAt: record!.confirmed_at, delayMinutes: o.delayMinutes });
        return !due || due <= o.now ? `${confirmed}, posts on the next run` : `${confirmed}, posts ${upcoming(due)}`;
      }
    }
  });
}

/** "1 of 3 channels needs confirming", for Needs You Today and the digest. */
export function waitingSummary(waiting: number, total: number): string {
  return `${waiting} of ${total} channel${total === 1 ? "" : "s"} need${waiting === 1 ? "s" : ""} confirming`;
}

/** The Publishing panel's one line about the social post, from each channel's state. */
export function socialSummary(states: ReturnType<typeof channelState>[]): string {
  if (!states.length) return "No social channels connected.";
  const n = (s: ReturnType<typeof channelState>) => states.filter((x) => x === s).length;
  const parts = [
    n("posted") && `${n("posted")} posted`,
    n("confirmed") && `${n("confirmed")} confirmed`,
    n("waiting") && `${n("waiting")} waiting for confirmation`,
    n("skipped") && `${n("skipped")} not posted (“Don't post”)`,
  ].filter(Boolean);
  return `Social post: ${parts.join(", ")}.`;
}

/** Lines about the post as a whole, under the channel previews. */
export function socialNotes(o: { live: boolean; job: { status: string } | null }): string[] {
  const notes: string[] = [];
  if (!o.live) notes.push("Buffer isn't connected here, so nothing will actually be posted.");
  if (o.job?.status === "dead") notes.push("The last attempt to post failed. It's listed in Needs You Today.");
  if (o.job?.status === "running") notes.push("Posting to social now.");
  return notes;
}

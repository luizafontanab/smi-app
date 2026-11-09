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

/** The item's own post time, or publication plus the global delay. */
export function postTimeOf(o: { socialAt: string | null; publishedAt: string; delayMinutes: number }): number {
  return o.socialAt ? new Date(o.socialAt).getTime() : new Date(o.publishedAt).getTime() + o.delayMinutes * 60_000;
}

/** Schedule (Buffer sends at the channel's post time) or Publish now — chosen with the confirmation (issue #101). */
export type SendMode = "schedule" | "now";

/**
 * One channel's stored state for an item. No row at all means unconfirmed.
 * The fields after `posted_at` came with issue #101 and are optional so a
 * record built before them still reads as "not handed over, no draft".
 */
export type ChannelRecord = ChannelSnapshot & {
  channel_id: string;
  skip: boolean;
  /** Buffer reported the post sent. */
  posted_at: string | null;
  /** This channel's own wording, and whether Claude wrote it. */
  lead_text?: string | null;
  lead_ai?: boolean;
  send_mode?: SendMode | null;
  /** Handed to Buffer, which holds it until `due_at`. */
  handed_at?: string | null;
  due_at?: string | null;
  buffer_post_id?: string | null;
  buffer_status?: string | null;
  draft_post_id?: string | null;
  draft_text?: string | null;
  draft_image?: string | null;
  draft_at?: string | null;
};

/** One channel as the editor shows it. */
export type ChannelView = {
  /** "LinkedIn", "X", … or the channel id when its network isn't known. */
  label: string;
  post: ChannelPost;
  record: ChannelRecord | null;
  /** The confirming admin's display name, when there is one. */
  confirmedBy: string | null;
};

export type ChannelState = "posted" | "handed" | "skipped" | "confirmed" | "waiting";

/**
 * Where this channel stands, for the editor and its buttons. "handed": Buffer
 * holds the post and will send it (issue #101). "confirmed": scheduled or
 * published-now, waiting for the item to go Live before it's handed over.
 */
export function channelState(v: Pick<ChannelView, "post" | "record">, itemSkip: boolean): ChannelState {
  if (v.record?.posted_at) return "posted";
  if (v.record?.handed_at) return "handed";
  if (itemSkip || v.record?.skip) return "skipped";
  return snapshotMatches(v.record, v.post) ? "confirmed" : "waiting";
}

/**
 * One line per channel saying where its post stands, e.g. "LinkedIn:
 * scheduled in Buffer for 5 Nov 15:00" / "X: waiting — Schedule or Publish
 * now" / "Facebook: posted 5 Nov 15:00". UK times. (Issue #101: Buffer holds
 * a scheduled post and sends it; the app hands it over once the item is Live.)
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
      case "handed": {
        if (record!.buffer_status === "error") return `${label}: Buffer couldn't send it. Check the post in Buffer.`;
        // Changed since it was handed over, and Buffer refused the delete that should have followed.
        if (!snapshotMatches(record, v.post)) {
          return `${label}: ⚠ Buffer still holds an older version, which couldn't be taken back. Delete it in Buffer, then save again.`;
        }
        const due = record!.due_at;
        return !due || new Date(due) <= o.now
          ? `${label}: with Buffer, sending now`
          : `${label}: scheduled in Buffer for ${upcoming(due)}`;
      }
      case "skipped":
        return `${label}: won't be posted (“Don't post” is ticked)`;
      case "waiting":
        return record?.confirmed_at
          ? `${label}: waiting — the post changed after ${by} scheduled it`
          : `${label}: waiting — Schedule or Publish now`;
      case "confirmed": {
        const what = record!.send_mode === "now" ? "to publish now" : "scheduled";
        const confirmed = `${label}: ${what} by ${by} ${at(record!.confirmed_at!)}`;
        if (o.item.status !== "published") {
          if (record!.send_mode === "now") return `${confirmed}, goes to Buffer as soon as it goes live`;
          return o.item.socialAt
            ? `${confirmed}, posts ${upcoming(o.item.socialAt)}, or as soon as it goes live if that's later`
            : `${confirmed}, posts ${o.delayMinutes} minutes after it goes live`;
        }
        return `${confirmed}, going to Buffer`;
      }
    }
  });
}

/** "1 of 3 channels needs confirming", for Needs You Today and the digest. */
export function waitingSummary(waiting: number, total: number): string {
  return `${waiting} of ${total} channel${total === 1 ? "" : "s"} need${waiting === 1 ? "s" : ""} confirming`;
}

/** The Publishing panel's one line about the social post, from each channel's state. */
export function socialSummary(states: ChannelState[]): string {
  if (!states.length) return "No social channels connected.";
  const n = (s: ChannelState) => states.filter((x) => x === s).length;
  const parts = [
    n("posted") && `${n("posted")} posted`,
    n("handed") && `${n("handed")} with Buffer`,
    n("confirmed") && `${n("confirmed")} scheduled`,
    n("waiting") && `${n("waiting")} waiting`,
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

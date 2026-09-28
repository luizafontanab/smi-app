/**
 * The console inbox vocabulary, and where a notification takes Jas (fix-list 71).
 *
 * `inbox_messages` now carries two kinds of thing, split by `category`:
 *
 *   · a **message** — a person wrote it and is waiting for an answer. Contact
 *     and advertising enquiries from the public forms, and a member's note from
 *     the Help page or a "request a change". These get a reply, not a link.
 *   · a **notification** — something happened and the row is a receipt for it.
 *     A story was submitted, a card was declined, an advert run is ending. No
 *     reply exists to send; what it needs is a way through to the thing it is
 *     about, which is what `consoleNotificationHref` is for.
 *
 * This mirrors `src/lib/notification-links.ts` on the member side, but is much
 * simpler: every console route that matters is keyed by the row's own id
 * (`/console/stories/[id]`, `/console/members/[id]` …), so there is no slug to
 * resolve and nothing to look up before calling this. Pure, so it unit-tests
 * directly.
 *
 * The two kind lists below are the application-side copy of the `kind` check
 * constraint in `supabase/migrations/20260923000001_inbox_categories.sql`. Keep
 * them in step with it: a kind the database accepts but this file does not know
 * renders with no label and no link.
 */

/** Kinds where a human wrote the row and expects a reply. */
export const INBOX_MESSAGE_KINDS = ["contact", "advertising", "membership"] as const;

/** Kinds where the system wrote the row to report that something happened. */
export const INBOX_NOTIFICATION_KINDS = [
  "signup_started",
  "payment_taken",
  "page_submitted",
  "payment_failed",
  "subscription_ended",
  "comp_expired",
  "membership_lapsed",
  "advert_ending",
  "story_submitted",
  "video_submitted",
  "event_submitted",
  "machine_submitted",
  "advert_submitted",
  "artwork_submitted",
  // A live page's edit (member_revisions) — GAPS A1.12, 20260928000005.
  "page_edit_submitted",
] as const;

export type InboxMessageKind = (typeof INBOX_MESSAGE_KINDS)[number];
export type InboxNotificationKind = (typeof INBOX_NOTIFICATION_KINDS)[number];
export type InboxKind = InboxMessageKind | InboxNotificationKind;
export type InboxCategory = "message" | "notification";

/** What a notification carries so it can point at the thing it is about. */
export type InboxPayload = {
  member_id?: string;
  story_id?: string;
  video_id?: string;
  event_id?: string;
  machine_id?: string;
  booking_id?: string;
  /** Carried by artwork swaps. Nothing links on it yet — there is no per-proposal console route. */
  advert_id?: string;
};

/**
 * Short names for the tab strip, the row badge and the suggested reply subject.
 * The raw kind (`page_submitted`) is a database value, not English.
 */
const LABELS: Record<InboxKind, string> = {
  contact: "Contact enquiry",
  advertising: "Advertising enquiry",
  membership: "Member message",
  signup_started: "Signup started",
  payment_taken: "Payment taken",
  page_submitted: "Page submitted",
  payment_failed: "Payment failed",
  subscription_ended: "Subscription ended",
  comp_expired: "Comp expired",
  membership_lapsed: "Membership lapsed",
  advert_ending: "Advert ending",
  story_submitted: "Story submitted",
  video_submitted: "Video submitted",
  event_submitted: "Event submitted",
  machine_submitted: "Equipment submitted",
  advert_submitted: "Advert submitted",
  artwork_submitted: "Artwork swap",
  page_edit_submitted: "Page edit",
};

export function inboxKindLabel(kind: string): string {
  return LABELS[kind as InboxKind] ?? kind;
}

/**
 * The noun that goes in the suggested reply subject — "Re: your <this> to Sheet
 * Metal Industries". The old code interpolated the raw kind there, which read
 * "Re: your membership enquiry" on a member asking a question about their own
 * invoice, and would now read "Re: your page_submitted enquiry" outright.
 */
const SUBJECT_NOUNS: Record<InboxMessageKind, string> = {
  contact: "enquiry",
  advertising: "advertising enquiry",
  membership: "message",
};

export function replySubjectFor(kind: string): string {
  const noun = SUBJECT_NOUNS[kind as InboxMessageKind] ?? "message";
  return `Re: your ${noun} to Sheet Metal Industries`;
}

const id = (payload: InboxPayload, key: keyof InboxPayload) => {
  const v = payload[key];
  return typeof v === "string" && v ? v : null;
};

/**
 * Where a notification should take Jas, or null if it is not a notification.
 *
 * Every branch has a list-page fallback rather than returning null when the id
 * is missing: unlike the member side there is no risk of a 404 with someone's
 * name on it — `/console/stories` is a real page that will contain the item —
 * and a notification you cannot click is the thing this whole change is fixing.
 * Message kinds return null on purpose: their action is the reply form, and a
 * link would compete with it.
 */
export function consoleNotificationHref(kind: string, payload: InboxPayload = {}): string | null {
  const memberId = id(payload, "member_id");
  const bookingId = id(payload, "booking_id");
  const member = memberId ? `/console/members/${memberId}` : "/console/members";

  switch (kind) {
    // The member funnel and the membership lifecycle: all of it is read and
    // acted on from that member's own console record.
    case "signup_started":
    case "payment_taken":
    case "page_submitted":
    // The pending edit's Approve/Reject sit on the member's console record.
    case "page_edit_submitted":
    case "payment_failed":
    case "subscription_ended":
    case "comp_expired":
    case "membership_lapsed":
      return member;

    case "story_submitted": {
      const storyId = id(payload, "story_id");
      return storyId ? `/console/stories/${storyId}` : "/console/stories";
    }
    case "video_submitted": {
      const videoId = id(payload, "video_id");
      return videoId ? `/console/videos/${videoId}` : "/console/videos";
    }
    case "event_submitted": {
      const eventId = id(payload, "event_id");
      return eventId ? `/console/events/${eventId}` : "/console/events";
    }
    case "machine_submitted": {
      const machineId = id(payload, "machine_id");
      return machineId ? `/console/machines/${machineId}` : "/console/machines";
    }

    // A booking is the approvable thing; the advert row behind it has no page.
    case "advert_submitted":
    case "advert_ending":
      return bookingId ? `/console/adverts/${bookingId}` : "/console/adverts";

    // Artwork swaps are decided on one queue page — there is no per-proposal
    // route to link to, and inventing one is out of scope here.
    case "artwork_submitted":
      return "/console/adverts/artwork";

    // Messages (and anything unrecognised) have no destination.
    default:
      return null;
  }
}

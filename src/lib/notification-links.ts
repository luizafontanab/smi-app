import type { NotificationPayload } from "@/lib/email/templates";

/**
 * Where a notification should take the member (fix list).
 *
 * Every notification is about something, and until now none of them said what —
 * "Your video is live" was a dead line of text with no way to go and look at it.
 *
 * Two destinations, chosen by what the member can actually do next:
 *   · something went live → the public page, so they can see it as a reader
 *     does and share the link;
 *   · something was sent back → their own editor for it, because the next move
 *     is theirs and it needs the reason in front of them.
 *
 * Pure, so it unit-tests directly. Slugs are looked up by the caller and passed
 * in — `null` back means "no destination", never a guessed URL: a link to a
 * story whose slug we failed to resolve is a 404 with the member's name on it.
 *
 * A notification is written once and read for months, so neither destination can
 * be decided from the kind alone — the item moves on underneath it. A sent-back
 * story that the member fixed and got published no longer has an editor to open
 * (those routes 404 outside the pre-approval statuses), and a live story since
 * withdrawn no longer has a public page. That is why the caller passes the
 * current status alongside the slug and every branch below re-checks it.
 */
export type ItemTarget = { slug: string; status: string };

export type SlugMaps = {
  stories?: Record<string, ItemTarget>;
  videos?: Record<string, ItemTarget>;
  events?: Record<string, ItemTarget>;
  /** The member's own page slug, for the notifications about their profile. */
  member?: string | null;
};

const PUBLISHED = "published";
/** The statuses the member's own editors accept — see dashboard/<kind>/[id]/edit. */
const EDITABLE_STATUSES = ["awaiting_approval", "rejected"];
/** Where anything with no better destination lands, as machine_rejected already does. */
const ATTENTION = "/dashboard/submissions?status=attention";

const id = (payload: NotificationPayload, key: string) => {
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === "string" && v ? v : null;
};

/** The public page of something that went live — only while it is still published. */
const liveHref = (prefix: string, itemId: string | null, map?: Record<string, ItemTarget>) => {
  const target = itemId ? map?.[itemId] : null;
  return target && target.status === PUBLISHED ? `${prefix}/${target.slug}` : null;
};

/**
 * Where a sent-back item goes, by where it has got to since:
 *   · still the member's to fix → their editor, which shows the reason;
 *   · fixed and published → the public page, so the link stays good;
 *   · anything else (withdrawn, deleted) → the attention tab.
 * No map at all means the caller looked nothing up, so trust the kind: it was
 * editable when the notification was written.
 */
const sentBackHref = (kind: string, prefix: string, itemId: string | null, map?: Record<string, ItemTarget>) => {
  if (!itemId) return null;
  const editor = `/dashboard/${kind}/${itemId}/edit`;
  if (!map) return editor;
  const target = map[itemId];
  if (!target) return ATTENTION;
  if (EDITABLE_STATUSES.includes(target.status)) return editor;
  return target.status === PUBLISHED ? `${prefix}/${target.slug}` : ATTENTION;
};

export function notificationHref(kind: string, payload: NotificationPayload, slugs: SlugMaps = {}): string | null {
  const storyId = id(payload, "story_id");
  const videoId = id(payload, "video_id");
  const eventId = id(payload, "event_id");
  const bookingId = id(payload, "booking_id");
  const memberSlug = slugs.member ?? null;

  switch (kind) {
    case "story_live":
    case "story_featured":
      return liveHref("/news", storyId, slugs.stories);
    case "video_live":
      return liveHref("/video", videoId, slugs.videos);
    case "event_published":
      return liveHref("/event", eventId, slugs.events);

    // Sent back: the member's own editor, where the reason is shown and the
    // resubmit lives — unless it has moved on since. See sentBackHref.
    case "story_rejected":
      return sentBackHref("story", "/news", storyId, slugs.stories);
    case "video_rejected":
      return sentBackHref("video", "/video", videoId, slugs.videos);
    case "event_rejected":
      return sentBackHref("event", "/event", eventId, slugs.events);

    // Equipment has no page of its own — /featured-machine is a single page.
    case "machine_live":
      return "/featured-machine";
    case "machine_rejected":
      return ATTENTION;

    case "page_live":
      return memberSlug ? `/member/${memberSlug}` : "/dashboard/profile";
    case "page_changes_live":
      return memberSlug ? `/member/${memberSlug}` : "/dashboard/profile";
    case "page_changes_rejected":
      return "/dashboard/profile";

    // The advert emails already land on the booking when they can (templates.ts
    // carries booking_id for exactly this); match that here.
    case "advert_live":
    case "advert_scheduled":
    case "advert_changes_needed":
    case "advert_ending_soon":
    case "advert_ended":
    case "advert_artwork_approved":
    case "advert_artwork_rejected":
      return bookingId ? `/dashboard/advert/${bookingId}` : "/dashboard/advertising/manage";

    // The pay page needs the invoice; without one, billing lists it.
    case "advert_payment_due": {
      const invoiceId = id(payload, "invoice_id");
      return invoiceId ? `/dashboard/pay/invoice/${invoiceId}` : "/dashboard/settings/billing";
    }
    case "advert_payment_received":
      return bookingId ? `/dashboard/advert/${bookingId}` : "/dashboard/settings/billing";

    case "visibility_confirmed":
    case "visibility_declined":
      return "/dashboard/advertising";

    case "payment_receipt":
    case "comp_applied":
    case "membership_lapsed":
    case "membership_cancel_requested":
    case "membership_cancelled":
      return "/dashboard/settings/billing";

    // lead_alert counts engagement_audit rows (companies engaging with the
    // member's page), not the mock prospect list at /dashboard/leads, so it
    // goes where its email's button already goes.
    case "stats_summary":
    case "lead_alert":
      return "/dashboard/stats";

    case "welcome":
    case "account_created":
      return "/dashboard";

    default:
      return null;
  }
}

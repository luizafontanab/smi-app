import { describe, expect, it } from "vitest";
import { NOTIFICATION_KINDS, type NotificationPayload } from "@/lib/email/templates";
import { notificationHref } from "@/lib/notification-links";

const live = (slug: string) => ({ slug, status: "published" });
const slugs = {
  stories: { s1: live("big-news") },
  videos: { v1: live("a-video") },
  events: { e1: live("open-day") },
  member: "acme",
};
const p = (o: Record<string, unknown> = {}) => o as NotificationPayload;

describe("notificationHref", () => {
  it("sends a live item to its public page", () => {
    expect(notificationHref("story_live", p({ story_id: "s1" }), slugs)).toBe("/news/big-news");
    expect(notificationHref("video_live", p({ video_id: "v1" }), slugs)).toBe("/video/a-video");
    expect(notificationHref("event_published", p({ event_id: "e1" }), slugs)).toBe("/event/open-day");
  });

  // A notification outlives the state it describes. "Your story went live" sent
  // in March is still in the list after the story is withdrawn, and the slug
  // still resolves — only the status says the page has gone.
  it("drops the link when a once-live item is no longer published", () => {
    const withdrawn = { stories: { s1: { slug: "big-news", status: "draft" } } };
    expect(notificationHref("story_live", p({ story_id: "s1" }), withdrawn)).toBeNull();
  });

  // A rejected item's next move belongs to the member, and the reason is shown
  // on their editor — not on the public page, which does not exist yet anyway.
  it("sends a sent-back item to the member's own editor, with no slug needed", () => {
    expect(notificationHref("story_rejected", p({ story_id: "s9" }), {})).toBe("/dashboard/story/s9/edit");
    expect(notificationHref("video_rejected", p({ video_id: "v9" }), {})).toBe("/dashboard/video/v9/edit");
    expect(notificationHref("event_rejected", p({ event_id: "e9" }), {})).toBe("/dashboard/event/e9/edit");
  });

  it("keeps sending a sent-back item to the editor while it is still fixable", () => {
    const pending = { videos: { v9: { slug: "a-video", status: "awaiting_approval" } } };
    expect(notificationHref("video_rejected", p({ video_id: "v9" }), pending)).toBe("/dashboard/video/v9/edit");
  });

  // Those editors 404 outside the pre-approval statuses, so once the member has
  // fixed it and it has published, the old notification must move with it.
  it("follows a sent-back item to its public page once it publishes", () => {
    expect(notificationHref("story_rejected", p({ story_id: "s1" }), slugs)).toBe("/news/big-news");
    expect(notificationHref("video_rejected", p({ video_id: "v1" }), slugs)).toBe("/video/a-video");
    expect(notificationHref("event_rejected", p({ event_id: "e1" }), slugs)).toBe("/event/open-day");
  });

  // Neither editable nor live: withdrawn, or deleted outright. The attention tab
  // is somewhere real, which a link into either route would not be.
  it("falls back to the attention tab when a sent-back item is neither", () => {
    const gone = { events: { e5: { slug: "old-day", status: "draft" } } };
    expect(notificationHref("event_rejected", p({ event_id: "e5" }), gone)).toBe("/dashboard/submissions?status=attention");
    expect(notificationHref("event_rejected", p({ event_id: "missing" }), gone)).toBe("/dashboard/submissions?status=attention");
  });

  // Guessing a URL from an unresolved slug would 404 with the member's own
  // content behind it — worse than showing no link at all.
  it("returns null rather than guessing when a slug is missing", () => {
    expect(notificationHref("story_live", p({ story_id: "unknown" }), slugs)).toBeNull();
    expect(notificationHref("video_live", p({}), slugs)).toBeNull();
  });

  it("lands advert notifications on the booking when it knows which one", () => {
    expect(notificationHref("advert_ending_soon", p({ booking_id: "b1" }), {})).toBe("/dashboard/advert/b1");
    expect(notificationHref("advert_ending_soon", p({}), {})).toBe("/dashboard/advertising/manage");
  });

  it("sends page notifications to the live member page, falling back to the editor", () => {
    expect(notificationHref("page_changes_live", p({}), slugs)).toBe("/member/acme");
    expect(notificationHref("page_changes_live", p({}), {})).toBe("/dashboard/profile");
    expect(notificationHref("page_changes_rejected", p({}), slugs)).toBe("/dashboard/profile");
  });

  // lead_alert is about page engagement, not the mock prospects panel, and
  // must agree with its own email's button (email/templates.ts).
  it("sends a lead alert to stats, where its email's button goes", () => {
    expect(notificationHref("lead_alert", p({}), slugs)).toBe("/dashboard/stats");
  });

  it("never invents a link for an unknown kind", () => {
    expect(notificationHref("something_new", p({ story_id: "s1" }), slugs)).toBeNull();
  });

  // 6 Oct: "payment due" opens the pay page for its invoice — one invoice can
  // pay for a bundle or a placement, so it isn't keyed on a booking.
  it("sends a payment-due notice to its invoice's pay page, falling back to billing", () => {
    expect(notificationHref("advert_payment_due", p({ invoice_id: "inv1", booking_id: "b1" }), slugs)).toBe("/dashboard/pay/invoice/inv1");
    expect(notificationHref("advert_payment_due", p({}), slugs)).toBe("/dashboard/settings/billing");
    expect(notificationHref("advert_payment_received", p({ booking_id: "b1" }), slugs)).toBe("/dashboard/advert/b1");
    expect(notificationHref("advert_payment_received", p({}), slugs)).toBe("/dashboard/settings/billing");
  });

  // The map is keyed by hand, so a kind added to NOTIFICATION_KINDS without a
  // case here silently loses its link. This is the guard against that going
  // unnoticed: every kind must be a deliberate decision, including "no link".
  // Empty today: lead_alert was the last exception.
  const NO_LINK = new Set<string>();
  it("every registered notification kind is either linked or deliberately not", () => {
    const payload = p({ story_id: "s1", video_id: "v1", event_id: "e1", booking_id: "b1" });
    for (const kind of NOTIFICATION_KINDS) {
      const href = notificationHref(kind, payload, slugs);
      if (NO_LINK.has(kind)) expect(href, kind).toBeNull();
      else expect(href, kind).toBeTruthy();
    }
  });
});

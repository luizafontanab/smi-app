import { describe, expect, it } from "vitest";
import {
  consoleNotificationHref,
  inboxKindLabel,
  replySubjectFor,
  INBOX_MESSAGE_KINDS,
  INBOX_NOTIFICATION_KINDS,
} from "@/lib/console-notification-links";

describe("consoleNotificationHref", () => {
  it("sends a submitted item to its own console editor", () => {
    expect(consoleNotificationHref("story_submitted", { story_id: "s1" })).toBe("/console/stories/s1");
    expect(consoleNotificationHref("video_submitted", { video_id: "v1" })).toBe("/console/videos/v1");
    expect(consoleNotificationHref("event_submitted", { event_id: "e1" })).toBe("/console/events/e1");
    expect(consoleNotificationHref("machine_submitted", { machine_id: "m1" })).toBe("/console/machines/m1");
  });

  it("sends advert notifications to the booking, which is the approvable thing", () => {
    expect(consoleNotificationHref("advert_submitted", { booking_id: "b1" })).toBe("/console/adverts/b1");
    expect(consoleNotificationHref("advert_ending", { booking_id: "b1" })).toBe("/console/adverts/b1");
  });

  it("sends every membership-lifecycle notification to that member's record", () => {
    // page_edit_submitted: a live page's edit is approved on that record too (GAPS A1.12)
    for (const kind of ["signup_started", "payment_taken", "page_submitted", "page_edit_submitted", "payment_failed", "subscription_ended", "comp_expired", "membership_lapsed"]) {
      expect(consoleNotificationHref(kind, { member_id: "mem1" }), kind).toBe("/console/members/mem1");
    }
  });

  // Unlike the member side, a missing id is not a reason to drop the link: the
  // console list pages are real and will contain the item. A notification you
  // cannot click is the thing this whole change exists to fix.
  it("falls back to the list page rather than dropping the link", () => {
    expect(consoleNotificationHref("story_submitted", {})).toBe("/console/stories");
    expect(consoleNotificationHref("video_submitted", {})).toBe("/console/videos");
    expect(consoleNotificationHref("event_submitted", {})).toBe("/console/events");
    expect(consoleNotificationHref("machine_submitted", {})).toBe("/console/machines");
    expect(consoleNotificationHref("advert_submitted", {})).toBe("/console/adverts");
    expect(consoleNotificationHref("signup_started", {})).toBe("/console/members");
  });

  // There is no per-proposal console route; the whole queue is one page.
  it("sends an artwork swap to the artwork queue", () => {
    expect(consoleNotificationHref("artwork_submitted", { advert_id: "a1" })).toBe("/console/adverts/artwork");
  });

  // A message's action is the reply form. A link next to it would compete with
  // the one thing the operator is supposed to do.
  it("gives a message no destination", () => {
    for (const kind of INBOX_MESSAGE_KINDS) {
      expect(consoleNotificationHref(kind, { member_id: "mem1" }), kind).toBeNull();
    }
  });

  it("never invents a link for an unknown kind", () => {
    expect(consoleNotificationHref("something_new", { story_id: "s1" })).toBeNull();
  });

  // The map is keyed by hand, so a kind added to the database's check
  // constraint and mirrored into INBOX_NOTIFICATION_KINDS without a case here
  // would silently lose its link — the exact failure this file exists to catch.
  // Modelled on tests/unit/notification-links.test.ts.
  const NO_LINK = new Set<string>([]);
  it("every registered notification kind is either linked or deliberately not", () => {
    const payload = { member_id: "mem1", story_id: "s1", video_id: "v1", event_id: "e1", machine_id: "m1", booking_id: "b1" };
    for (const kind of INBOX_NOTIFICATION_KINDS) {
      const href = consoleNotificationHref(kind, payload);
      if (NO_LINK.has(kind)) expect(href, kind).toBeNull();
      else expect(href, kind).toBeTruthy();
    }
  });
});

describe("inboxKindLabel", () => {
  it("gives every kind in both vocabularies a human label", () => {
    for (const kind of [...INBOX_MESSAGE_KINDS, ...INBOX_NOTIFICATION_KINDS]) {
      const label = inboxKindLabel(kind);
      expect(label, kind).not.toBe(kind); // a raw database value is not English
      expect(label, kind).toMatch(/^[A-Z]/);
    }
  });

  it("passes an unknown kind through rather than rendering nothing", () => {
    expect(inboxKindLabel("something_new")).toBe("something_new");
  });
});

describe("replySubjectFor", () => {
  // The old line interpolated the raw kind: "Re: your membership enquiry to
  // Sheet Metal Industries" for a member asking about their own invoice.
  it("reads as English for each message kind", () => {
    expect(replySubjectFor("contact")).toBe("Re: your enquiry to Sheet Metal Industries");
    expect(replySubjectFor("advertising")).toBe("Re: your advertising enquiry to Sheet Metal Industries");
    expect(replySubjectFor("membership")).toBe("Re: your message to Sheet Metal Industries");
  });

  it("never leaks a raw kind into a subject line", () => {
    for (const kind of INBOX_NOTIFICATION_KINDS) {
      expect(replySubjectFor(kind), kind).toBe("Re: your message to Sheet Metal Industries");
    }
  });
});

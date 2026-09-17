import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_KINDS,
  isNotificationKind,
  notificationLabel,
  renderNotification,
} from "@/lib/email/templates";

/**
 * The ternary this replaced let `machine_live` and `machine_rejected` sit for a
 * while silently falling through to "Update from SMI" — enqueued long before
 * anyone noticed they had no subject. The exhaustiveness test below is the
 * point of the whole module.
 */

describe("notification coverage", () => {
  it.each(NOTIFICATION_KINDS)("%s has its own subject and body", (kind) => {
    const mail = renderNotification({ kind });
    expect(mail.subject).not.toBe("Update from SMI");
    expect(mail.subject.length).toBeGreaterThan(0);
    expect(mail.text.trim().length).toBeGreaterThan(0);
    expect(mail.html).toContain("<html");
  });

  it.each(NOTIFICATION_KINDS)("%s has a human label for the in-app feed", (kind) => {
    // GAPS A4.10: members were shown the raw enum, e.g. "advert_scheduled".
    expect(notificationLabel(kind)).not.toBe("Update from SMI");
    expect(notificationLabel(kind)).not.toContain("_");
  });

  it("still produces a usable email for an unknown kind", () => {
    const mail = renderNotification({ kind: "something_new" });
    expect(mail.subject).toBe("Update from SMI");
    expect(mail.text).toContain("member area");
  });

  it("recognises only real kinds", () => {
    expect(isNotificationKind("advert_live")).toBe(true);
    expect(isNotificationKind("nope")).toBe(false);
  });
});

describe("payload interpolation", () => {
  it("carries the admin's reason into a rejection", () => {
    const mail = renderNotification({ kind: "story_rejected", reason: "Please add a photo." });
    expect(mail.text).toContain("Please add a photo.");
    expect(mail.html).toContain("Please add a photo.");
  });

  it("names the end date on an ending-soon warning", () => {
    const mail = renderNotification({ kind: "advert_ending_soon", ends_on: "2026-09-30" });
    expect(mail.text).toContain("2026-09-30");
  });

  it("deep-links to the booking so 'renew' is actually followable", () => {
    // GAPS A2.5: the renewal form is not reachable from the dashboard, so the
    // old "log in to your member area to renew it" was advice with no path.
    const mail = renderNotification({ kind: "advert_ending_soon", booking_id: "abc-123", ends_on: "2026-09-30" });
    expect(mail.text).toContain("/dashboard/advert/abc-123");
    expect(mail.html).toContain("/dashboard/advert/abc-123");
  });

  it("falls back to the dashboard when there is no booking id", () => {
    const mail = renderNotification({ kind: "advert_ended" });
    expect(mail.text).toContain("/dashboard");
    expect(mail.text).not.toContain("/dashboard/advert/undefined");
  });

  it("includes the amount and reference on a receipt", () => {
    const mail = renderNotification({ kind: "payment_receipt", amount: "£40.00", invoice_ref: "INV-2026-014" });
    expect(mail.text).toContain("£40.00");
    expect(mail.text).toContain("INV-2026-014");
  });

  it("omits the reference line when there isn't one", () => {
    const mail = renderNotification({ kind: "payment_receipt", amount: "£40.00" });
    expect(mail.text).not.toContain("Your reference is");
  });
});

describe("html safety", () => {
  it("escapes admin-entered free text", () => {
    // `reason` is typed by an admin in the console and lands in the HTML body.
    const mail = renderNotification({ kind: "advert_changes_needed", reason: '<script>alert("x")</script>' });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("keeps brand orange off body text", () => {
    // globals.css: brand on paper is 3.3:1 and fails AA. It may only appear on
    // the dark header or as a CTA fill behind ink.
    const mail = renderNotification({ kind: "page_live" });
    expect(mail.html).not.toMatch(/<p[^>]*color:#fe5000/);
  });
});

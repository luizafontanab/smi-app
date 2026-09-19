import { describe, expect, it } from "vitest";
import {
  ADMIN_EMAIL_KINDS,
  NOTIFICATION_KINDS,
  type EmailTemplateMap,
  isNotificationKind,
  notificationLabel,
  renderAdminEmail,
  renderNotification,
  sampleVarsFor,
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

  it.each(NOTIFICATION_KINDS)("keeps brand orange off %s's body text", (kind) => {
    // globals.css: brand on paper is 3.3:1 and fails AA. It may only appear on
    // the dark header or as a CTA fill behind ink.
    //
    // This guarded #fe5000 until 18 Sep 2026 — a hex the app stopped using, so
    // it could never fail. It now names the brand orange that is actually in
    // globals.css and templates.ts, and covers every kind rather than one,
    // because these defaults are the only templates a test can still police:
    // the console can author HTML that no check here will ever see.
    const mail = renderNotification({ kind });
    expect(mail.html).not.toMatch(/<p[^>]*color:#ff8200/i);
  });
});

/**
 * The console stores only the fields an admin actually changed. The property
 * that matters is the one a full-row override would quietly destroy: a subject
 * edit must not freeze the body, or a copy fix shipped in code stops reaching
 * every template anyone has ever touched.
 */
describe("admin overrides", () => {
  const overrides = (map: EmailTemplateMap) => map;

  it("takes an edited subject and leaves the rest on the shipped default", () => {
    const stock = renderNotification({ kind: "page_live" });
    const mail = renderNotification(
      { kind: "page_live" },
      overrides({ page_live: { subject: "Your page is up" } }),
    );
    expect(mail.subject).toBe("Your page is up");
    expect(mail.text).toBe(stock.text);
    expect(mail.html).toContain("member directory");
  });

  it("takes an edited body and still interpolates the payload into it", () => {
    const mail = renderNotification(
      { kind: "advert_ending_soon", ends_on: "30 September" },
      overrides({ advert_ending_soon: { body_text: "Ends {{ends_on}}. Rebook any time." } }),
    );
    expect(mail.text).toContain("Ends 30 September.");
  });

  it("edits the in-app label and the email subject from the same row", () => {
    // GAPS A4.10: one table feeds both surfaces so they cannot drift.
    const map = overrides({ story_live: { label: "Story published", subject: "Story published" } });
    expect(notificationLabel("story_live", map)).toBe("Story published");
    expect(renderNotification({ kind: "story_live" }, map).subject).toBe("Story published");
  });

  it("ignores a null field rather than blanking the default", () => {
    const stock = renderNotification({ kind: "welcome" });
    const mail = renderNotification({ kind: "welcome" }, overrides({ welcome: { subject: null, body_html: null } }));
    expect(mail.subject).toBe(stock.subject);
    expect(mail.html).toBe(stock.html);
  });

  it("escapes a member's words into an edited body, so authored HTML can't be injected through the payload", () => {
    const mail = renderNotification(
      { kind: "story_rejected", reason: '<img src=x onerror="alert(1)">' },
      overrides({ story_rejected: { body_html: "<div>{{reason}}</div>" } }),
    );
    expect(mail.html).toContain("&lt;img");
    expect(mail.html).not.toContain("<img");
  });

  it("wraps every email in an edited shell", () => {
    const mail = renderNotification(
      { kind: "page_live" },
      overrides({ _shell: { body_html: "<html><body><main>{{body}}</main></body></html>" } }),
    );
    expect(mail.html).toContain("<main>");
    expect(mail.html).toContain("member directory");
    expect(mail.html).not.toContain("Sheet Metal <span");
  });

  it("leaves the button's destination alone when only its label is edited", () => {
    // An editable href on account_created would be a credential-redirect primitive.
    const mail = renderNotification(
      { kind: "account_created", action_link: "https://smi.test/set?token=abc" },
      overrides({ account_created: { cta_label: "Set your password" } }),
    );
    expect(mail.text).toContain("Set your password: https://smi.test/set?token=abc");
  });
});

/**
 * The same exhaustiveness guarantee the member kinds get. `machine_live` once
 * sat for weeks silently sending "Update from SMI" because nothing checked, and
 * an admin kind with no copy would fail the same way — quietly, to the one
 * person who would assume the feature simply wasn't finished.
 */
describe("admin email coverage", () => {
  it.each(ADMIN_EMAIL_KINDS)("%s has its own subject and body", (kind) => {
    const mail = renderAdminEmail(kind, sampleVarsFor(kind));
    expect(mail.subject.trim().length).toBeGreaterThan(0);
    expect(mail.text.trim().length).toBeGreaterThan(0);
    expect(mail.subject).not.toContain("{{");
  });

  it.each(ADMIN_EMAIL_KINDS)("%s stays plain text until someone writes HTML for it", (kind) => {
    // These have always been text-only. Turning Jas's inbox into branded HTML
    // is a question in docs/ask-jas.md, not something this change decides.
    expect(renderAdminEmail(kind, sampleVarsFor(kind)).html).toBeUndefined();
  });

  it("sends HTML once there is some, without the member shell around it", () => {
    // The member shell's footer says "you have a member account", which is not
    // true of the person reading these.
    const mail = renderAdminEmail(
      "admin_digest",
      { total: "3", total_s: "s", lines: "  3 — Stories", console_url: "https://smi.test/console" },
      { admin_digest: { body_html: "<p>{{total}} waiting</p>" } },
    );
    expect(mail.html).toBe("<p>3 waiting</p>");
    expect(mail.html).not.toContain("member account");
  });

  it("keeps the digest's generated lines as markup rather than escaping them", () => {
    const mail = renderAdminEmail(
      "admin_digest",
      { total: "3", total_s: "s", lines: "  3 — Stories awaiting approval", console_url: "https://smi.test/console" },
    );
    expect(mail.subject).toBe("SMI — 3 items waiting for you");
    expect(mail.text).toContain("3 — Stories awaiting approval");
  });
});

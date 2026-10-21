import { describe, expect, it } from "vitest";
import {
  ADMIN_EMAIL_KINDS,
  EDITABLE_KINDS,
  NOTIFICATION_KINDS,
  type EmailTemplateMap,
  allowedTokensFor,
  isNotificationKind,
  newsletterTemplateProblem,
  notificationLabel,
  renderAdminEmail,
  renderNotification,
  renderPreview,
  renderReply,
  sampleVarsFor,
  validateEmailTemplate,
} from "@/lib/email/templates";
import { EMAIL_DEFAULTS, NEWSLETTER_SHELL_KIND, REPLY_KIND } from "@/lib/email/defaults";

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

  // Review finding 11: with no booking the button opened billing but still
  // read "View this advert run".
  it("labels an advert receipt's button for where it actually goes", () => {
    const withBooking = renderNotification({ kind: "advert_payment_received", booking_id: "abc-123", amount: "£650.00" });
    expect(withBooking.text).toContain("/dashboard/advert/abc-123");
    expect(withBooking.text).toContain("View this advert run");

    const bundle = renderNotification({ kind: "advert_payment_received", amount: "£650.00" });
    expect(bundle.text).toContain("/dashboard/settings/billing");
    expect(bundle.text).not.toContain("View this advert run");
    expect(bundle.html).not.toContain("View this advert run");
    expect(bundle.text).toContain("Open your member area");
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

/**
 * GAPS B3.4: the one member-facing email that did not render inside the branded
 * shell. `replyToInboxMessage` sent `{ to, subject, text }` and nothing else, so
 * an answer from Jas arrived as a bare block of text while every other email the
 * site sends is wrapped, headed and footed.
 *
 * The body is a `<textarea>`, which makes the escaping here the load-bearing
 * part: it carries whatever Jas typed, quoted lines of the sender's own email
 * included.
 */
describe("reply to an inbox enquiry", () => {
  const reply = (over: Partial<Parameters<typeof renderReply>[0]> = {}, overrides?: EmailTemplateMap) =>
    renderReply({ name: "Dave Whitworth", subject: "Re: Advertising enquiry", body: "Happy to help.", ...over }, overrides);

  it("renders inside the same branded shell as every other member email", () => {
    const mail = reply();
    expect(mail.html).toContain("<html");
    // The shell's chrome, not a bare block of text.
    expect(mail.html).toContain("Sheet Metal <span");
    expect(mail.html).toContain("Happy to help.");
    expect(mail.text).toContain("Happy to help.");
  });

  it("sends under the subject line that was typed on the form", () => {
    expect(reply({ subject: "Re: Your banner dates" }).subject).toBe("Re: Your banner dates");
  });

  it("greets the sender by name", () => {
    expect(reply().text).toContain("Hi Dave Whitworth,");
  });

  it("falls back to a greeting that reads when the message carried no name", () => {
    const mail = reply({ name: "" });
    expect(mail.text).toContain("Hi there,");
    expect(mail.text).not.toContain("Hi ,");
  });

  it("has no button, because a reply has nothing to press", () => {
    const mail = reply();
    expect(mail.html).not.toContain("Open your member area");
    expect(mail.text).not.toContain("Open your member area");
    // ctaMarkup's only fingerprint: the brand-orange filled cell.
    expect(mail.html).not.toContain("background:#ff8200");
  });

  it("keeps the typed line breaks in both halves", () => {
    const mail = reply({ body: "First line.\nSecond line.\n\nNew paragraph." });
    expect(mail.html).toContain("First line.<br>Second line.");
    expect(mail.text).toContain("First line.\nSecond line.");
    // The sentinel that carries a break through the escaping must never survive.
    expect(mail.html).not.toContain("\u0000");
    expect(mail.text).not.toContain("\u0000");
  });

  it("normalises Windows line endings rather than leaving stray carriage returns", () => {
    const mail = reply({ body: "First line.\r\nSecond line." });
    expect(mail.html).toContain("First line.<br>Second line.");
    expect(mail.text).not.toContain("\r");
  });

  /* ---------- the part that matters ---------- */

  it("escapes markup typed into the reply box instead of sending it as markup", () => {
    // An unescaped free-text field rendered into an outbound email is an
    // injection into someone else's inbox.
    const mail = reply({ body: '<script>alert("x")</script> and <b>bold</b>' });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<b>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    // The text half is not markup, so it carries exactly what was typed.
    expect(mail.text).toContain('<script>alert("x")</script>');
  });

  it("escapes an angle bracket a person typed by accident", () => {
    const mail = reply({ body: "Cutting at <3mm is fine." });
    expect(mail.html).toContain("Cutting at &lt;3mm is fine.");
  });

  it("escapes the name and the subject too", () => {
    const mail = reply({ name: "<img src=x onerror=alert(1)>", subject: "<b>Re: hello</b>" });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
    expect(mail.html).not.toContain("<b>Re: hello</b>");
    // The subject is a mail header, so it is not escaped there — only where the
    // shell drops it into the page.
    expect(mail.subject).toBe("<b>Re: hello</b>");
  });

  it("still escapes the body when the template itself has been edited", () => {
    const mail = reply(
      { body: '<img src=x onerror="alert(1)">' },
      { [REPLY_KIND]: { body_html: "<div>{{body}}</div>" } },
    );
    expect(mail.html).toContain("<div>");
    expect(mail.html).toContain("&lt;img");
    expect(mail.html).not.toContain("<img");
  });

  it("does not let a typed NUL fake a line break", () => {
    const mail = reply({ body: "one\u0000two" });
    expect(mail.html).toContain("onetwo");
    expect(mail.html).not.toContain("one<br>two");
  });

  /* ---------- the console side ---------- */

  it("is editable in the console, in a family its list page already shows", () => {
    expect(EDITABLE_KINDS).toContain(REPLY_KIND);
    // /console/email-templates only renders member | admin | shell | newsletter,
    // and email_templates.family is a checked column with the same four values.
    expect(EMAIL_DEFAULTS[REPLY_KIND].family).toBe("member");
  });

  it("offers the placeholders a reply actually has", () => {
    expect(allowedTokensFor(REPLY_KIND).sort()).toEqual(["body", "name", "subject"]);
  });

  it("previews as a finished reply rather than a page of braces", () => {
    const preview = renderPreview(REPLY_KIND);
    expect(preview.subject).not.toContain("{{");
    expect(preview.html).not.toContain("{{");
    expect(preview.html).toContain("<html");
    // The sample body is two paragraphs, so the preview proves the breaks land.
    expect(preview.html).toContain("<br>");
  });

  it("previews what is stored, so an edit can be checked before it is used", () => {
    const preview = renderPreview(REPLY_KIND, { [REPLY_KIND]: { subject: "SMI — {{subject}}" } });
    expect(preview.subject).toBe("SMI — Re: Advertising enquiry");
  });

  it("accepts an edit that uses its own placeholders", () => {
    expect(validateEmailTemplate(REPLY_KIND, { body_text: "Hello {{name}}\n\n{{body}}" })).toBeNull();
  });

  it("refuses a placeholder this email doesn't have, naming it", () => {
    const error = validateEmailTemplate(REPLY_KIND, { body_text: "Hello {{first_name}}\n\n{{body}}" });
    expect(error).toContain("{{first_name}}");
  });

  it("refuses an edit that drops the reply itself", () => {
    // Without {{body}} the email goes out as a greeting and a sign-off, and Jas
    // is told it sent.
    expect(validateEmailTemplate(REPLY_KIND, { body_html: "<p>Hi {{name}},</p>" })).toContain("{{body}}");
  });

  // Save-time validation can't reach an edit stored before a token became
  // required, so the stored wrapper is checked again on the way out.
  describe("newsletterTemplateProblem", () => {
    it("is null with no edit, or an edit that keeps every required placeholder", () => {
      expect(newsletterTemplateProblem(undefined)).toBeNull();
      expect(newsletterTemplateProblem({})).toBeNull();
      const reworded = EMAIL_DEFAULTS[NEWSLETTER_SHELL_KIND].bodyHtml.replace("Update your details", "Change your details");
      expect(newsletterTemplateProblem({ [NEWSLETTER_SHELL_KIND]: { body_html: reworded } })).toBeNull();
    });

    it("names the footer placeholders an older edit leaves out, per version — the shipped text body doesn't cover an HTML edit", () => {
      const problem = newsletterTemplateProblem({ [NEWSLETTER_SHELL_KIND]: { body_html: '<p>{{items}}</p><a href="{{unsubscribe_url}}">Unsubscribe</a>' } });
      expect(problem).toContain("needs fixing before this issue can send");
      expect(problem).toContain("The HTML body is missing {{postal_address}}, {{reason_line}}.");

      const textOnly = newsletterTemplateProblem({ [NEWSLETTER_SHELL_KIND]: { body_text: "{{items_text}}\n\nUnsubscribe: {{unsubscribe_url}}" } });
      expect(textOnly).toContain("The plain-text body is missing {{postal_address}}, {{reason_line}}.");
    });

    it("reports a placeholder the newsletter doesn't have, as a save would", () => {
      expect(newsletterTemplateProblem({ [NEWSLETTER_SHELL_KIND]: { body_text: "{{items_text}} {{reason_line}} {{postal_address}} {{unsubscribe_url}} {{ends_onn}}" } }))
        .toContain("{{ends_onn}}");
    });
  });

  it("is not one of the emails that go TO Jas", () => {
    // Same prefix, opposite direction: these are plain text and skip the member
    // shell, and a reply must do neither.
    expect(ADMIN_EMAIL_KINDS as readonly string[]).not.toContain(REPLY_KIND);
    expect(isNotificationKind(REPLY_KIND)).toBe(false);
  });
});


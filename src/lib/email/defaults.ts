/**
 * The shipped copy for every email the site sends, as editable templates.
 *
 * This is the "default" half of a default-plus-override pair, the same shape as
 * `blocks/defaults.ts` behind `page_layouts`: the console stores only the fields
 * an admin has actually changed, and everything else keeps falling through to
 * here. So a copy fix shipped in code still reaches production for any template
 * nobody has touched.
 *
 * A total `Record` over the kind union is what makes a new kind without copy a
 * type error. The module this came from claimed that in its header and did not
 * have it: `copyFor(kind: string)` was a `switch` with a `default:` branch, so
 * `machine_live` and `machine_rejected` once sat for a while silently sending
 * "Update from SMI". The Record below is the promise actually kept.
 *
 * Colour rules come from `app/globals.css` and are not negotiable *here*: brand
 * orange on paper measures 3.3:1 and FAILS AA, so it never carries body text —
 * orange appears only on the near-black chrome (5.5:1) or as a CTA fill behind
 * ink (4.7:1, the documented pairing). Note that an admin editing a template in
 * the console can break that rule and no code can stop them; these defaults are
 * what the contrast test guards, and what "Reset to default" restores.
 */

import type { AdminEmailKind, NotificationKind } from "./templates";

export type EmailFamily = "member" | "admin" | "shell" | "newsletter";

export type TokenSpec = {
  /** Written `{{token}}` in the template. */
  token: string;
  /** Shown beside the field in the console. */
  description: string;
  /** Stands in for the real value in the console preview and in save-time validation. */
  sample: string;
  /** Substituted without HTML-escaping. Structural tokens only — never anything a member typed. */
  raw?: boolean;
};

export type TemplateDefault = {
  family: EmailFamily;
  subject: string;
  /** The in-app notification feed's short label. Member kinds only — nothing else has a feed entry. */
  label?: string;
  bodyHtml: string;
  bodyText: string;
  /** The button's words. Its destination is computed in code and is never editable. */
  ctaLabel?: string;
  tokens: readonly TokenSpec[];
  /** Tokens the template cannot function without; checked on save. */
  required?: readonly string[];
};

/** Reserved keys for the two templates that are wrappers rather than messages. */
export const SHELL_KIND = "_shell";
export const NEWSLETTER_SHELL_KIND = "_newsletter_shell";

/**
 * The wrapper around a typed reply to an inbox enquiry.
 *
 * Named `admin_reply` because an admin writes it, but it is **not** an
 * `AdminEmailKind`: those go *to* Jas and are plain text. This one goes *from*
 * him to whoever wrote in, so it is `family: "member"` and renders inside the
 * member shell like every other outgoing email. Family is also a checked column
 * (`email_templates.family in ('member','admin','shell','newsletter')`), so a
 * fifth family here would need a migration — see the note on the token list.
 */
export const REPLY_KIND = "admin_reply";

/** The copy an unrecognised kind falls back to. `jobs.ts` can enqueue one, so this is reachable. */
export const GENERIC_KIND = "_generic";

const INK = "#111418";
const GRAPHITE = "#5a6068";
const BRAND = "#ff8200";
const CHROME = "#0b0d10";
const LINE = "#e4e6e9";

/**
 * One body paragraph, carrying the inline styles verbatim.
 *
 * These styles used to be applied by the renderer, which wrapped every
 * paragraph as it went. Now that the body is authored markup the renderer can't
 * do that any more, so the styles live in the copy — and an unedited email has
 * to come out byte-for-byte as it did before. Check it in Mailpit, not in tests:
 * losing the inline styles breaks nothing a test can see and everything an
 * inbox can.
 */
const para = (text: string) =>
  `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${INK};">${text}</p>`;

/**
 * The button's words when an email has no more specific destination — and the
 * words it falls back to when a payload turns up without the id its real
 * destination needed. Not editable for that second case: a label promising "this
 * advert run" above a link to the member area is worse than a generic one.
 */
export const DASHBOARD_CTA = "Open your member area";

/* ---------- tokens shared across kinds ---------- */

const REASON: TokenSpec = {
  token: "reason",
  description: "The note you typed when you sent it back. A standing line stands in when you leave it blank.",
  sample: "The logo is too small to read at mobile size.",
};

const REASON_LINE: TokenSpec = {
  token: "reason_line",
  description: "Your note, as a whole sentence. The paragraph disappears entirely when you leave it blank.",
  sample: "We'll call you on Thursday to go through the detail.",
};

/* ---------- the member-facing kinds ---------- */

type Draft = {
  family?: EmailFamily;
  subject: string;
  label?: string;
  paragraphs: string[];
  ctaLabel?: string;
  tokens?: readonly TokenSpec[];
  required?: readonly string[];
};

function make({ family = "member", subject, label, paragraphs, ctaLabel, tokens = [], required }: Draft): TemplateDefault {
  return {
    family,
    subject,
    label,
    bodyHtml: paragraphs.map(para).join(""),
    bodyText: paragraphs.join("\n\n"),
    ctaLabel,
    tokens,
    required,
  };
}

/** Approved / rejected pairs differ only in the noun, so they are built the same way. */
function approved(subject: string, label: string, sentence: string, ctaLabel = DASHBOARD_CTA): TemplateDefault {
  return make({ subject, label, paragraphs: [sentence], ctaLabel });
}

function rejected(subject: string, label: string, sentence: string, ctaLabel = DASHBOARD_CTA): TemplateDefault {
  return make({ subject, label, paragraphs: [sentence, "{{reason}}"], ctaLabel, tokens: [REASON] });
}

const BOOKING_CTA = "View this advert run";

/* ---------- the emails that come to you ---------- */

const FUNNEL_TOKENS: readonly TokenSpec[] = [
  { token: "name", description: "Who it came from — the company name where we have one.", sample: "Pennine Press Brake Services" },
  { token: "email", description: "Their email address.", sample: "ops@pennine-press.example" },
  { token: "message", description: "What they wrote.", sample: "We'd like to talk about a sitewide banner for the autumn." },
];

/**
 * Your own emails are **plain text**, and stay that way unless you put
 * something in the HTML box.
 *
 * Not an oversight: every one of these has always gone out as text, and turning
 * Jas's inbox into branded HTML is a change to his working day rather than a
 * refactor — it is a question in docs/ask-jas.md, not a decision taken here. The
 * HTML field is offered and left empty, so nothing changes until someone means
 * it to. Note these don't render inside the member shell either: its footer says
 * "you have a member account", which is not true of the person reading these.
 */
function adminEmail(subject: string, bodyText: string, tokens: readonly TokenSpec[] = []): TemplateDefault {
  return { family: "admin", subject, bodyHtml: "", bodyText, tokens };
}

const ADMIN_DEFAULTS: Record<AdminEmailKind, TemplateDefault> = {
  admin_digest: adminEmail(
    "SMI — {{total}} item{{total_s}} waiting for you",
    "{{total}} item{{total_s}} waiting in the console:\n\n{{lines}}\n\n{{console_url}}",
    [
      { token: "total", description: "How many things are waiting across every queue.", sample: "5" },
      { token: "total_s", description: "The plural \"s\" — empty when there is exactly one.", sample: "s" },
      {
        token: "lines",
        description: "The breakdown, one queue per line. Only queues with something in them appear.",
        sample: "  3 — Stories awaiting approval\n  2 — Advert bookings awaiting approval",
        raw: true,
      },
      { token: "console_url", description: "A link straight into the console.", sample: "https://sheetmetalindustries.com/console", raw: true },
    ],
  ),
  admin_contact_enquiry: adminEmail(
    "New {{enquiry_kind}} enquiry from {{name}}",
    "{{name}} <{{email}}>\n\n{{message}}",
    [
      ...FUNNEL_TOKENS,
      { token: "enquiry_kind", description: "Which form it came from — \"contact\" or \"advertising\".", sample: "advertising" },
    ],
  ),
  admin_new_signup: adminEmail(
    "New member signup: {{name}}",
    "{{name}} <{{email}}>\n\n{{message}}",
    FUNNEL_TOKENS,
  ),
  admin_member_message: adminEmail(
    "Member message from {{name}}",
    "{{name}} <{{email}}>\n\n{{message}}",
    FUNNEL_TOKENS,
  ),
  admin_change_request: adminEmail(
    "Change request from {{name}}",
    "{{name}} <{{email}}>\n\n{{message}}",
    FUNNEL_TOKENS,
  ),
};

/* ---------- the reply Jas types into the console ---------- */

/**
 * Three values, all of them typed by a person, none of them markup.
 *
 * Note what is *absent*: no `raw: true`. `{{body}}` is a free-text `<textarea>`,
 * and the one thing standing between a typo with an angle bracket — or a
 * quoted line of a member's own email — and markup in someone else's inbox is
 * that this token is escaped like any other value. Marking it raw here would
 * silently turn every reply into an HTML injection point, which is why the flag
 * is called out rather than merely omitted.
 */
const REPLY_TOKENS: readonly TokenSpec[] = [
  {
    token: "name",
    description: "Who you're replying to, as it came in on their message. Reads “there” when the message has no name on it.",
    sample: "Dave Whitworth",
  },
  {
    token: "subject",
    description: "The subject line you typed on the reply form. It is what lands in their inbox, so this template normally leaves it alone.",
    sample: "Re: Advertising enquiry",
  },
  {
    token: "body",
    description:
      "What you typed in the reply box. Your line breaks are kept. Anything that looks like HTML is sent as the characters you typed rather than as markup, so pasting a quoted email is safe.",
    sample: "Thanks for getting in touch about a sitewide banner.\n\nWe have space from the start of October — shall I pencil you in and send the artwork spec over?",
  },
];

type EmailDefaultKey =
  | NotificationKind
  | AdminEmailKind
  | typeof GENERIC_KIND
  | typeof REPLY_KIND
  | typeof SHELL_KIND
  | typeof NEWSLETTER_SHELL_KIND;

export const EMAIL_DEFAULTS: Record<EmailDefaultKey, TemplateDefault> = {
  story_live: approved(
    "Your story is live on SMI",
    // The emoji used to be hardcoded into both member surfaces, which read
    // `n.kind === "story_live" ? "Your story went live 🎉" : notificationLabel(…)`
    // and so never consulted this table at all. Left there, editing this label
    // in the console would have changed the feed nowhere and the console would
    // have been lying. Folded in here instead — same words on screen, now
    // actually editable. (The label is the in-app feed only; the subject above
    // is what the email carries.)
    "Your story went live 🎉",
    "Your story has been approved and is now published on Sheet Metal Industries.",
  ),
  // Jas 13/10 item 12: a story can feature several members. The primary gets
  // story_live above; every other member it's tagged with gets this one.
  story_featured: approved(
    "A story featuring you is live on SMI",
    "A story featuring you went live",
    "Sheet Metal Industries has published a story that features your company. It now appears on your company page and in your stats too.",
  ),
  story_rejected: rejected(
    "About your submitted story",
    "Your story needs a change",
    "We've had a look at your story and it needs a change before it can go live.",
  ),
  video_live: approved(
    "Your video is live on SMI",
    "Your video is live",
    "Your video has been approved and is now published on Sheet Metal Industries.",
  ),
  video_rejected: rejected(
    "About your submitted video",
    "Your video needs a change",
    "We've had a look at your video and it needs a change before it can go live.",
  ),
  event_published: approved(
    "Your event is live on SMI",
    "Your event is live",
    "Your event has been approved and now appears in the SMI events listing.",
  ),
  event_rejected: rejected(
    "About your submitted event",
    "Your event needs a change",
    "We've had a look at your event and it needs a change before it can be listed.",
  ),
  page_live: approved(
    "Your SMI member page is live",
    "Your member page is live",
    "Your company page has been approved and is now live in the SMI member directory.",
  ),
  page_changes_live: approved(
    "Your page changes are live",
    "Your page changes are live",
    "The edits you submitted to your company page have been approved and are now live in the member directory.",
  ),
  page_changes_rejected: rejected(
    "About your page changes",
    "Your page changes need a look",
    "We've had a look at the edits you submitted to your company page and they need a change before they can go live.",
  ),
  machine_live: approved(
    "Your featured machine is live on SMI",
    "Your featured machine is live",
    "Your featured machine has been approved and is now showing on Sheet Metal Industries.",
  ),
  machine_rejected: rejected(
    "About your featured machine",
    "Your featured machine needs a change",
    "We've had a look at your featured machine and it needs a change before it can go live.",
  ),

  advert_live: approved(
    "Your advert is now running on SMI",
    "Your advert is running",
    "Your advert run has started and your artwork is now showing on Sheet Metal Industries.",
    BOOKING_CTA,
  ),
  advert_scheduled: approved(
    "Your advert is approved and scheduled",
    "Your advert is approved and scheduled",
    "Your advert has been approved and is booked in. We'll email you again on the day it starts running.",
    BOOKING_CTA,
  ),
  // Online payment (6 Oct): an approved, priced run is held until it's paid.
  // Same two tokens as the membership receipt, so the same sentence rules apply.
  advert_payment_due: make({
    subject: "Your advert is approved — payment due",
    label: "Your advert is approved — payment due",
    paragraphs: [
      "Your advertising has been approved and is held for you. It goes live once it's paid{{amount_phrase}} — you can pay securely by card from your SMI account.",
      "{{invoice_line}}",
    ],
    ctaLabel: "Pay now",
    tokens: [
      {
        token: "amount_phrase",
        description: "Reads \" of £650.00\" when we know the amount, and nothing at all when we don't — so write it with no space before it.",
        sample: " of £650.00",
      },
      {
        token: "invoice_line",
        description: "The whole reference sentence. The paragraph disappears when there's no reference.",
        sample: "Your reference is SMI-ADV-MG3K2Q7F-4K9Z.",
      },
    ],
  }),
  advert_payment_received: make({
    subject: "Payment received — your advert is confirmed",
    label: "Advert payment received",
    paragraphs: [
      "We've received your payment{{amount_phrase}}. Thank you — your advertising is confirmed and will run on its booked dates.",
      "{{invoice_line}}",
    ],
    ctaLabel: BOOKING_CTA,
    tokens: [
      {
        token: "amount_phrase",
        description: "Reads \" of £650.00\" when we know the amount, and nothing at all when we don't — so write it with no space before it.",
        sample: " of £650.00",
      },
      {
        token: "invoice_line",
        description: "The whole reference sentence. The paragraph disappears when there's no reference.",
        sample: "Your reference is SMI-ADV-MG3K2Q7F-4K9Z.",
      },
    ],
  }),
  advert_changes_needed: rejected(
    "Your advert needs a change before it runs",
    "Your advert needs a change",
    "Your advert booking needs a change before we can schedule it.",
    BOOKING_CTA,
  ),
  advert_ending_soon: make({
    subject: "Your advert run ends soon",
    label: "Your advert run ends soon",
    paragraphs: [
      "Your advert run ends on {{ends_on}}.",
      "If you'd like to keep it running, you can rebook the same artwork for new dates from the link below.",
    ],
    ctaLabel: BOOKING_CTA,
    tokens: [
      {
        token: "ends_on",
        description: "The last day of the run. Reads \"soon\" if the booking has no end date on it.",
        sample: "30 September 2026",
      },
    ],
  }),
  advert_ended: approved(
    "Your advert run has ended",
    "Your advert run has ended",
    "Your advert run has finished. You can rebook the same artwork for new dates whenever you're ready.",
    BOOKING_CTA,
  ),
  advert_artwork_approved: approved(
    "Your new artwork is live",
    "Your new artwork is live",
    "The new artwork you sent has been approved and is now showing in place of the old version — the run's dates haven't changed.",
  ),
  advert_artwork_rejected: rejected(
    "About your artwork swap",
    "Your artwork swap needs a change",
    "We've had a look at the new artwork you sent and it needs a change before it can replace what's currently running.",
  ),

  visibility_confirmed: make({
    subject: "Your visibility request is confirmed",
    label: "Your visibility request is confirmed",
    paragraphs: [
      "Thanks — we've confirmed the extra visibility you asked about and we'll be in touch with the details.",
      "{{reason_line}}",
    ],
    ctaLabel: DASHBOARD_CTA,
    tokens: [REASON_LINE],
  }),
  visibility_declined: make({
    subject: "About your visibility request",
    label: "About your visibility request",
    paragraphs: [
      "We've looked at the extra visibility you asked about and can't take it forward right now.",
      "{{reason}}",
    ],
    ctaLabel: DASHBOARD_CTA,
    tokens: [
      {
        ...REASON,
        description: "The note you typed when you declined. Falls back to an invitation to talk it through.",
      },
    ],
  }),

  welcome: make({
    subject: "Welcome to Sheet Metal Industries",
    label: "Welcome to SMI",
    paragraphs: [
      "Thanks for joining Sheet Metal Industries — your account is ready.",
      "The next step is to build your company page. Once you submit it, we'll review it and let you know as soon as it's live in the member directory.",
    ],
    ctaLabel: DASHBOARD_CTA,
  }),
  payment_receipt: make({
    subject: "Your SMI membership receipt",
    label: "Membership payment received",
    paragraphs: [
      "We've received your membership payment{{amount_phrase}}. Thank you.",
      "{{invoice_line}}",
    ],
    ctaLabel: DASHBOARD_CTA,
    tokens: [
      {
        token: "amount_phrase",
        description: "Reads \" of £40.00\" when we know the amount, and nothing at all when we don't — so write it with no space before it.",
        sample: " of £40.00",
      },
      {
        token: "invoice_line",
        description: "The whole reference sentence. The paragraph disappears when there's no reference.",
        sample: "Your reference is INV-2026-014.",
      },
    ],
  }),
  comp_applied: make({
    subject: "Your promo code has been applied",
    label: "Your promo code has been applied",
    paragraphs: [
      "Your promo code is applied — you have {{comp_span}}SMI membership at no charge.",
      "{{comped_line}}",
      "The next step is to build your company page so we can get it live.",
    ],
    ctaLabel: DASHBOARD_CTA,
    tokens: [
      {
        token: "comp_span",
        description: "Reads \"6 months of \" when the code has a length, and nothing at all when it doesn't — so write it with no space after it.",
        sample: "6 months of ",
      },
      {
        token: "comped_line",
        description: "The whole \"covered until\" sentence. The paragraph disappears when there's no end date.",
        sample: "Your membership is covered until 31 March 2027.",
      },
    ],
  }),
  account_created: make({
    subject: "Your SMI account is ready",
    label: "Your SMI account is ready",
    paragraphs: [
      "We've set up your Sheet Metal Industries account. Use the link below to choose your own password.",
      "Once you're in, the next step is to build your company page — we'll review it and let you know when it's live in the member directory.",
      "If you weren't expecting this, you can ignore this email and nothing will change.",
    ],
    // Never the password itself: an emailed credential lives in an inbox
    // forever, whereas this link expires and only the member can use it. The
    // button's destination is generated by Supabase and is not editable here.
    ctaLabel: "Choose your password",
  }),

  membership_lapsed: make({
    subject: "Your SMI membership has lapsed",
    label: "Your membership has lapsed",
    paragraphs: [
      "Your grace period has ended and your membership is now lapsed. Your page is no longer visible in the member directory.",
      "Get in touch to reactivate — we'll pick up right where things left off.",
    ],
    ctaLabel: DASHBOARD_CTA,
  }),
  membership_cancel_requested: make({
    subject: "Your SMI membership cancellation is scheduled",
    label: "Your cancellation is scheduled",
    paragraphs: [
      "We've received your cancellation request. Your membership stays active for the rest of your current billing period, and won't renew after that.",
      "Changed your mind? Get in touch before the period ends and we'll pick up right where things left off.",
    ],
    ctaLabel: DASHBOARD_CTA,
  }),
  membership_cancelled: make({
    subject: "Your SMI membership has ended",
    label: "Your membership has ended",
    paragraphs: [
      "Your cancellation has taken effect and your membership has now ended. Your page is no longer visible in the member directory.",
      "You're welcome back any time — get in touch and we'll help you rejoin.",
    ],
    ctaLabel: DASHBOARD_CTA,
  }),

  stats_summary: make({
    subject: "Your SMI statistics summary",
    label: "Your statistics summary",
    paragraphs: [
      "Your page had {{views}} view{{views_s}} in the last 30 days.",
      "See the full breakdown, including advert performance and story reach, in your member area.",
    ],
    ctaLabel: "View your statistics",
    tokens: [
      { token: "views", description: "How many times the member's page was viewed in the last 30 days.", sample: "128" },
      { token: "views_s", description: "The plural \"s\" — empty when the count is exactly 1.", sample: "s" },
    ],
  }),
  lead_alert: make({
    subject: "New companies engaging with your page",
    label: "New companies engaging with your page",
    paragraphs: [
      "{{count}} {{companies_phrase}} engaged with your page recently.",
      "See who's interested in your member area.",
    ],
    ctaLabel: "View who's engaging",
    tokens: [
      { token: "count", description: "How many companies engaged.", sample: "4" },
      {
        token: "companies_phrase",
        description: "Reads \"companies have\", or \"company has\" when the count is exactly 1.",
        sample: "companies have",
      },
    ],
  }),

  /* ---------- the reply to an inbox enquiry ---------- */

  /**
   * Written out longhand rather than through `make()` for two reasons: the
   * sign-off wants a `<br>` in the HTML half and a newline in the text half,
   * which one shared `paragraphs` array cannot express; and there is
   * deliberately **no `ctaLabel`**. A reply has nothing to press — the answer is
   * the email — and an absent `ctaLabel` is also what hides the button field in
   * the console editor, so nobody can add one by accident.
   *
   * No `label` either: nothing writes a `notifications` row for a reply (the
   * person receiving it may not even have a member account), so an "in-app
   * wording" field here would be a box that changes nothing.
   */
  [REPLY_KIND]: {
    family: "member",
    // Whatever Jas typed on the reply form, so the thread keeps its subject.
    subject: "{{subject}}",
    bodyHtml: [para("Hi {{name}},"), para("{{body}}"), para("Thanks,<br>Sheet Metal Industries")].join(""),
    bodyText: "Hi {{name}},\n\n{{body}}\n\nThanks,\nSheet Metal Industries",
    tokens: REPLY_TOKENS,
    // An edit that drops {{body}} would send Jas's answer nowhere while telling
    // him it had gone.
    required: ["body"],
  },

  /* ---------- the catch-all ---------- */

  [GENERIC_KIND]: make({
    subject: "Update from SMI",
    label: "Update from SMI",
    // Unknown kinds still produce a sane email rather than an empty one.
    paragraphs: ["{{reason}}"],
    ctaLabel: DASHBOARD_CTA,
    tokens: [REASON],
  }),

  /* ---------- the emails that come to you ---------- */

  ...ADMIN_DEFAULTS,

  /* ---------- the wrapper every member email renders into ---------- */

  [SHELL_KIND]: {
    family: "shell",
    subject: "",
    // Table-based with inline styles — the only layout Outlook and the desktop
    // clients render predictably. Deliberately plain: one accent bar, one CTA.
    bodyHtml: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{subject}}</title></head>
<body style="margin:0;padding:0;background:#f4f5f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:6px;overflow:hidden;font-family:'League Spartan',Helvetica,Arial,sans-serif;">
        <tr><td style="background:${CHROME};padding:18px 28px;">
          <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.02em;">Sheet Metal <span style="color:${BRAND};">Industries</span></span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;color:${INK};">{{subject}}</h1>
          {{body}}
          {{cta}}
        </td></tr>
        <tr><td style="border-top:1px solid ${LINE};padding:18px 28px;">
          <p style="margin:0;font-size:13px;line-height:1.5;color:${GRAPHITE};">
            You're receiving this because you have a Sheet Metal Industries member account.<br>
            <a href="{{base}}/dashboard" style="color:${GRAPHITE};">Manage your account</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
    // The plain-text email has no wrapper today: the body and the CTA line are
    // the whole message. Leaving the token alone here keeps that true while
    // giving somewhere to add a text-side footer later.
    bodyText: "{{body}}",
    tokens: [
      { token: "subject", description: "This email's subject line.", sample: "Your advert run ends soon" },
      { token: "body", description: "The email's own paragraphs. Every email needs this.", sample: "", raw: true },
      { token: "cta", description: "The button, if this email has one.", sample: "", raw: true },
      { token: "base", description: "The site's web address, with no trailing slash.", sample: "https://sheetmetalindustries.com" },
    ],
    required: ["body"],
  },

  /* ---------- the wrapper around a newsletter issue ---------- */

  [NEWSLETTER_SHELL_KIND]: {
    family: "newsletter",
    subject: "",
    // Wider than the member shell (600px against 560px) because an issue
    // carries story cards and advert artwork rather than three paragraphs.
    //
    // The stories and adverts themselves are NOT authored here: they are built
    // in code from `newsletter_items` and `newsletter_ads`, including the
    // /visit/[id] click routing an advert needs to bill correctly (GAPS A5.4).
    // They arrive as finished markup in {{items}}, adverts already placed
    // between the stories; {{adverts}} is kept, always empty, for old edits.
    bodyHtml: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{subject}}</title>
<style>@media (max-width:520px){.smi-col{display:block!important;width:100%!important;padding:0 0 20px!important;}}</style></head>
<body style="margin:0;padding:0;background:#f4f5f6;">
  {{preheader}}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:6px;overflow:hidden;font-family:'League Spartan',Helvetica,Arial,sans-serif;">
        <tr><td style="padding:20px 28px;border-bottom:1px solid ${LINE};">{{masthead}}</td></tr>
        <tr><td style="background:${CHROME};padding:16px 28px;">
          <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:${BRAND};">SMI Monthly · Issue {{issue_number}}</p>
          <p style="margin:6px 0 0;font-size:21px;font-weight:700;color:#ffffff;">{{subject}}</p>
          <p style="margin:8px 0 0;font-size:15px;line-height:1.5;color:#ffffff;opacity:0.8;">{{intro}}</p>
        </td></tr>
        <tr><td style="padding:0 28px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">{{items}}{{adverts}}</table>
        </td></tr>
        <tr><td style="border-top:1px solid ${LINE};padding:18px 28px;">
          <p style="margin:0;font-size:13px;line-height:1.6;color:${GRAPHITE};">
            Sheet Metal Industries{{online_link}}<br>
            <a href="{{unsubscribe_url}}" style="color:${GRAPHITE};">Unsubscribe</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
    bodyText: "SMI Monthly — Issue {{issue_number}}\n{{subject}}\n{{intro}}\n\n{{items_text}}\n\nUnsubscribe: {{unsubscribe_url}}",
    tokens: [
      { token: "issue_number", description: "The issue number.", sample: "48" },
      { token: "subject", description: "The issue's subject line, as set on the issue itself.", sample: "Laser cutting, five ways" },
      { token: "intro", description: "The issue's intro. The paragraph disappears when the issue has none.", sample: "What we've been reading this month." },
      {
        token: "masthead",
        description: "The SMI logo, and the “In association with” sponsor logo when the issue has one.",
        sample: `<p style="margin:0;font-size:15px;font-weight:700;color:${INK};">Sheet Metal Industries</p>`,
        raw: true,
      },
      {
        token: "preheader",
        description: "The issue's preview text, hidden in the email and shown by the inbox under the subject. Nothing when the issue has none.",
        sample: "",
        raw: true,
      },
      {
        token: "items",
        description: "The lead story, the story cards and the adverts between them, already laid out.",
        sample: `<tr><td style="padding:16px 0;border-bottom:1px solid ${LINE};"><p style="margin:0;font-size:17px;font-weight:700;color:${INK};">Laser cutting, five ways</p><p style="margin:4px 0 0;font-size:14px;color:${GRAPHITE};">An example story, so this preview has something in it.</p></td></tr>`,
        raw: true,
      },
      {
        token: "adverts",
        description: "Always empty now: adverts are placed between the stories inside {{items}}. Kept so a template that still uses it keeps working.",
        sample: "",
        raw: true,
      },
      { token: "items_text", description: "The same stories and videos as a plain list, for the text version.", sample: "- Laser cutting, five ways\n  https://sheetmetalindustries.com/news/laser-cutting", raw: true },
      {
        token: "online_link",
        description: "“Read this issue online”, when the issue has a web page. Nothing when it doesn't.",
        sample: "",
        raw: true,
      },
      {
        // Resend swaps this for a per-recipient link at send time. Leaving it
        // out is a PECR problem, not a cosmetic one, hence the required check.
        token: "unsubscribe_url",
        description: "The unsubscribe link. Every issue must carry one — it's a legal requirement, not a preference.",
        sample: "#unsubscribe",
        raw: true,
      },
    ],
    required: ["items", "unsubscribe_url"],
  },
};

/** The CTA button's markup. Code-owned: its destination is never authored. */
export function ctaMarkup(label: string, href: string, escape: (value: string) => string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
             <tr><td style="background:${BRAND};border-radius:4px;">
               <a href="${escape(href)}" style="display:inline-block;padding:12px 22px;font-size:16px;font-weight:700;color:${INK};text-decoration:none;">${escape(label)}</a>
             </td></tr>
           </table>`;
}

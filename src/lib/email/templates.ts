/**
 * Every member-facing email in one place: subject, plain text and HTML.
 *
 * This replaces the stacked ternary that used to live inline in `lib/jobs.ts`,
 * where each new notification kind meant another branch and `machine_*` sat for
 * a while silently falling through to the generic line. A total `Record` over
 * the kind union makes that failure mode a type error instead.
 *
 * Text is the source of truth; HTML is the enhancement. Both are always sent.
 *
 * Colour rules come from `app/globals.css` and are not negotiable: brand orange
 * on paper measures 3.3:1 and FAILS AA, so it never carries body text here —
 * orange appears only on the near-black chrome (5.5:1) or as a CTA fill behind
 * ink (4.7:1, the documented pairing).
 */

import { siteUrl } from "../site-url";

export const NOTIFICATION_KINDS = [
  "story_live",
  "story_rejected",
  "video_live",
  "video_rejected",
  "event_published",
  "event_rejected",
  "page_live",
  "page_changes_live",
  "page_changes_rejected",
  "machine_live",
  "machine_rejected",
  "advert_live",
  "advert_scheduled",
  "advert_changes_needed",
  "advert_ending_soon",
  "advert_ended",
  "advert_artwork_approved",
  "advert_artwork_rejected",
  "visibility_confirmed",
  "visibility_declined",
  "welcome",
  "payment_receipt",
  "comp_applied",
  "account_created",
  "membership_lapsed",
  "membership_cancel_requested",
  "membership_cancelled",
  "stats_summary",
  "lead_alert",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationPayload = {
  kind?: string;
  reason?: string;
  ends_on?: string;
  booking_id?: string;
  amount?: string;
  invoice_ref?: string;
  months?: number;
  comped_until?: string;
  action_link?: string;
  page_views?: number;
  count?: number;
  [key: string]: unknown;
};

export function isNotificationKind(kind: string): kind is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(kind);
}

/**
 * Human label for a kind. Shared with the in-app notification feed, which used
 * to render the raw enum — a member genuinely saw "advert_scheduled" (GAPS
 * A4.10). One table now feeds both surfaces so they can't drift.
 */
const LABELS: Record<NotificationKind, string> = {
  story_live: "Your story is live",
  story_rejected: "Your story needs a change",
  video_live: "Your video is live",
  video_rejected: "Your video needs a change",
  event_published: "Your event is live",
  event_rejected: "Your event needs a change",
  page_live: "Your member page is live",
  page_changes_live: "Your page changes are live",
  page_changes_rejected: "Your page changes need a look",
  machine_live: "Your featured machine is live",
  machine_rejected: "Your featured machine needs a change",
  advert_live: "Your advert is running",
  advert_scheduled: "Your advert is approved and scheduled",
  advert_changes_needed: "Your advert needs a change",
  advert_ending_soon: "Your advert run ends soon",
  advert_ended: "Your advert run has ended",
  advert_artwork_approved: "Your new artwork is live",
  advert_artwork_rejected: "Your artwork swap needs a change",
  visibility_confirmed: "Your visibility request is confirmed",
  visibility_declined: "About your visibility request",
  welcome: "Welcome to SMI",
  payment_receipt: "Membership payment received",
  comp_applied: "Your promo code has been applied",
  account_created: "Your SMI account is ready",
  membership_lapsed: "Your membership has lapsed",
  membership_cancel_requested: "Your cancellation is scheduled",
  membership_cancelled: "Your membership has ended",
  stats_summary: "Your statistics summary",
  lead_alert: "New companies engaging with your page",
};

export function notificationLabel(kind: string): string {
  return isNotificationKind(kind) ? LABELS[kind] : "Update from SMI";
}

type Copy = {
  subject: string;
  paragraphs: string[];
  cta?: { label: string; href: string };
};

const FALLBACK = "Log in to your member area for details.";

function copyFor(kind: string, payload: NotificationPayload, base: string): Copy {
  const dashboard = { label: "Open your member area", href: `${base}/dashboard` };
  // The advert emails carry booking_id, so they can land the member directly on
  // the renewal form. That page is otherwise reachable only by bookmark (GAPS
  // A2.5) — "log in and renew" was advice a member could not actually follow.
  const booking = payload.booking_id
    ? { label: "View this advert run", href: `${base}/dashboard/advert/${payload.booking_id}` }
    : dashboard;
  const reason = payload.reason?.trim();

  switch (kind) {
    case "story_live":
      return { subject: "Your story is live on SMI", paragraphs: ["Your story has been approved and is now published on Sheet Metal Industries."], cta: dashboard };
    case "story_rejected":
      return { subject: "About your submitted story", paragraphs: ["We've had a look at your story and it needs a change before it can go live.", reason ?? FALLBACK], cta: dashboard };
    case "video_live":
      return { subject: "Your video is live on SMI", paragraphs: ["Your video has been approved and is now published on Sheet Metal Industries."], cta: dashboard };
    case "video_rejected":
      return { subject: "About your submitted video", paragraphs: ["We've had a look at your video and it needs a change before it can go live.", reason ?? FALLBACK], cta: dashboard };
    case "event_published":
      return { subject: "Your event is live on SMI", paragraphs: ["Your event has been approved and now appears in the SMI events listing."], cta: dashboard };
    case "event_rejected":
      return { subject: "About your submitted event", paragraphs: ["We've had a look at your event and it needs a change before it can be listed.", reason ?? FALLBACK], cta: dashboard };
    case "page_live":
      return { subject: "Your SMI member page is live", paragraphs: ["Your company page has been approved and is now live in the SMI member directory."], cta: dashboard };
    case "page_changes_live":
      return { subject: "Your page changes are live", paragraphs: ["The edits you submitted to your company page have been approved and are now live in the member directory."], cta: dashboard };
    case "page_changes_rejected":
      return { subject: "About your page changes", paragraphs: ["We've had a look at the edits you submitted to your company page and they need a change before they can go live.", reason ?? FALLBACK], cta: dashboard };
    case "machine_live":
      return { subject: "Your featured machine is live on SMI", paragraphs: ["Your featured machine has been approved and is now showing on Sheet Metal Industries."], cta: dashboard };
    case "machine_rejected":
      return { subject: "About your featured machine", paragraphs: ["We've had a look at your featured machine and it needs a change before it can go live.", reason ?? FALLBACK], cta: dashboard };
    case "advert_live":
      return { subject: "Your advert is now running on SMI", paragraphs: ["Your advert run has started and your artwork is now showing on Sheet Metal Industries."], cta: booking };
    case "advert_scheduled":
      return { subject: "Your advert is approved and scheduled", paragraphs: ["Your advert has been approved and is booked in. We'll email you again on the day it starts running."], cta: booking };
    case "advert_changes_needed":
      return { subject: "Your advert needs a change before it runs", paragraphs: ["Your advert booking needs a change before we can schedule it.", reason ?? FALLBACK], cta: booking };
    case "advert_ending_soon":
      return {
        subject: "Your advert run ends soon",
        paragraphs: [
          `Your advert run ends on ${payload.ends_on ?? "soon"}.`,
          "If you'd like to keep it running, you can rebook the same artwork for new dates from the link below.",
        ],
        cta: booking,
      };
    case "advert_ended":
      return { subject: "Your advert run has ended", paragraphs: ["Your advert run has finished. You can rebook the same artwork for new dates whenever you're ready."], cta: booking };
    case "advert_artwork_approved":
      return { subject: "Your new artwork is live", paragraphs: ["The new artwork you sent has been approved and is now showing in place of the old version — the run's dates haven't changed."], cta: dashboard };
    case "advert_artwork_rejected":
      return { subject: "About your artwork swap", paragraphs: ["We've had a look at the new artwork you sent and it needs a change before it can replace what's currently running.", reason ?? FALLBACK], cta: dashboard };
    case "visibility_confirmed":
      return { subject: "Your visibility request is confirmed", paragraphs: ["Thanks — we've confirmed the extra visibility you asked about and we'll be in touch with the details.", reason ?? ""].filter(Boolean), cta: dashboard };
    case "visibility_declined":
      return { subject: "About your visibility request", paragraphs: ["We've looked at the extra visibility you asked about and can't take it forward right now.", reason ?? "Do get in touch if you'd like to talk it through."], cta: dashboard };
    case "welcome":
      return {
        subject: "Welcome to Sheet Metal Industries",
        paragraphs: [
          "Thanks for joining Sheet Metal Industries — your account is ready.",
          "The next step is to build your company page. Once you submit it, we'll review it and let you know as soon as it's live in the member directory.",
        ],
        cta: dashboard,
      };
    case "payment_receipt":
      return {
        subject: "Your SMI membership receipt",
        paragraphs: [
          payload.amount ? `We've received your membership payment of ${payload.amount}. Thank you.` : "We've received your membership payment. Thank you.",
          payload.invoice_ref ? `Your reference is ${payload.invoice_ref}.` : "",
        ].filter(Boolean),
        cta: dashboard,
      };
    case "account_created":
      return {
        subject: "Your SMI account is ready",
        paragraphs: [
          "We've set up your Sheet Metal Industries account. Use the link below to choose your own password.",
          "Once you're in, the next step is to build your company page — we'll review it and let you know when it's live in the member directory.",
          "If you weren't expecting this, you can ignore this email and nothing will change.",
        ],
        // Never the password itself: an emailed credential lives in an inbox
        // forever, whereas this link expires and only the member can use it.
        cta: payload.action_link ? { label: "Choose your password", href: payload.action_link } : dashboard,
      };
    case "comp_applied": {
      const months = Number(payload.months ?? 0);
      const span = months > 0 ? `${months} month${months === 1 ? "" : "s"} of ` : "";
      return {
        subject: "Your promo code has been applied",
        paragraphs: [
          `Your promo code is applied — you have ${span}SMI membership at no charge.`,
          payload.comped_until ? `Your membership is covered until ${payload.comped_until}.` : "",
          "The next step is to build your company page so we can get it live.",
        ].filter(Boolean),
        cta: dashboard,
      };
    }
    case "membership_lapsed":
      return {
        subject: "Your SMI membership has lapsed",
        paragraphs: [
          "Your grace period has ended and your membership is now lapsed. Your page is no longer visible in the member directory.",
          "Get in touch to reactivate — we'll pick up right where things left off.",
        ],
        cta: dashboard,
      };
    case "membership_cancel_requested":
      return {
        subject: "Your SMI membership cancellation is scheduled",
        paragraphs: [
          "We've received your cancellation request. Your membership stays active for the rest of your current billing period, and won't renew after that.",
          "Changed your mind? Get in touch before the period ends and we'll pick up right where things left off.",
        ],
        cta: dashboard,
      };
    case "membership_cancelled":
      return {
        subject: "Your SMI membership has ended",
        paragraphs: [
          "Your cancellation has taken effect and your membership has now ended. Your page is no longer visible in the member directory.",
          "You're welcome back any time — get in touch and we'll help you rejoin.",
        ],
        cta: dashboard,
      };
    case "stats_summary": {
      const views = Number(payload.page_views ?? 0);
      return {
        subject: "Your SMI statistics summary",
        paragraphs: [`Your page had ${views} view${views === 1 ? "" : "s"} in the last 30 days.`, "See the full breakdown, including advert performance and story reach, in your member area."],
        cta: { label: "View your statistics", href: `${base}/dashboard/stats` },
      };
    }
    case "lead_alert": {
      const count = Number(payload.count ?? 0);
      return {
        subject: "New companies engaging with your page",
        paragraphs: [`${count} compan${count === 1 ? "y has" : "ies have"} engaged with your page recently.`, "See who's interested in your member area."],
        cta: { label: "View who's engaging", href: `${base}/dashboard/stats` },
      };
    }
    default:
      // Unknown kinds still produce a sane email rather than an empty one.
      return { subject: "Update from SMI", paragraphs: [reason ?? FALLBACK], cta: dashboard };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const INK = "#111418";
const GRAPHITE = "#5a6068";
const BRAND = "#fe5000";
const CHROME = "#0b0d10";
const LINE = "#e4e6e9";

/**
 * Table-based with inline styles — the only layout Outlook and the desktop
 * clients render predictably. Deliberately plain: one accent bar, one CTA.
 */
function layout(copy: Copy, base: string): string {
  const body = copy.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${INK};">${escapeHtml(p)}</p>`)
    .join("");

  const cta = copy.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
             <tr><td style="background:${BRAND};border-radius:4px;">
               <a href="${escapeHtml(copy.cta.href)}" style="display:inline-block;padding:12px 22px;font-size:16px;font-weight:700;color:${INK};text-decoration:none;">${escapeHtml(copy.cta.label)}</a>
             </td></tr>
           </table>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(copy.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:6px;overflow:hidden;font-family:'League Spartan',Helvetica,Arial,sans-serif;">
        <tr><td style="background:${CHROME};padding:18px 28px;">
          <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.02em;">Sheet Metal <span style="color:${BRAND};">Industries</span></span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;color:${INK};">${escapeHtml(copy.subject)}</h1>
          ${body}
          ${cta}
        </td></tr>
        <tr><td style="border-top:1px solid ${LINE};padding:18px 28px;">
          <p style="margin:0;font-size:13px;line-height:1.5;color:${GRAPHITE};">
            You're receiving this because you have a Sheet Metal Industries member account.<br>
            <a href="${escapeHtml(base)}/dashboard" style="color:${GRAPHITE};">Manage your account</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function toText(copy: Copy): string {
  const parts = [...copy.paragraphs];
  if (copy.cta) parts.push(`${copy.cta.label}: ${copy.cta.href}`);
  return parts.join("\n\n");
}

/** Render one notification into a ready-to-send email. */
export function renderNotification(payload: NotificationPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const base = siteUrl();
  const copy = copyFor(String(payload.kind ?? ""), payload, base);
  return { subject: copy.subject, text: toText(copy), html: layout(copy, base) };
}

/**
 * Renders one notification into a ready-to-send email: subject, plain text and
 * HTML.
 *
 * This is the engine only. The copy lives in `./defaults.ts` as a total
 * `Record` over the kind union — which is what makes a new kind without copy a
 * type error, the guarantee this file's header used to claim while `copyFor`
 * was a `switch (kind: string)` with a `default:` branch that quietly absorbed
 * anything missing. An admin's edits arrive as an `EmailTemplateMap` read from
 * `email_templates` and override the defaults field by field.
 *
 * Text is the source of truth; HTML is the enhancement. Both are always sent.
 *
 * **Deliberately synchronous.** Two member surfaces call `notificationLabel`
 * from inside sync JSX callbacks, and the exhaustiveness suite calls
 * `renderNotification` with no database in sight. So the overrides are passed
 * in rather than fetched here; `./store.ts` owns the one read.
 */

import { siteUrl } from "../site-url";
import {
  DASHBOARD_CTA,
  EMAIL_DEFAULTS,
  GENERIC_KIND,
  NEWSLETTER_SHELL_KIND,
  SHELL_KIND,
  type TemplateDefault,
  ctaMarkup,
} from "./defaults";
import {
  collapseBlankLines,
  dropEmptyParagraphs,
  escapeHtml,
  interpolate,
  validateTemplate,
  type TemplateVars,
} from "./render";

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

/**
 * The emails that go to Jas rather than to a member.
 *
 * Deliberately a separate union from `NOTIFICATION_KINDS`, not an addition to
 * it. `jobs.ts` writes a `notifications` row per member kind and
 * `notification-links.ts` asserts every member kind links somewhere, so an
 * admin kind in that union would imply an in-app notification that does not
 * exist and fail a test that exists to catch exactly that.
 */
export const ADMIN_EMAIL_KINDS = [
  "admin_digest",
  "admin_contact_enquiry",
  "admin_new_signup",
  "admin_member_message",
  "admin_change_request",
] as const;

export type AdminEmailKind = (typeof ADMIN_EMAIL_KINDS)[number];

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
 * One `email_templates` row. Every copy column is nullable because a row is a
 * *partial* override: changing one subject line must not freeze that kind's
 * body at whatever shipped that day, with no later code fix able to reach it.
 */
export type EmailTemplateOverride = {
  subject?: string | null;
  label?: string | null;
  body_html?: string | null;
  body_text?: string | null;
  cta_label?: string | null;
};

/** Keyed by kind. Absent keys, and null fields within a key, fall through to the defaults. */
export type EmailTemplateMap = Record<string, EmailTemplateOverride>;

const FALLBACK = "Log in to your member area for details.";

/** Unknown kinds render the catch-all rather than an empty email. `jobs.ts` can enqueue one. */
function templateKey(kind: string): string {
  return Object.hasOwn(EMAIL_DEFAULTS, kind) ? kind : GENERIC_KIND;
}

/** The shipped copy for a kind, with any admin edits merged over it field by field. */
export function resolveTemplate(kind: string, overrides?: EmailTemplateMap): TemplateDefault {
  const key = templateKey(kind);
  const base = EMAIL_DEFAULTS[key as keyof typeof EMAIL_DEFAULTS];
  const row = overrides?.[key];
  if (!row) return base;
  return {
    ...base,
    subject: row.subject ?? base.subject,
    label: row.label ?? base.label,
    bodyHtml: row.body_html ?? base.bodyHtml,
    bodyText: row.body_text ?? base.bodyText,
    ctaLabel: row.cta_label ?? base.ctaLabel,
  };
}

/**
 * Human label for a kind. Shared with the in-app notification feed, which used
 * to render the raw enum — a member genuinely saw "advert_scheduled" (GAPS
 * A4.10). One table feeds both surfaces so they can't drift.
 */
export function notificationLabel(kind: string, overrides?: EmailTemplateMap): string {
  return resolveTemplate(kind, overrides).label ?? "Update from SMI";
}

/**
 * The token values for one email, computed in code.
 *
 * Every conditional and every plural that used to sit inside a template literal
 * lives here. Optional *sentences* are whole tokens rather than values — the
 * receipt's reference line disappears completely when there is no reference, so
 * `{{invoice_line}}` is the sentence and not the number inside it.
 */
function varsFor(kind: string, payload: NotificationPayload): TemplateVars {
  const reason = payload.reason?.trim();

  switch (kind) {
    case "story_rejected":
    case "video_rejected":
    case "event_rejected":
    case "page_changes_rejected":
    case "machine_rejected":
    case "advert_changes_needed":
    case "advert_artwork_rejected":
    case GENERIC_KIND:
      return { reason: reason ?? FALLBACK };

    case "visibility_confirmed":
      return { reason_line: reason ?? "" };

    case "visibility_declined":
      return { reason: reason ?? "Do get in touch if you'd like to talk it through." };

    case "advert_ending_soon":
      return { ends_on: String(payload.ends_on ?? "soon") };

    case "payment_receipt":
      return {
        amount_phrase: payload.amount ? ` of ${payload.amount}` : "",
        invoice_line: payload.invoice_ref ? `Your reference is ${payload.invoice_ref}.` : "",
      };

    case "comp_applied": {
      const months = Number(payload.months ?? 0);
      return {
        comp_span: months > 0 ? `${months} month${months === 1 ? "" : "s"} of ` : "",
        comped_line: payload.comped_until ? `Your membership is covered until ${payload.comped_until}.` : "",
      };
    }

    case "stats_summary": {
      const views = Number(payload.page_views ?? 0);
      return { views: String(views), views_s: views === 1 ? "" : "s" };
    }

    case "lead_alert": {
      const count = Number(payload.count ?? 0);
      return { count: String(count), companies_phrase: count === 1 ? "company has" : "companies have" };
    }

    default:
      return {};
  }
}

/**
 * Where the button goes. Never editable, and never authored.
 *
 * `account_created`'s destination is a Supabase-generated password-set link —
 * an admin-editable href on that row would be a credential-redirect primitive
 * with nobody reviewing it. The advert kinds deep-link to the renewal form,
 * which is otherwise reachable only by bookmark (GAPS A2.5): "log in and renew"
 * was advice a member could not actually follow.
 *
 * `specific` is false when the payload lacked the id the real destination needs.
 * The button then falls back to the member area — and so must its label, or it
 * promises a page it isn't opening.
 */
function ctaFor(kind: string, payload: NotificationPayload, base: string): { href: string; specific: boolean } {
  const dashboard = `${base}/dashboard`;

  switch (kind) {
    case "advert_live":
    case "advert_scheduled":
    case "advert_changes_needed":
    case "advert_ending_soon":
    case "advert_ended":
      return payload.booking_id
        ? { href: `${base}/dashboard/advert/${payload.booking_id}`, specific: true }
        : { href: dashboard, specific: false };

    case "account_created": {
      const link = typeof payload.action_link === "string" ? payload.action_link.trim() : "";
      return link ? { href: link, specific: true } : { href: dashboard, specific: false };
    }

    case "stats_summary":
    case "lead_alert":
      return { href: `${base}/dashboard/stats`, specific: true };

    default:
      return { href: dashboard, specific: true };
  }
}

export type RenderedEmail = { subject: string; text: string; html: string };

/** Body, button and shell, given values that are already worked out. */
function assemble(
  kind: string,
  vars: TemplateVars,
  cta: { href: string; specific: boolean },
  base: string,
  overrides?: EmailTemplateMap,
): RenderedEmail {
  const tpl = resolveTemplate(kind, overrides);
  const raw = tpl.tokens.filter((t) => t.raw).map((t) => t.token);

  // The subject is plain text in a mail header; it only gets escaped where the
  // shell drops it into `<title>` and `<h1>` below.
  const subject = interpolate(tpl.subject, vars);

  const bodyHtml = dropEmptyParagraphs(interpolate(tpl.bodyHtml, vars, { escape: true, raw }));
  const bodyText = collapseBlankLines(interpolate(tpl.bodyText, vars));

  const ctaLabel = cta.specific ? tpl.ctaLabel : DASHBOARD_CTA;
  const label = ctaLabel ? interpolate(ctaLabel, vars) : "";
  const ctaHtml = label ? ctaMarkup(label, cta.href, escapeHtml) : "";
  const ctaText = label ? `${label}: ${cta.href}` : "";

  const shell = resolveTemplate(SHELL_KIND, overrides);
  const html = interpolate(
    shell.bodyHtml,
    { subject, body: bodyHtml, cta: ctaHtml, base },
    { escape: true, raw: ["body", "cta"] },
  );
  const text = collapseBlankLines(
    interpolate(shell.bodyText, { body: [bodyText, ctaText].filter(Boolean).join("\n\n") }),
  );

  return { subject, text, html };
}

/** Render one notification into a ready-to-send email. */
export function renderNotification(payload: NotificationPayload, overrides?: EmailTemplateMap): RenderedEmail {
  const base = siteUrl();
  const kind = templateKey(String(payload.kind ?? ""));
  return assemble(kind, varsFor(kind, payload), ctaFor(kind, payload, base), base, overrides);
}

/* ---------- what the console needs ---------- */

/** Every template an admin can edit, in the order the list page shows them. */
export const EDITABLE_KINDS: readonly string[] = Object.keys(EMAIL_DEFAULTS);

/** The tokens this template is allowed to use. */
export function allowedTokensFor(kind: string): string[] {
  return resolveTemplate(kind, undefined).tokens.map((t) => t.token);
}

/**
 * Stand-in values, so the preview shows a finished email rather than a page of
 * braces — and so a save can be rendered before it is stored.
 */
export function sampleVarsFor(kind: string): TemplateVars {
  const vars: TemplateVars = {};
  for (const spec of resolveTemplate(kind, undefined).tokens) vars[spec.token] = spec.sample;
  return vars;
}

/**
 * A payload plausible enough that every kind's button resolves to its real
 * destination rather than the degraded one — the preview should show the
 * normal case, which is the one with the ids present.
 */
function samplePayload(base: string): NotificationPayload {
  return {
    booking_id: "00000000-0000-0000-0000-000000000000",
    action_link: `${base}/reset/confirm?token=example`,
  };
}

/**
 * One of your own emails. Plain text unless somebody has written HTML for it —
 * see the note on `adminEmail` in `./defaults.ts` for why that is the default.
 */
export function renderAdminEmail(
  kind: AdminEmailKind,
  vars: TemplateVars,
  overrides?: EmailTemplateMap,
): { subject: string; text: string; html?: string } {
  const tpl = resolveTemplate(kind, overrides);
  const raw = tpl.tokens.filter((t) => t.raw).map((t) => t.token);
  const subject = interpolate(tpl.subject, vars);
  const text = collapseBlankLines(interpolate(tpl.bodyText, vars));
  const authored = tpl.bodyHtml.trim();
  if (!authored) return { subject, text };
  return { subject, text, html: dropEmptyParagraphs(interpolate(tpl.bodyHtml, vars, { escape: true, raw })) };
}

/** The wrapper around a newsletter issue. Its stories and adverts arrive as finished markup. */
export function renderNewsletterShell(
  vars: TemplateVars,
  overrides?: EmailTemplateMap,
): { html: string; text: string } {
  const tpl = resolveTemplate(NEWSLETTER_SHELL_KIND, overrides);
  const raw = tpl.tokens.filter((t) => t.raw).map((t) => t.token);
  return {
    html: dropEmptyParagraphs(interpolate(tpl.bodyHtml, vars, { escape: true, raw })),
    text: collapseBlankLines(interpolate(tpl.bodyText, vars)),
  };
}

/** A text-only email still needs something to show in the preview frame. */
function plainTextPreview(text: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f4f5f6;font-family:ui-monospace,Menlo,Consolas,monospace;">
<pre style="margin:0;white-space:pre-wrap;font-size:13px;line-height:1.6;color:#111418;">${escapeHtml(text)}</pre>
</body></html>`;
}

/** Render a template with sample values, for the console preview. */
export function renderPreview(kind: string, overrides?: EmailTemplateMap): RenderedEmail {
  const base = siteUrl();
  const key = templateKey(kind);
  const family = resolveTemplate(key, undefined).family;

  if (key === SHELL_KIND) {
    // The shell has no message of its own, so it is previewed by rendering a
    // real notification through it — which is also the only way to see whether
    // an edit has broken every member email at once.
    return renderNotification({ kind: "page_live" }, overrides);
  }

  if (family === "newsletter") {
    const issue = renderNewsletterShell(sampleVarsFor(key), overrides);
    return { subject: sampleVarsFor(key).subject ?? "", text: issue.text, html: issue.html };
  }

  if (family === "admin") {
    const mail = renderAdminEmail(key as AdminEmailKind, sampleVarsFor(key), overrides);
    return { subject: mail.subject, text: mail.text, html: mail.html ?? plainTextPreview(mail.text) };
  }

  return assemble(key, sampleVarsFor(key), ctaFor(key, samplePayload(base), base), base, overrides);
}

/** Where this template's button points, for the console to show read-only. */
export function ctaDestinationFor(kind: string): string {
  const base = siteUrl();
  return ctaFor(templateKey(kind), samplePayload(base), base).href;
}

/**
 * Checks an edit before it is stored: no unknown tokens, nothing a template
 * cannot work without left out, and it has to actually render.
 *
 * Returns a human message, or null when the edit is sound.
 */
/** The field names the console shows, so an error names what is on screen. */
const FIELD_LABELS: Record<string, string> = {
  subject: "subject line",
  label: "in-app wording",
  body_html: "HTML body",
  body_text: "plain-text body",
  cta_label: "button wording",
};

export function validateEmailTemplate(kind: string, fields: Record<string, string | null | undefined>): string | null {
  const key = templateKey(kind);
  const structural = validateTemplate({
    allowed: allowedTokensFor(key),
    required: resolveTemplate(key, undefined).required,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [FIELD_LABELS[k] ?? k, v])),
  });
  if (structural) return structural;

  const trial: EmailTemplateMap = {
    [key]: {
      subject: fields.subject ?? null,
      label: fields.label ?? null,
      body_html: fields.body_html ?? null,
      body_text: fields.body_text ?? null,
      cta_label: fields.cta_label ?? null,
    },
  };

  try {
    const mail = renderPreview(key, trial);
    if (!mail.subject.trim() && key !== SHELL_KIND) return "Give this email a subject line.";
    if (!mail.text.trim()) return "This email would go out with nothing in it. Check the body.";
  } catch (e) {
    return `That template couldn't be rendered: ${e instanceof Error ? e.message : String(e)}`;
  }

  return null;
}

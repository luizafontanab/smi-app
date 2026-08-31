import { serviceDb } from "../db/server";
import { mediaUrl } from "../db/server";
import { siteUrl } from "../site-url";

/**
 * NewsletterSender adapter (TECH-DECISIONS #7).
 *
 * The deliverability gate (MailChimp vs Resend) is CLOSED: Resend carries both
 * transactional and marketing mail. This is the marketing half — Resend
 * Broadcasts, sent to a segment of contacts mirrored from our `contacts` table.
 *
 * `contacts` stays authoritative for opt-in state. Resend is a delivery
 * mechanism we push to, never the source of truth, which is what keeps the
 * unsubscribe-permanence rule in lib/contacts.ts meaningful. Unsubscribes that
 * happen at Resend's end come back to us through /api/webhooks/resend.
 *
 * ⚠ Written against Resend's documented Broadcasts/Contacts API but never yet
 * run against a live account (no key exists — see BUILD-PLAN "sending real
 * email" is approval-gated). Resend has moved contacts from
 * /audiences/{id}/contacts to a global /contacts with segments; confirm the
 * shapes on the first real send.
 */

export type SendResult = { ok: true; recipients: number } | { ok: false; error: string };

export interface NewsletterSender {
  sendIssue(issueId: string): Promise<SendResult>;
  /** Push our contact list to the provider. No-op for the stub. */
  syncContacts(): Promise<{ pushed: number; failed: number }>;
}

/** Contacts we are allowed to mail: subscribed and never unsubscribed. */
async function subscribedContacts() {
  const { data } = await serviceDb()
    .from("contacts")
    .select("email, name")
    .eq("subscribed", true)
    .is("unsubscribed_at", null);
  return data ?? [];
}

/** Everyone we must NOT mail, so their opt-out is mirrored at the provider too. */
async function unsubscribedContacts() {
  const { data } = await serviceDb()
    .from("contacts")
    .select("email")
    .not("unsubscribed_at", "is", null);
  return data ?? [];
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Build the issue's HTML from its stories and advert slots.
 *
 * `newsletter_ads` had no reader anywhere in the app (GAPS A2.4) — a booked
 * newsletter slot rendered nowhere, which for a paid placement is a billing
 * problem as much as a rendering one. It is read here.
 */
export async function renderIssueHtml(issueId: string): Promise<{ subject: string; html: string; text: string } | null> {
  const db = serviceDb();
  const base = siteUrl();

  const { data: issue } = await db
    .from("newsletter_issues")
    .select("id, number, subject, intro, web_slug")
    .eq("id", issueId)
    .single();
  if (!issue) return null;

  const [{ data: items }, { data: ads }] = await Promise.all([
    db.from("newsletter_items").select("position, story:stories(slug, title, excerpt, cover_path)").eq("issue_id", issueId).order("position"),
    db.from("newsletter_ads").select("position, advert:adverts(name, desktop_path, mobile_path, link_url)").eq("issue_id", issueId).order("position"),
  ]);

  const stories = (items ?? []).flatMap((item) => (item.story ? [item.story] : []));
  const storyHtml = stories
    .map((story) => {
      const href = `${base}/news/${story.slug}`;
      const image = story.cover_path
        ? `<img src="${escapeHtml(mediaUrl(story.cover_path) ?? "")}" width="112" alt="" style="display:block;border-radius:4px;">`
        : "";
      return `<tr><td style="padding:12px 0;border-bottom:1px solid #e4e6e9;">
        <a href="${escapeHtml(href)}" style="text-decoration:none;color:#111418;">
          ${image}
          <p style="margin:8px 0 0;font-size:17px;font-weight:700;color:#111418;">${escapeHtml(story.title)}</p>
          ${story.excerpt ? `<p style="margin:4px 0 0;font-size:14px;color:#5a6068;">${escapeHtml(story.excerpt)}</p>` : ""}
        </a></td></tr>`;
    })
    .join("");

  const adHtml = (ads ?? [])
    .flatMap((slot) => (slot.advert ? [slot.advert] : []))
    .map((advert) => {
      // The mobile creative, not the desktop one: this column is 600px at its
      // widest and narrower than that on a phone, which is what the mobile
      // artwork is cut for. Worth confirming with Jas when the first issue with
      // a booked slot goes out.
      const image = mediaUrl(advert.mobile_path) ?? mediaUrl(advert.desktop_path);
      if (!image) return "";
      const inner = `<img src="${escapeHtml(image)}" alt="${escapeHtml(advert.name ?? "Advertisement")}" style="display:block;max-width:100%;border-radius:4px;">`;
      return `<tr><td style="padding:16px 0;">
        <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#5a6068;">Advertisement</p>
        ${advert.link_url ? `<a href="${escapeHtml(advert.link_url)}">${inner}</a>` : inner}
      </td></tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(issue.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e4e6e9;border-radius:6px;overflow:hidden;font-family:'League Spartan',Helvetica,Arial,sans-serif;">
        <tr><td style="background:#0b0d10;padding:20px 28px;">
          <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#fe5000;">SMI Monthly · Issue ${issue.number}</p>
          <p style="margin:6px 0 0;font-size:21px;font-weight:700;color:#ffffff;">${escapeHtml(issue.subject)}</p>
          ${issue.intro ? `<p style="margin:8px 0 0;font-size:15px;line-height:1.5;color:#ffffff;opacity:0.8;">${escapeHtml(issue.intro)}</p>` : ""}
        </td></tr>
        <tr><td style="padding:8px 28px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${storyHtml}${adHtml}</table>
        </td></tr>
        <tr><td style="border-top:1px solid #e4e6e9;padding:18px 28px;">
          <p style="margin:0;font-size:13px;line-height:1.6;color:#5a6068;">
            Sheet Metal Industries${issue.web_slug ? ` · <a href="${escapeHtml(base)}/newsletters/${escapeHtml(issue.web_slug)}" style="color:#5a6068;">Read this issue online</a>` : ""}<br>
            <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#5a6068;">Unsubscribe</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `SMI Monthly — Issue ${issue.number}`,
    issue.subject,
    issue.intro ?? "",
    "",
    ...stories.map((story) => `- ${story.title}\n  ${base}/news/${story.slug}`),
    "",
    "Unsubscribe: {{{RESEND_UNSUBSCRIBE_URL}}}",
  ]
    .filter((line) => line !== null)
    .join("\n");

  return { subject: issue.subject, html, text };
}

class LoggingNewsletterStub implements NewsletterSender {
  async sendIssue(issueId: string): Promise<SendResult> {
    const recipients = (await subscribedContacts()).length;
    console.log(`[newsletter] would send issue ${issueId} to ${recipients} subscribed contacts`);
    // Reports success so local development still walks the whole flow, but the
    // job records that a stub sent it — see the note in jobs.ts.
    return { ok: true, recipients };
  }

  async syncContacts(): Promise<{ pushed: number; failed: number }> {
    return { pushed: 0, failed: 0 };
  }
}

class ResendNewsletterSender implements NewsletterSender {
  constructor(
    private apiKey: string,
    private segmentId: string,
    private from: string,
  ) {}

  private async api(path: string, body: unknown): Promise<{ ok: boolean; status: number; body: string }> {
    const res = await fetch(`https://api.resend.com${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: await res.text().catch(() => "") };
  }

  /**
   * Mirror our list into Resend. A full reconcile rather than push-on-write:
   * it doubles as the initial backfill, it repairs drift from a failed push,
   * and it is one place to reason about instead of a call at every write site.
   * The newsletter is monthly, so a daily reconcile is timely enough.
   *
   * Contacts are upserted; unsubscribes are pushed as `unsubscribed: true`
   * rather than deleted, so Resend keeps suppressing them.
   */
  async syncContacts(): Promise<{ pushed: number; failed: number }> {
    const [subscribed, unsubscribed] = await Promise.all([subscribedContacts(), unsubscribedContacts()]);
    let pushed = 0;
    let failed = 0;

    const push = async (email: string, isUnsubscribed: boolean) => {
      const res = await this.api("/contacts", {
        email,
        unsubscribed: isUnsubscribed,
        segments: [this.segmentId],
      });
      // A duplicate is the expected steady state, not a failure.
      if (res.ok || res.status === 409) pushed++;
      else failed++;
    };

    for (const contact of subscribed) await push(contact.email, false);
    for (const contact of unsubscribed) await push(contact.email, true);

    return { pushed, failed };
  }

  async sendIssue(issueId: string): Promise<SendResult> {
    const content = await renderIssueHtml(issueId);
    if (!content) return { ok: false, error: "Issue not found." };

    const recipients = (await subscribedContacts()).length;
    if (!recipients) return { ok: false, error: "No subscribed contacts — nothing to send." };

    // Created with send:true so there is no window where a broadcast exists in
    // Resend but our status says otherwise.
    const created = await this.api("/broadcasts", {
      segment_id: this.segmentId,
      from: this.from,
      subject: content.subject,
      html: content.html,
      text: content.text,
      send: true,
    });
    if (!created.ok) {
      return { ok: false, error: `Resend rejected the broadcast (${created.status}): ${created.body.slice(0, 300)}` };
    }
    return { ok: true, recipients };
  }
}

export function getNewsletterSender(): NewsletterSender {
  const key = process.env.RESEND_API_KEY;
  const segmentId = process.env.RESEND_SEGMENT_ID?.trim();
  if (!key || !segmentId) {
    if (key && !segmentId) {
      console.warn("[newsletter] RESEND_API_KEY is set but RESEND_SEGMENT_ID is not — falling back to the stub.");
    }
    return new LoggingNewsletterStub();
  }
  return new ResendNewsletterSender(key, segmentId, process.env.EMAIL_FROM?.trim() || "SMI <noreply@sheetmetalindustries.com>");
}

/** True when a real provider is wired, so callers can tell a stub run apart. */
export function newsletterIsLive(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_SEGMENT_ID?.trim());
}

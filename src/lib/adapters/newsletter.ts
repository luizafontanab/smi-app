import { serviceDb } from "../db/server";
import { mediaUrl } from "../db/server";
import { siteUrl } from "../site-url";
import { EmailSendError } from "./email";

/**
 * NewsletterSender adapter (TECH-DECISIONS #7).
 *
 * The deliverability gate (MailChimp vs Resend) is still OPEN. Resend is the
 * candidate being tested, not the chosen platform: this exists so the test Jas
 * asked for can actually be run against real trade addresses. If MailChimp wins
 * on firewall penetration and open rates, it wins, and the replacement is
 * another class behind this interface — which is the whole reason the interface
 * is here. Do not collapse it into the caller.
 *
 * The mechanism is Resend Broadcasts, sent to a segment of contacts mirrored
 * from our `contacts` table.
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

export type SendResult =
  | { ok: true; recipients: number; providerBroadcastId?: string }
  | { ok: false; error: string };

export interface NewsletterSender {
  /**
   * `idempotencyKey`, when given, is passed to the provider so a retried job
   * (the job runner retrying after our own status write failed, not a
   * deliberate re-send) can't cause the same broadcast to go out twice.
   */
  sendIssue(issueId: string, idempotencyKey?: string): Promise<SendResult>;
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

/**
 * Resend swaps this for a per-recipient link at send time. Triple braces are
 * ITS syntax, not ours — `lib/email/render.ts` never matches the triple-brace
 * form precisely so this survives a pass through our own substitution.
 */
const UNSUBSCRIBE_URL = "{{{RESEND_UNSUBSCRIBE_URL}}}";

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
    db.from("newsletter_items")
      // excerpt = the story_summary computed field: the author's summary, else the body's opening
      .select("position, story:stories(slug, title, excerpt:story_summary, cover_path), video:videos(slug, title, thumbnail_path)")
      .eq("issue_id", issueId).order("position"),
    db.from("newsletter_ads").select("position, advert:adverts(id, name, desktop_path, mobile_path, link_url)").eq("issue_id", issueId).order("position"),
  ]);

  // Stories and videos are rendered in the same position order they were
  // added, rather than stories-then-videos, so the composer's picked order
  // is what a reader actually sees.
  const stories = (items ?? []).flatMap((item) => (item.story ? [item.story] : []));
  const storyHtml = (items ?? [])
    .map((item) => {
      if (item.story) {
        const story = item.story;
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
      }
      if (item.video) {
        const video = item.video;
        const href = `${base}/video/${video.slug}`;
        const image = video.thumbnail_path
          ? `<img src="${escapeHtml(mediaUrl(video.thumbnail_path) ?? "")}" width="112" alt="" style="display:block;border-radius:4px;">`
          : "";
        return `<tr><td style="padding:12px 0;border-bottom:1px solid #e4e6e9;">
        <a href="${escapeHtml(href)}" style="text-decoration:none;color:#111418;">
          ${image}
          <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#5a6068;">Video</p>
          <p style="margin:4px 0 0;font-size:17px;font-weight:700;color:#111418;">${escapeHtml(video.title)}</p>
        </a></td></tr>`;
      }
      return "";
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
      // Routed through /visit/[id] rather than the raw link_url, so a
      // newsletter ad click generates the same ad_click event a web ad slot
      // click does (A5.4/A5.7) — /visit/[id] already falls back to the
      // advertiser's own member page when there's no link_url.
      return `<tr><td style="padding:16px 0;">
        <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#5a6068;">Advertisement</p>
        <a href="${escapeHtml(`${base}/visit/${advert.id}?src=newsletter`)}">${inner}</a>
      </td></tr>`;
    })
    .join("");

  // The wrapper is editable in /console/email-templates (fix-list 63); the
  // story and advert markup above is not, because it is generated from
  // newsletter_items / newsletter_ads and carries the /visit/[id] click routing
  // a paid slot needs to bill correctly (GAPS A5.4).
  //
  // `unsubscribe_url` is Resend's own `{{{RESEND_UNSUBSCRIBE_URL}}}`, passed as
  // a value rather than left as a literal in the template: our substitution
  // deliberately never matches the triple-brace form, so a template that still
  // contains it verbatim keeps working either way.
  const [{ renderNewsletterShell }, { loadEmailTemplates }] = await Promise.all([
    import("../email/templates"),
    import("../email/store"),
  ]);
  const videos = (items ?? []).flatMap((item) => (item.video ? [item.video] : []));
  const rendered = renderNewsletterShell(
    {
      issue_number: String(issue.number),
      subject: issue.subject,
      intro: issue.intro ?? "",
      items: storyHtml,
      adverts: adHtml,
      items_text: [
        ...stories.map((story) => `- ${story.title}\n  ${base}/news/${story.slug}`),
        ...videos.map((video) => `- ${video.title}\n  ${base}/video/${video.slug}`),
      ].join("\n"),
      online_link: issue.web_slug
        ? ` · <a href="${escapeHtml(base)}/newsletters/${escapeHtml(issue.web_slug)}" style="color:#5a6068;">Read this issue online</a>`
        : "",
      unsubscribe_url: UNSUBSCRIBE_URL,
    },
    await loadEmailTemplates(),
  );

  return { subject: issue.subject, html: rendered.html, text: rendered.text };
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

  private async api(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<{ ok: boolean; status: number; body: string; retryAfterMs?: number }> {
    const res = await fetch(`https://api.resend.com${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    return {
      ok: res.ok,
      status: res.status,
      body: await res.text().catch(() => ""),
      retryAfterMs: Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : undefined,
    };
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
      if (res.ok || res.status === 409) { pushed++; return; }
      // Provider backpressure, not a bad contact — let jobs.ts's
      // rateLimitPauseMs recognise this and back off, instead of counting
      // every throttled contact toward the job's max_attempts.
      if (res.status === 429) throw new EmailSendError(`Resend rate-limited /contacts: ${res.body.slice(0, 200)}`, 429, res.retryAfterMs);
      failed++;
    };

    for (const contact of subscribed) await push(contact.email, false);
    for (const contact of unsubscribed) await push(contact.email, true);

    return { pushed, failed };
  }

  async sendIssue(issueId: string, idempotencyKey?: string): Promise<SendResult> {
    const content = await renderIssueHtml(issueId);
    if (!content) return { ok: false, error: "Issue not found." };

    const recipients = (await subscribedContacts()).length;
    if (!recipients) return { ok: false, error: "No subscribed contacts — nothing to send." };

    // Created with send:true so there is no window where a broadcast exists in
    // Resend but our status says otherwise. The idempotency key is the queue
    // job's own id (see jobs.ts) — stable across that job's own retries, but a
    // deliberate re-send from the console enqueues a new job and gets a new
    // key, so it isn't blocked from actually re-sending.
    const created = await this.api(
      "/broadcasts",
      {
        segment_id: this.segmentId,
        from: this.from,
        subject: content.subject,
        html: content.html,
        text: content.text,
        send: true,
      },
      idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    );
    if (!created.ok) {
      return { ok: false, error: `Resend rejected the broadcast (${created.status}): ${created.body.slice(0, 300)}` };
    }
    // Unverified against a live account (see file docstring) — a shape
    // mismatch here just leaves providerBroadcastId undefined, never fails
    // an already-succeeded send.
    let providerBroadcastId: string | undefined;
    try {
      const parsed = JSON.parse(created.body) as { id?: unknown };
      if (typeof parsed.id === "string") providerBroadcastId = parsed.id;
    } catch {
      // ignore — send already succeeded
    }
    return { ok: true, recipients, providerBroadcastId };
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

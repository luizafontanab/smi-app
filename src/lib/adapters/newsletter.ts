import { allRows } from "../db/all-rows";
import { logError } from "../log";
import { serviceDb } from "../db/server";
import { mediaUrl } from "../db/server";
import { siteUrl } from "../site-url";
import { diaryDate, DIARY_HEADING, DIRECTORY_HEADING, issueBlocks, splitMastheadSponsor, STORY_SECTION_HEADING } from "../newsletter-layout";
import { issueExtras } from "../newsletter-extras";
import { newsletterParams } from "../newsletter-tracking";
import { isLiveContent } from "../newsletter-picker";
import { addressLine, readNewsletterFooter } from "../newsletter-footer";
import { SMI_SOCIAL_URLS, SOCIAL_CHANNELS } from "../social";
import { EmailSendError, newsletterFrom } from "./email";

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

/**
 * Every contacts row a query matches. Paged, because PostgREST stops at
 * max_rows (1000) without saying so and the list is ~2,700; and loud, because
 * syncContacts removes from the Resend segment every address these don't
 * return — a short or failed read must never pass for "these people left".
 */
const readContacts = <T>(what: string, query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) =>
  allRows<T>(async (from, to) => {
    const { data, error } = await query(from, to);
    if (error) throw new Error(`newsletter: reading ${what}: ${error.message}`);
    return { data };
  });

/**
 * Contacts we are allowed to mail: subscribed, never unsubscribed, and not
 * hard-bounced. A bounce isn't an opt-out (gap review area 7, migration
 * 20261021000005) but its address doesn't take mail, so it's left out until
 * the address changes or an admin clears it.
 */
function subscribedContacts() {
  return readContacts<{ email: string; name: string | null }>("subscribed contacts", (from, to) =>
    serviceDb().from("contacts").select("email, name").eq("subscribed", true).is("unsubscribed_at", null).is("bounced_at", null).order("id").range(from, to),
  );
}

/** Everyone we must NOT mail, so their opt-out is mirrored at the provider too. */
function unsubscribedContacts() {
  return readContacts<{ email: string }>("unsubscribed contacts", (from, to) =>
    serviceDb().from("contacts").select("email").not("unsubscribed_at", "is", null).order("id").range(from, to),
  );
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

/** The issue's content column: the shell's 600px less its 28px gutters. */
const LEAD_IMAGE_WIDTH = 544;
/** Half the column less the 16px gap — the live issues' two-up card width. */
const CARD_IMAGE_WIDTH = 264;
/** Gap review area 5: the SOP's label for paid placements. */
const AD_LABEL = "Sponsored";

type IssueCard = { href: string; title: string; summary: string | null; image: string | null; kicker: string | null; cta: string };

/** One story or video: image, uppercase headline, summary, link — the live issues' card. */
function cardHtml(card: IssueCard, imageWidth: number, titleSize: number): string {
  const href = escapeHtml(card.href);
  const image = card.image
    ? `<a href="${href}"><img src="${escapeHtml(card.image)}" width="${imageWidth}" alt="${escapeHtml(card.title)}" style="display:block;width:100%;max-width:${imageWidth}px;height:auto;border:0;border-radius:4px;"></a>`
    : "";
  return `${image}
    ${card.kicker ? `<p style="margin:10px 0 0;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#5a6068;">${escapeHtml(card.kicker)}</p>` : ""}
    <p style="margin:10px 0 0;font-size:${titleSize}px;line-height:1.25;font-weight:700;text-transform:uppercase;color:#111418;"><a href="${href}" style="color:#111418;text-decoration:none;">${escapeHtml(card.title)}</a></p>
    ${card.summary ? `<p style="margin:6px 0 0;font-size:14px;line-height:1.5;color:#5a6068;">${escapeHtml(card.summary)}</p>` : ""}
    <p style="margin:8px 0 0;font-size:13px;font-weight:700;"><a href="${href}" style="color:#ff8200;text-decoration:none;">${escapeHtml(card.cta)} &rarr;</a></p>`;
}

/**
 * Build the issue's HTML from its stories and advert slots.
 *
 * `newsletter_ads` had no reader anywhere in the app (GAPS A2.4) — a booked
 * newsletter slot rendered nowhere, which for a paid placement is a billing
 * problem as much as a rendering one. It is read here.
 */
export async function renderIssueHtml(
  issueId: string,
  opts: {
    /**
     * Replaces Resend's per-recipient unsubscribe tag. A test send goes out as
     * a single email, not a broadcast, and Resend fills the tag in only for
     * broadcasts, so a test would otherwise show the raw `{{{…}}}` text.
     */
    unsubscribeUrl?: string;
  } = {},
): Promise<{ subject: string; html: string; text: string } | null> {
  const db = serviceDb();
  const base = siteUrl();

  const { data: issue } = await db
    .from("newsletter_issues")
    .select("id, number, subject, intro, preview_text, web_slug, scheduled_at, sent_at")
    .eq("id", issueId)
    .single();
  if (!issue) return null;

  const [{ data: items }, { data: ads }] = await Promise.all([
    db.from("newsletter_items")
      // excerpt = the story_summary computed field: the author's summary, else the body's opening
      .select("position, story:stories(slug, title, status, excerpt:story_summary, cover_path), video:videos(slug, title, status, thumbnail_path)")
      .eq("issue_id", issueId).order("position"),
    db.from("newsletter_ads")
      .select("position, after_item, advert:adverts(id, name, format, desktop_path, mobile_path, headline, body)")
      .eq("issue_id", issueId).order("position"),
  ]);

  // Stories and videos are rendered in the same position order they were
  // added, rather than stories-then-videos, so the composer's picked order
  // is what a reader actually sees.
  // Every link carries the issue, so its clicks can be counted per issue
  // (gap review area 5 slice C, lib/newsletter-tracking).
  const tracked = newsletterParams(issue.id);
  const cards = (items ?? []).flatMap((item): IssueCard[] => {
    // GAPS B5.5: an item that has left the site is never rendered. Every send
    // path also refuses while one is picked (issueItemsNotLive), so this only
    // keeps the preview showing what the list would actually get.
    if (item.story && isLiveContent(item.story.status)) {
      const s = item.story;
      return [{ href: `${base}/news/${s.slug}?${tracked}`, title: s.title, summary: s.excerpt, image: mediaUrl(s.cover_path), kicker: null, cta: "Read article" }];
    }
    if (item.video && isLiveContent(item.video.status)) {
      const v = item.video;
      return [{ href: `${base}/video/${v.slug}?${tracked}`, title: v.title, summary: null, image: mediaUrl(v.thumbnail_path), kicker: "Video", cta: "Watch video" }];
    }
    return [];
  });

  // Routed through /visit/[id] rather than the raw link_url, so a newsletter
  // ad click generates the same ad_click event a web ad slot click does
  // (A5.4/A5.7) — /visit/[id] already falls back to the advertiser's own
  // member page when there's no link_url.
  // `slot` names where the advert sat, for the SOP's utm_content: masthead,
  // sponsored, or banner-1, banner-2… in the order they appear.
  const visit = (advertId: string, slot: string) => `${base}/visit/${advertId}?${newsletterParams(issue.id, slot)}`;
  let bannerCount = 0;
  const placed = (ads ?? []).flatMap((slot) => (slot.advert ? [{ ...slot.advert, after_item: slot.after_item }] : []));
  const { sponsor, banners } = splitMastheadSponsor(placed);

  const body = issueBlocks(cards, banners)
    .map((block) => {
      switch (block.kind) {
        case "lead":
          return `<tr><td style="padding:20px 0 4px;">${cardHtml(block.item, LEAD_IMAGE_WIDTH, 22)}</td></tr>`;
        case "heading":
          return `<tr><td style="padding:20px 0 4px;border-top:3px solid #ff8200;"><p style="margin:0;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#111418;">${escapeHtml(STORY_SECTION_HEADING)}</p></td></tr>`;
        case "row":
          if (block.items.length === 1) return `<tr><td style="padding:12px 0;">${cardHtml(block.items[0], LEAD_IMAGE_WIDTH, 18)}</td></tr>`;
          return `<tr><td style="padding:12px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td class="smi-col" width="50%" valign="top" style="padding:0 8px 0 0;">${cardHtml(block.items[0], CARD_IMAGE_WIDTH, 16)}</td>
          <td class="smi-col" width="50%" valign="top" style="padding:0 0 0 8px;">${cardHtml(block.items[1], CARD_IMAGE_WIDTH, 16)}</td>
        </tr></table></td></tr>`;
        case "ad": {
          if (block.ad.format === "sponsored_story") {
            // Gap review area 5 slice B: the advertiser's own story card, one
            // 600×400 image (the desktop one) and its words, marked Sponsored.
            const image = mediaUrl(block.ad.desktop_path) ?? mediaUrl(block.ad.mobile_path);
            const card: IssueCard = { href: visit(block.ad.id, "sponsored"), title: block.ad.headline ?? block.ad.name ?? "", summary: block.ad.body, image, kicker: AD_LABEL, cta: "Read more" };
            return `<tr><td style="padding:16px;background:#f4f5f6;border-radius:4px;">${cardHtml(card, LEAD_IMAGE_WIDTH - 32, 18)}</td></tr>`;
          }
          // The mobile creative, not the desktop one: this column is 600px at
          // its widest and narrower than that on a phone, which is what the
          // mobile artwork is cut for (560×300, the size sold).
          const image = mediaUrl(block.ad.mobile_path) ?? mediaUrl(block.ad.desktop_path);
          if (!image) return "";
          return `<tr><td style="padding:16px 0;">
          <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#5a6068;">${escapeHtml(AD_LABEL)}</p>
          <a href="${escapeHtml(visit(block.ad.id, `banner-${++bannerCount}`))}"><img src="${escapeHtml(image)}" width="${LEAD_IMAGE_WIDTH}" alt="${escapeHtml(block.ad.name ?? AD_LABEL)}" style="display:block;width:100%;max-width:${LEAD_IMAGE_WIDTH}px;height:auto;border:0;border-radius:4px;"></a>
        </td></tr>`;
        }
      }
    })
    .join("");

  const [extras, footer] = await Promise.all([
    issueExtras(issue.id, issue.scheduled_at ?? issue.sent_at),
    readNewsletterFooter(db),
  ]);
  const diaryHtml = extras.events.length
    ? `<tr><td style="padding:24px 0 4px;border-top:3px solid #ff8200;"><p style="margin:0;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#111418;">${escapeHtml(DIARY_HEADING)}</p></td></tr>
      ${extras.events.map((event) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e4e6e9;">
        <p style="margin:0;font-size:12px;font-weight:700;text-transform:uppercase;color:#5a6068;">${escapeHtml(diaryDate(event.starts_on, event.ends_on))}</p>
        <p style="margin:2px 0 0;font-size:15px;font-weight:700;"><a href="${escapeHtml(`${base}/event/${event.slug}`)}" style="color:#111418;text-decoration:none;">${escapeHtml(event.title)}</a></p>
        ${event.location ? `<p style="margin:2px 0 0;font-size:13px;color:#5a6068;">${escapeHtml(event.location)}</p>` : ""}
      </td></tr>`).join("")}`
    : "";
  const directoryHtml = extras.directory.length
    ? `<tr><td style="padding:24px 0 4px;border-top:3px solid #ff8200;"><p style="margin:0;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#111418;">${escapeHtml(DIRECTORY_HEADING)}</p></td></tr>
      <tr><td style="padding:8px 0 0;font-size:14px;line-height:1.9;">${extras.directory
        .map((member) => `<a href="${escapeHtml(`${base}/member/${member.slug}`)}" style="color:#111418;text-decoration:none;font-weight:700;">${escapeHtml(member.name)}</a>`)
        .join(` <span style="color:#ff8200;">&middot;</span> `)}</td></tr>`
    : "";

  const sponsorImage = sponsor ? mediaUrl(sponsor.desktop_path) ?? mediaUrl(sponsor.mobile_path) : null;
  // PNG, not SVG: Gmail and Outlook don't render SVG. It is a 480×158 render
  // of public/logo-stacked-ink.svg (".com" in ink, for the white email body).
  // Keep the filename: issues already sent link to it.
  const masthead =`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td valign="middle"><a href="${escapeHtml(base)}"><img src="${escapeHtml(`${base}/logo-stacked.png`)}" width="160" alt="Sheet Metal Industries" style="display:block;width:160px;height:auto;border:0;"></a></td>
    ${sponsor && sponsorImage
      ? `<td valign="middle" align="right">
      <p style="margin:0 0 4px;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#5a6068;">In association with</p>
      <a href="${escapeHtml(visit(sponsor.id, "masthead"))}"><img src="${escapeHtml(sponsorImage)}" width="186" alt="${escapeHtml(sponsor.name ?? "Sponsor")}" style="display:block;width:186px;max-width:100%;height:auto;border:0;margin-left:auto;"></a>
    </td>`
      : ""}
  </tr></table>`;

  // Hidden in the body, shown by the inbox as the line under the subject. The
  // trailing spacer stops clients padding the preview with the masthead's alt
  // text and the first headline.
  const preheader = issue.preview_text?.trim()
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;">${escapeHtml(issue.preview_text.trim())}${"&#8199;&#65279;&#847; ".repeat(30)}</div>`
    : "";

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
  const rendered = renderNewsletterShell(
    {
      issue_number: String(issue.number),
      subject: issue.subject,
      intro: issue.intro ?? "",
      preheader,
      masthead,
      items: body + diaryHtml + directoryHtml,
      // The adverts are placed between the items now, so they arrive inside
      // {{items}}. The token stays, empty, so a shell edited in the console
      // before this still validates and renders.
      adverts: "",
      items_text: [
        cards.map((card) => `- ${card.title}\n  ${card.href}`).join("\n"),
        extras.events.length
          ? `${DIARY_HEADING}\n${extras.events.map((e) => `- ${diaryDate(e.starts_on, e.ends_on)}: ${e.title}\n  ${base}/event/${e.slug}`).join("\n")}`
          : "",
        extras.directory.length ? `${DIRECTORY_HEADING}\n${extras.directory.map((m) => `- ${m.name}: ${base}/member/${m.slug}`).join("\n")}` : "",
      ].filter(Boolean).join("\n\n"),
      online_link: issue.web_slug
        ? ` · <a href="${escapeHtml(base)}/newsletters/${escapeHtml(issue.web_slug)}" style="color:#5a6068;">Read this issue online</a>`
        : "",
      unsubscribe_url: opts.unsubscribeUrl ?? UNSUBSCRIBE_URL,
      base,
      // Code-owned like the site footer's (lib/social.ts), so they can't drift apart.
      social_links: SOCIAL_CHANNELS.map((c) => ` · <a href="${escapeHtml(SMI_SOCIAL_URLS[c.key])}" style="color:#5a6068;">${escapeHtml(c.label)}</a>`).join(""),
      reason_line: footer.reason_line,
      postal_address: addressLine(footer.postal_address),
    },
    await loadEmailTemplates(),
  );

  // A template edited to carry Resend's tag literally (rather than through
  // `unsubscribe_url`) would still leak it into a test send, so swap that too.
  const swap = (body: string) => (opts.unsubscribeUrl ? body.split(UNSUBSCRIBE_URL).join(opts.unsubscribeUrl) : body);
  return { subject: issue.subject, html: swap(rendered.html), text: swap(rendered.text) };
}

/**
 * GAPS B5.5: the titles of picked stories and videos that are no longer live
 * (withdrawn, unpublished, back in draft). A send refuses while there are any
 * — Luiza, 22 Oct: refuse rather than silently drop, because dropping one
 * changes the lead and moves every advert from what was proofed. Checked by
 * the send job and the console actions rather than inside a sender, so the
 * logging stub can't skip it. A deleted item has no row to name and was
 * already left out, so it doesn't count.
 */
export async function issueItemsNotLive(issueId: string): Promise<string[]> {
  const { data, error } = await serviceDb()
    .from("newsletter_items")
    .select("position, story:stories(title, status), video:videos(title, status)")
    .eq("issue_id", issueId)
    .order("position");
  if (error) throw new Error(`newsletter items for ${issueId}: ${error.message}`);
  return (data ?? []).flatMap((item) => {
    const picked = item.story ?? item.video;
    return picked && !isLiveContent(picked.status) ? [picked.title] : [];
  });
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

/**
 * Provider backpressure, not a bad contact — let jobs.ts's rateLimitPauseMs
 * recognise this and back off, instead of counting every throttled contact
 * toward the job's max_attempts.
 */
function throttled(res: { status: number; body: string; retryAfterMs?: number }, what: string) {
  if (res.status === 429) throw new EmailSendError(`Resend rate-limited ${what}: ${res.body.slice(0, 200)}`, 429, res.retryAfterMs);
}

class ResendNewsletterSender implements NewsletterSender {
  constructor(
    private apiKey: string,
    private segmentId: string,
    private from: string,
    private replyTo?: string,
  ) {}

  private async api(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
    method: "GET" | "POST" | "PATCH" | "DELETE" = "POST",
  ): Promise<{ ok: boolean; status: number; body: string; retryAfterMs?: number }> {
    const res = await fetch(`https://api.resend.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
   *
   * Then the segment is pruned: every address in it that is neither of those
   * any more is taken out (DELETE /contacts/{email}/segments/{id}). Without
   * this an address that left `contacts` stayed in the segment, subscribed,
   * for good — and broadcasts go to the segment. That is every contact whose
   * email changed (a Bigin pull or a console edit; the row now holds the new
   * address and the old one is never pushed again), every deleted contact, and
   * everyone moved to "not subscribed", which isn't an unsubscribe and so was
   * never pushed as one. Removal from the segment only: the Resend contact,
   * and any opt-out it carries, stay.
   *
   * The same listing says whether Resend has each address as unsubscribed.
   * One we have as unsubscribed that Resend still has as subscribed gets
   * PATCH /contacts/{email} { unsubscribed: true }: the push above treats a
   * 409 as done, and Resend doesn't document whether a create for an existing
   * contact updates it — so without this an unsubscribe made here might never
   * reach Resend, and the next broadcast would go to them.
   *
   * For the same reason the listing also drives the other direction: a
   * subscribed contact whose create came back 409 and who isn't in the
   * segment — pruned when they bounced or went "not subscribed", and since
   * cleared or put back — is added to it, since the create can't.
   *
   * Removals and additions count as pushes, so the job's numbers stay
   * `{ pushed, failed }`.
   */
  async syncContacts(): Promise<{ pushed: number; failed: number }> {
    const [subscribed, unsubscribed] = await Promise.all([subscribedContacts(), unsubscribedContacts()]);
    let pushed = 0;
    let failed = 0;

    // Subscribed contacts Resend already had. A create for them changes
    // nothing — in particular it doesn't put them back in the segment — so
    // the prune below adds any of them the segment is missing (hard-bounced
    // and since cleared, "not subscribed" and put back on).
    const existing = new Set<string>();
    const push = async (email: string, isUnsubscribed: boolean) => {
      const res = await this.api("/contacts", {
        email,
        unsubscribed: isUnsubscribed,
        // Resend's create-contact takes segments as objects carrying the id,
        // not bare ids (resend.com/docs/api-reference/contacts/create-contact).
        segments: [{ id: this.segmentId }],
      });
      if (res.ok) { pushed++; return; }
      // A duplicate is the expected steady state, not a failure.
      if (res.status === 409) {
        pushed++;
        if (!isUnsubscribed) existing.add(email);
        return;
      }
      throttled(res, "/contacts");
      failed++;
    };

    for (const contact of subscribed) await push(contact.email, false);
    for (const contact of unsubscribed) await push(contact.email, true);

    const pruned = await this.pruneSegment(subscribed, unsubscribed, existing);
    // couldn't list it — nothing pruned, and the job says so
    if (!pruned.listed) return { pushed, failed: failed + 1 };
    return { pushed: pushed + pruned.pushed, failed: failed + pruned.failed };
  }

  /**
   * The segment half of the reconcile: take out every address that isn't
   * mailable (left `contacts`, "not subscribed", hard-bounced), and mark our
   * unsubscribes unsubscribed at Resend where it still has them subscribed.
   * `listed` is false when the segment couldn't be read, in which case
   * nothing was touched.
   *
   * Also run on its own right before every broadcast (sendIssue), because the
   * full reconcile is daily: without it, someone who unsubscribed or bounced
   * here since the last run would still be in the segment the broadcast goes
   * to. Opt-outs made at Resend's end need nothing — Resend suppresses them.
   *
   * `readd` is the daily reconcile's other direction: subscribed contacts
   * Resend already had (their create came back 409) that the segment turns out
   * not to hold — removed by an earlier prune when they bounced or went "not
   * subscribed", and since cleared or put back — are added to it. Only the
   * reconcile passes it; the pre-send check removes and never adds, so a
   * failure there can only ever hold an issue back for the right reason.
   */
  private async pruneSegment(
    subscribed: { email: string }[],
    unsubscribed: { email: string }[],
    readd: ReadonlySet<string> = new Set(),
  ): Promise<{ pushed: number; failed: number; listed: boolean }> {
    let pushed = 0;
    let failed = 0;
    const norm = (email: string) => email.trim().toLowerCase();
    const mailable = new Set(subscribed.map((c) => norm(c.email)));
    const optedOut = new Set(unsubscribed.map((c) => norm(c.email)));
    const members = await this.segmentMembers();
    if (members === null) return { pushed, failed, listed: false };
    for (const { email, unsubscribed: offAtResend } of members) {
      if (mailable.has(norm(email))) continue;
      if (optedOut.has(norm(email))) {
        // Only an explicit true is "already suppressed there". The listing's
        // shape is unverified against a live account; if it omits the flag,
        // the PATCH is a harmless repeat, whereas skipping it would mail them.
        if (offAtResend === true) continue;
        const res = await this.api(`/contacts/${encodeURIComponent(email)}`, { unsubscribed: true }, undefined, "PATCH");
        if (res.ok) { pushed++; continue; }
        throttled(res, "unsubscribe update");
        failed++;
        continue;
      }
      const res = await this.api(`/contacts/${encodeURIComponent(email)}/segments/${encodeURIComponent(this.segmentId)}`, undefined, undefined, "DELETE");
      // 404: already gone from the segment (or from Resend) — the state we wanted
      if (res.ok || res.status === 404) { pushed++; continue; }
      throttled(res, "segment removal");
      failed++;
    }
    // The mirror of the removal above (POST where that is DELETE), and like
    // the listing, unverified against a live account: check on the first
    // real sync that a cleared bounce reaches the segment (HUMAN-TODO §3).
    const inSegment = new Set(members.map((m) => norm(m.email)));
    for (const email of readd) {
      if (inSegment.has(norm(email))) continue;
      const res = await this.api(`/contacts/${encodeURIComponent(email)}/segments/${encodeURIComponent(this.segmentId)}`, undefined, undefined, "POST");
      // 409: already in it — the state we wanted
      if (res.ok || res.status === 409) { pushed++; continue; }
      throttled(res, "segment add");
      failed++;
    }
    return { pushed, failed, listed: true };
  }

  /**
   * Everyone in the segment (GET /segments/{id}/contacts, 100 a page, `after`
   * the last id) with Resend's own unsubscribed flag, or null when a page
   * can't be read — the prune must never run off a partial list.
   */
  private async segmentMembers(): Promise<{ email: string; unsubscribed?: boolean }[] | null> {
    const members: { email: string; unsubscribed?: boolean }[] = [];
    let after: string | null = null;
    for (let page = 0; page < 1000; page++) {
      const query: string = `limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`;
      const res = await this.api(`/segments/${encodeURIComponent(this.segmentId)}/contacts?${query}`, undefined, undefined, "GET");
      if (res.status === 429) throw new EmailSendError(`Resend rate-limited the segment listing: ${res.body.slice(0, 200)}`, 429, res.retryAfterMs);
      if (!res.ok) {
        logError({ source: "adapter", area: "newsletter:segment-list", error: `listing the segment failed (${res.status}): ${res.body.slice(0, 200)}`, context: { segment_id: this.segmentId, status: res.status } });
        return null;
      }
      let parsed: { data?: { id?: string; email?: string; unsubscribed?: boolean }[]; has_more?: boolean };
      try {
        parsed = JSON.parse(res.body);
      } catch {
        return null;
      }
      const rows = parsed.data ?? [];
      for (const r of rows) if (r.email) members.push({ email: r.email, unsubscribed: r.unsubscribed });
      if (!parsed.has_more || !rows.length || !rows[rows.length - 1].id) return members;
      after = rows[rows.length - 1].id!;
    }
    return null; // 100k addresses without an end — something is wrong; prune nothing
  }

  async sendIssue(issueId: string, idempotencyKey?: string): Promise<SendResult> {
    const content = await renderIssueHtml(issueId);
    if (!content) return { ok: false, error: "Issue not found." };

    // An edited wrapper that predates a required footer token renders without
    // complaint and would send without it. Refuse instead; the issue page has
    // been saying so (lib/email/templates newsletterTemplateProblem).
    const [{ newsletterTemplateProblem }, { loadEmailTemplates }] = await Promise.all([
      import("../email/templates"),
      import("../email/store"),
    ]);
    const templateProblem = newsletterTemplateProblem(await loadEmailTemplates());
    if (templateProblem) return { ok: false, error: templateProblem };

    const [subscribed, unsubscribed] = await Promise.all([subscribedContacts(), unsubscribedContacts()]);
    const recipients = subscribed.length;
    if (!recipients) return { ok: false, error: "No subscribed contacts — nothing to send." };

    // Gap review area 7: the segment is only reconciled daily, so bring it up
    // to date with every opt-out and bounce made here since, and refuse to
    // send if that can't be done (Luiza, 21 Oct) — mailing someone who
    // unsubscribed this morning is the one failure a delayed issue is better
    // than. Before the broadcast, so a refusal leaves nothing half-sent; a
    // rate limit throws, and the job retries later.
    const pruned = await this.pruneSegment(subscribed, unsubscribed);
    if (!pruned.listed) {
      return { ok: false, error: "Couldn't read the Resend segment to remove recent unsubscribes and bounces, so nothing was sent. Try again shortly." };
    }
    if (pruned.failed) {
      return { ok: false, error: `Couldn't remove ${pruned.failed} recent unsubscribe(s) or bounce(s) from the Resend segment, so nothing was sent. Try again shortly.` };
    }

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
        ...(this.replyTo ? { reply_to: this.replyTo } : {}),
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
  return new ResendNewsletterSender(key, segmentId, newsletterFrom(), process.env.EMAIL_REPLY_TO?.trim() || undefined);
}

/** True when a real provider is wired, so callers can tell a stub run apart. */
export function newsletterIsLive(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_SEGMENT_ID?.trim());
}

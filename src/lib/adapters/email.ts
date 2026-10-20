/**
 * EmailSender adapter (TECH-DECISIONS #7): Resend in production, Supabase's
 * local Mailpit in dev — both behind this interface.
 *
 * `send()` THROWS on a provider failure. That is a deliberate reversal of the
 * original behaviour, which fired the request and never read the response: a
 * bad key or an unverified domain came back 403 and was discarded, so the app
 * looked like it was sending mail it had never sent. Resend answers an
 * unverified domain with `{"statusCode":403,"name":"validation_error"}` — the
 * exact condition that must not be silent.
 *
 * The "sending must never break a user-facing flow" guarantee still holds, but
 * it now lives at the call sites, which is where the choice belongs:
 *   - `lib/notify-admin.ts` and `(public)/actions.ts` catch — the inbox row is
 *     already written, so the enquiry is safe and the visitor still gets their
 *     acknowledgement.
 *   - `lib/jobs.ts` lets it throw — the queue retries with backoff and
 *     dead-letters into "Needs You Today", which is the visible failure we want.
 */

export type OutgoingEmail = { to: string; subject: string; text: string; html?: string };

/** `idempotencyKey`, when given, is passed to the provider so a retried job can't cause a second send. */
export type SendOptions = { idempotencyKey?: string };

export interface EmailSender {
  send(mail: OutgoingEmail, opts?: SendOptions): Promise<void>;
}

/** A non-2xx from the provider. `retryAfterMs` is set when it told us to wait. */
export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}

const DEFAULT_FROM = "SMI <noreply@sheetmetalindustries.com>";

type Address = { email: string; name?: string };

/** `"SMI <noreply@x>"` → `{ name: "SMI", email: "noreply@x" }`; a bare address passes through. */
function parseAddress(input: string): Address {
  const angled = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(input);
  if (!angled) return { email: input.trim() };
  const name = angled[1].replace(/^"|"$/g, "").trim();
  return name ? { name, email: angled[2].trim() } : { email: angled[2].trim() };
}

/** Resend's 429 carries `Retry-After` in seconds; fall back to a modest pause. */
function retryAfterMs(res: Response): number {
  const header = res.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 2000;
}

class MailpitSender implements EmailSender {
  constructor(
    private baseUrl: string,
    private from: string,
    private replyTo?: string,
  ) {}

  async send(mail: OutgoingEmail): Promise<void> {
    const from = parseAddress(this.from);
    // Mailpit's HTTP send API rather than SMTP: it keeps this adapter
    // dependency-free, matching every other adapter in this directory. Mailpit
    // has no idempotency concept, and dev-only duplicate mail is harmless.
    const res = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/api/v1/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { Email: from.email, ...(from.name ? { Name: from.name } : {}) },
        To: [{ Email: mail.to }],
        Subject: mail.subject,
        Text: mail.text,
        ...(mail.html ? { HTML: mail.html } : {}),
        ...(this.replyTo ? { ReplyTo: [{ Email: this.replyTo }] } : {}),
      }),
    });
    if (!res.ok) {
      // Dev convenience only: a stopped Mailpit must never fail a local flow,
      // so this degrades to the log line rather than throwing like Resend does.
      console.warn(`[email] mailpit rejected (${res.status}) — falling back to log`);
      console.log(`[email] to=${maskEmail(mail.to)} subject="${mail.subject}"`);
    }
  }
}

/**
 * "j…@acme.co.uk": enough to tell which mail went where while debugging,
 * without writing whole addresses into function logs (docs/GDPR.md G6).
 */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  return at > 0 ? `${address[0]}…${address.slice(at)}` : "…";
}

class ConsoleSender implements EmailSender {
  async send(mail: OutgoingEmail): Promise<void> {
    // No key and no Mailpit: notification emails are also stored in
    // `notifications`, so nothing depends on delivery here.
    console.log(`[email] to=${maskEmail(mail.to)} subject="${mail.subject}"`);
  }
}

class ResendSender implements EmailSender {
  constructor(
    private apiKey: string,
    private from: string,
    private replyTo?: string,
  ) {}

  async send(mail: OutgoingEmail, opts?: SendOptions): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        // A retried job (network blip, our own DB write failing after the send
        // succeeded) must not cause a second email — Resend dedupes repeats of
        // the same key instead of sending again.
        ...(opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: this.from,
        ...(this.replyTo ? { reply_to: this.replyTo } : {}),
        ...mail,
      }),
    });
    if (res.ok) return;

    // The body carries the actionable part ("domain is not verified"), so it
    // belongs in the error rather than a bare status code.
    const detail = await res.text().catch(() => "");
    throw new EmailSendError(
      `Resend rejected the send (${res.status}): ${detail.slice(0, 500)}`,
      res.status,
      res.status === 429 ? retryAfterMs(res) : undefined,
    );
  }
}

export function getEmailSender(): EmailSender {
  const from = process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
  const replyTo = process.env.EMAIL_REPLY_TO?.trim() || undefined;

  const key = process.env.RESEND_API_KEY;
  if (key) return new ResendSender(key, from, replyTo);

  const mailpit = process.env.MAILPIT_URL?.trim();
  return mailpit ? new MailpitSender(mailpit, from, replyTo) : new ConsoleSender();
}

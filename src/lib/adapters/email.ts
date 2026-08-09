/**
 * EmailSender adapter (TECH-DECISIONS #7): Resend in production,
 * Supabase's local Mailpit SMTP in dev — both behind this interface.
 * Sending must never throw into a user-facing flow.
 */

export type OutgoingEmail = { to: string; subject: string; text: string; html?: string };

export interface EmailSender {
  send(mail: OutgoingEmail): Promise<void>;
}

class ConsoleMailpitSender implements EmailSender {
  async send(mail: OutgoingEmail): Promise<void> {
    // Local dev: log it; notification emails are also stored in `notifications`
    // so nothing depends on delivery. Swap for Resend via RESEND_API_KEY.
    console.log(`[email] to=${mail.to} subject="${mail.subject}"`);
  }
}

class ResendSender implements EmailSender {
  constructor(private apiKey: string) {}
  async send(mail: OutgoingEmail): Promise<void> {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "SMI <noreply@sheetmetalindustries.com>", ...mail }),
      });
    } catch (e) {
      console.error("[email] send failed:", e);
    }
  }
}

export function getEmailSender(): EmailSender {
  const key = process.env.RESEND_API_KEY;
  return key ? new ResendSender(key) : new ConsoleMailpitSender();
}

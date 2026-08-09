import { serviceDb } from "../db/server";

/**
 * NewsletterSender adapter (TECH-DECISIONS #7): platform undecided pending the
 * deliverability gate (MailChimp vs Resend/Klaviyo) — everything behind this
 * interface. Local dev: marks recipients and logs.
 * The recipient list ALWAYS excludes unsubscribed contacts.
 */

export interface NewsletterSender {
  sendIssue(issueId: string): Promise<void>;
}

class LoggingNewsletterStub implements NewsletterSender {
  async sendIssue(issueId: string): Promise<void> {
    const db = serviceDb();
    const { count } = await db
      .from("contacts")
      .select("*", { count: "exact", head: true })
      .eq("subscribed", true)
      .is("unsubscribed_at", null);
    console.log(`[newsletter] would send issue ${issueId} to ${count ?? 0} subscribed contacts`);
  }
}

export function getNewsletterSender(): NewsletterSender {
  return new LoggingNewsletterStub();
}

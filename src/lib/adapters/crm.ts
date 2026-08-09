import { serviceDb } from "../db/server";

/**
 * CrmSync adapter (TECH-DECISIONS #11): scheduled polling + dedupe against
 * Bigin. Local dev: the `contacts` table IS the mirror, so the stub just
 * timestamps a sync pass. Real impl: pull changed Bigin records since
 * last_synced_at, match on email/company domain, push local additions and
 * unsubscribes back. Unsubscribed_at is never cleared by sync.
 */

export interface CrmSync {
  sync(): Promise<void>;
  /** Write-through: a contact created in the app is pushed to Bigin. */
  pushContact(contact: { email: string; name?: string; company?: string }): Promise<void>;
}

class LocalMirrorCrmStub implements CrmSync {
  async sync(): Promise<void> {
    const db = serviceDb();
    await db
      .from("contacts")
      .update({ last_synced_at: new Date().toISOString() })
      .is("bigin_id", null)
      .select("id");
  }
  async pushContact(contact: { email: string }): Promise<void> {
    console.log(`[crm] would push to Bigin: ${contact.email}`);
  }
}

export function getCrmSync(): CrmSync {
  // Real Bigin client lands here behind BIGIN_CLIENT_ID/SECRET once approved.
  return new LocalMirrorCrmStub();
}

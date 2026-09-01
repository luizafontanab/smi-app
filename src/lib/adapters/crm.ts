import { serviceDb } from "../db/server";
import { applyOptIn } from "../contacts";
import { mockBaseUrl } from "./mock-base-url";

/**
 * CrmSync adapter (TECH-DECISIONS #11): scheduled polling + dedupe against
 * Bigin. Local dev: the `contacts` table IS the mirror, so the stub just
 * timestamps a sync pass. Real impl: pull changed Bigin records since
 * last_synced_at, match on email/company domain, push local additions and
 * unsubscribes back. Unsubscribed_at is never cleared by sync.
 *
 * GAPS B6.3: `pushContact` now searches Bigin by email before creating
 * (A20 — no-duplicate write-through), and `sync()` pulls Bigin's own
 * opt-out records back into `contacts` via the same `applyOptIn` state
 * machine the Resend webhook uses (S6 — unsubscribe sync-back). Full
 * pull/reconciliation of new-in-Bigin contacts is still out of scope, same
 * as B6.1's original write-through-only stance.
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

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Raw `fetch` against Zoho Bigin's OAuth2 + REST API — no `zoho`/CRM SDK,
 * matching every other adapter in this directory. `mockBaseUrl()` (Preview
 * only, see `./mock-base-url.ts`) redirects both the accounts host and the
 * API host to this deployment's `/api/mock/bigin/*` routes.
 */
class BiginCrmSync implements CrmSync {
  constructor(
    private clientId: string,
    private clientSecret: string,
    private refreshToken: string,
    private accountsBase: string,
    private apiBase: string,
  ) {}

  private async getToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

    const res = await fetch(`${this.accountsBase}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Bigin token refresh failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
    // 60s safety margin so a token doesn't expire mid-request.
    cachedToken = { token: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
    return access_token;
  }

  /** A20: look up a Bigin contact by email before ever creating one. */
  private async findByEmail(token: string, email: string): Promise<string | null> {
    const res = await fetch(
      `${this.apiBase}/crm/v2/Contacts/search?criteria=(Email:equals:${encodeURIComponent(email)})`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
    );
    if (res.status === 204) return null; // Zoho's documented "no matches" response
    if (!res.ok) return null; // best-effort — fall through to create rather than block the push
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    return body.data?.[0]?.id ?? null;
  }

  async pushContact(contact: { email: string; name?: string; company?: string }): Promise<void> {
    const token = await this.getToken();
    const existingId = await this.findByEmail(token, contact.email);
    const data = { Email: contact.email, Last_Name: contact.name || "Unknown", Account_Name: contact.company };
    const res = await fetch(
      existingId ? `${this.apiBase}/crm/v2/Contacts/${existingId}` : `${this.apiBase}/crm/v2/Contacts`,
      {
        method: existingId ? "PUT" : "POST",
        headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ data: [data] }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Bigin rejected the contact ${existingId ? "update" : "push"} (${res.status}): ${detail.slice(0, 300)}`);
    }
    const body = (await res.json()) as { data?: Array<{ details?: { id?: string } }> };
    const biginId = existingId ?? body.data?.[0]?.details?.id;
    if (biginId) {
      await serviceDb().from("contacts").update({ bigin_id: biginId, last_synced_at: new Date().toISOString() }).eq("email", contact.email);
    }
  }

  /**
   * S6: pull contacts Bigin has marked opted-out — Zoho's built-in Email
   * Opt-Out fields on the Contacts module, `Unsubscribed_Time` — and mirror
   * that back locally through the same `applyOptIn` state machine the
   * Resend webhook uses, so a Bigin-side unsubscribe doesn't silently drift
   * out of sync with the table every other part of the app reads. Written
   * against Zoho's documented search API, never run against a live account
   * — confirm the field name on first real sync (falls back to a no-op
   * search failure rather than breaking the rest of sync() if it's wrong).
   */
  private async syncUnsubscribes(token: string): Promise<void> {
    const res = await fetch(
      `${this.apiBase}/crm/v2/Contacts/search?criteria=(Unsubscribed_Time:not_equal:null)&fields=Email,Unsubscribed_Time`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
    );
    if (res.status === 204) return; // no opted-out records
    if (!res.ok) {
      console.error(`[crm] Bigin unsubscribe search failed (${res.status})`);
      return;
    }
    const body = (await res.json()) as { data?: Array<{ Email?: string }> };
    const db = serviceDb();
    for (const record of body.data ?? []) {
      if (!record.Email) continue;
      const { data: contact } = await db
        .from("contacts")
        .select("id, subscribed, unsubscribed_at")
        .eq("email", record.Email.toLowerCase())
        .maybeSingle();
      if (!contact || contact.unsubscribed_at) continue; // no local row, or already permanent — never restamp
      const next = applyOptIn(contact, { newsletter: "unsubscribed", reOptIn: false });
      await db.from("contacts").update(next).eq("id", contact.id);
    }
  }

  async sync(): Promise<void> {
    const token = await this.getToken(); // surfaces a bad refresh token as a dead job, not a silent no-op
    await this.syncUnsubscribes(token);
    const db = serviceDb();
    await db
      .from("contacts")
      .update({ last_synced_at: new Date().toISOString() })
      .is("bigin_id", null)
      .select("id");
  }
}

export function getCrmSync(): CrmSync {
  const clientId = process.env.BIGIN_CLIENT_ID?.trim();
  const clientSecret = process.env.BIGIN_CLIENT_SECRET?.trim();
  const refreshToken = process.env.BIGIN_REFRESH_TOKEN?.trim();
  if (clientId && clientSecret && refreshToken) {
    const mock = mockBaseUrl();
    const accountsBase = mock ? `${mock}/api/mock/bigin` : (process.env.BIGIN_ACCOUNTS_BASE?.trim() || "https://accounts.zoho.eu");
    const apiBase = mock ? `${mock}/api/mock/bigin` : (process.env.BIGIN_API_BASE?.trim() || "https://www.zohoapis.eu");
    return new BiginCrmSync(clientId, clientSecret, refreshToken, accountsBase, apiBase);
  }
  return new LocalMirrorCrmStub();
}

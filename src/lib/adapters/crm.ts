import { createHmac, timingSafeEqual } from "node:crypto";
import { serviceDb } from "../db/server";
import type { Json, TablesInsert } from "../db/types";
import { applyOptIn } from "../contacts";
import { optInEvidence } from "../newsletter-consent";
import { siteUrl } from "../site-url";
import { mockBaseUrl } from "./mock-base-url";

/**
 * CrmSync adapter (TECH-DECISIONS #11) — two-way sync between `contacts` and
 * Zoho Bigin's Contacts module.
 *
 * Bigin is not Zoho CRM. Same API host, different product: Bigin lives under
 * `/bigin/v2/{module}` with `ZohoBigin.*` scopes. This adapter used to call
 * `/crm/v2/Contacts`, Zoho CRM's path, which a Bigin-only account would have
 * refused on the first live call (GAPS B6.4).
 *
 * Directions:
 *   · us → Bigin: every local change goes through syncContactToCrm(), which
 *     pushes the contact's full state and queues a `crm_push` retry on failure.
 *   · Bigin → us: pull() reads contacts modified since a stored cursor (the
 *     `crm_sync` job), and the /api/webhooks/bigin route calls pullIds() for
 *     near-real-time changes. Polling is the source of truth; the webhook only
 *     makes it faster.
 *
 * The rules, and why:
 *   · Opt-out wins both ways. A Bigin opt-out is stamped here through
 *     applyOptIn (never cleared by sync); a local unsubscribe pushes
 *     Email_Opt_Out=true. A push sends Email_Opt_Out=false only on an explicit
 *     console re-opt-in — never by default, or an unrelated edit here could
 *     silently undo an opt-out someone made in Bigin a minute earlier.
 *   · A pull never overwrites the profile fields of a row with `crm_dirty_at`
 *     set: that local edit hasn't reached Bigin yet, and Bigin's copy is the
 *     stale one.
 *   · Nothing is ever deleted on either side. A Bigin delete only unlinks.
 *   · Companies are linked, never created: Bigin keeps companies as records,
 *     and a typo here must not mint a near-duplicate company there.
 *   · The first import (~2,700 contacts, most subscribed) is never automatic —
 *     it waits for someone to preview and run it from /console/crm, because
 *     it changes who the next newsletter goes to.
 *
 * Field names and response shapes follow bigin.com/developer/docs/apis/v2/.
 * None of it has run against a live account yet — HUMAN-TODO 7.5 lists what
 * to watch on the first real run.
 */

export type PushOptions = {
  /** Send name fields on an update. Off by default so a name typed into Bigin as First/Last isn't reshuffled by our single `name`. */
  nameChanged?: boolean;
  /** The console's explicit re-opt-in — the only time a push clears Bigin's opt-out. */
  reOptIn?: boolean;
};

export type PullSummary = {
  firstImport: boolean;
  dryRun: boolean;
  fetched: number;
  inserted: number;
  updated: number;
  linked: number;
  optedOut: number;
  unchanged: number;
  skippedNoEmail: number;
  duplicates: number;
};

export type SyncResult = {
  /** null when the pull was skipped because the first import hasn't been run. */
  pulled: PullSummary | null;
  pushed: number;
  pushFailed: number;
  watch: "ok" | "skipped" | string;
};

/** What /console/crm shows about the most recent run — `settings` key crm_sync_last. */
export type LastRun = { at: string; preview: boolean } & SyncResult;

export type BiginCompany = { id: string; name: string };

export interface CrmSync {
  /** False for the local stub — the console uses it to say Bigin isn't connected. */
  readonly live: boolean;
  /** Write-through: push one contact's full current state to Bigin. */
  pushContact(contactId: string, opts?: PushOptions): Promise<void>;
  /** Read Bigin contacts modified since the cursor into `contacts`. Returns null when skipped (no first import yet). */
  pull(opts?: { dryRun?: boolean; allowFirstImport?: boolean }): Promise<PullSummary | null>;
  /** Webhook path: re-read these Bigin contacts by id and apply them. */
  pullIds(ids: string[]): Promise<void>;
  /** Webhook path: these Bigin contacts were deleted — unlink, keep the local row. */
  unlink(ids: string[]): Promise<void>;
  /** Console picker: existing Bigin companies matching `q`. */
  searchCompanies(q: string): Promise<BiginCompany[]>;
  /** The `crm_sync` job: retry stuck pushes, pull, renew the webhook channel. */
  sync(opts?: { allowFirstImport?: boolean }): Promise<SyncResult>;
}

export const CRM_CURSOR_KEY = "crm_sync_cursor";
export const CRM_LAST_KEY = "crm_sync_last";
export const CRM_WATCH_KEY = "crm_watch";

/** Fields read on every pull. `id` always comes back; v2 requires the rest to be named. */
const PULL_FIELDS = "Email,First_Name,Last_Name,Full_Name,Account_Name,Email_Opt_Out,Unsubscribed_Time,Modified_Time";
/** Re-read overlap: Modified_Time has second resolution and clocks drift. */
const CURSOR_OVERLAP_MS = 5 * 60_000;
/** A dirty row younger than this is still being handled by its own push or retry job. */
const DIRTY_GRACE_MS = 10 * 60_000;
const DIRTY_SWEEP_LIMIT = 50;
/** 600 pages × 200 = 120k records — Bigin's page_token ceiling is 100k, so this only stops a runaway loop. */
const MAX_PAGES = 600;

/** Postgres unique_violation — contacts.email and contacts.bigin_id are both unique. */
const UNIQUE_VIOLATION = "23505";

const LOCAL_COLUMNS =
  "id, email, name, company, bigin_id, bigin_company_id, bigin_company_name, bigin_modified_at, subscribed, unsubscribed_at, crm_dirty_at";

export type LocalContact = {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  bigin_id: string | null;
  bigin_company_id: string | null;
  bigin_company_name: string | null;
  bigin_modified_at: string | null;
  subscribed: boolean;
  unsubscribed_at: string | null;
  crm_dirty_at: string | null;
};

export type BiginContact = {
  id: string;
  Email?: string | null;
  First_Name?: string | null;
  Last_Name?: string | null;
  Full_Name?: string | null;
  Account_Name?: { id?: string; name?: string } | null;
  Email_Opt_Out?: boolean | null;
  Unsubscribed_Time?: string | null;
  Modified_Time?: string | null;
};

/* ---------- pure mapping (exported for tests) ---------- */

/** Bigin requires Last_Name; ours is a single `name`. Split at the last space; no name → the email's local part. */
export function splitName(name: string | null, email: string): { First_Name?: string; Last_Name: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { Last_Name: email.split("@")[0] || email };
  if (parts.length === 1) return { Last_Name: parts[0] };
  return { First_Name: parts.slice(0, -1).join(" "), Last_Name: parts[parts.length - 1] };
}

/** The Bigin record body for a push. See the class docstring for the opt-out and name rules. */
export function contactPayload(
  row: Pick<LocalContact, "email" | "name" | "unsubscribed_at">,
  opts: PushOptions & { create: boolean; account: BiginCompany | null },
): Record<string, unknown> {
  const payload: Record<string, unknown> = { Email: row.email };
  if (opts.create || (opts.nameChanged && row.name?.trim())) Object.assign(payload, splitName(row.name, row.email));
  if (row.unsubscribed_at) payload.Email_Opt_Out = true;
  else if (opts.reOptIn) payload.Email_Opt_Out = false;
  if (opts.account) payload.Account_Name = { id: opts.account.id };
  return payload;
}

export const biginEmail = (r: BiginContact) => r.Email?.trim().toLowerCase() || null;

function biginName(r: BiginContact): string | null {
  return r.Full_Name?.trim() || [r.First_Name, r.Last_Name].map((s) => s?.trim()).filter(Boolean).join(" ") || null;
}

function biginAccount(r: BiginContact): BiginCompany | null {
  return r.Account_Name?.id ? { id: r.Account_Name.id, name: r.Account_Name.name ?? "" } : null;
}

export type Reconciled =
  | { kind: "insert"; row: TablesInsert<"contacts"> }
  | { kind: "update"; patch: Partial<TablesInsert<"contacts">>; linked: boolean; optedOut: boolean; changed: boolean };

/**
 * One Bigin record + the local row it matched (or null) → what to write.
 * The caller has already checked the record has an email and isn't a duplicate.
 */
export function reconcile(record: BiginContact, local: LocalContact | null, now: Date = new Date()): Reconciled {
  const email = biginEmail(record)!;
  const optOut = record.Email_Opt_Out === true;
  const stamp = record.Unsubscribed_Time && !Number.isNaN(Date.parse(record.Unsubscribed_Time))
    ? new Date(record.Unsubscribed_Time)
    : now;
  const name = biginName(record);
  const account = biginAccount(record);
  const bookkeeping = { bigin_modified_at: record.Modified_Time ?? null, last_synced_at: now.toISOString() };

  if (!local) {
    return {
      kind: "insert",
      row: {
        email,
        name,
        company: account?.name || null,
        bigin_id: record.id,
        bigin_company_id: account?.id ?? null,
        bigin_company_name: account?.name || null,
        subscribed: !optOut,
        unsubscribed_at: optOut ? stamp.toISOString() : null,
        source: "bigin",
        // Gap review area 6: the date is the import, not a consent record —
        // which is what opt_in_source "bigin" means (migration 20261021000004).
        ...(optOut ? {} : optInEvidence("bigin", null, now)),
        ...bookkeeping,
      },
    };
  }

  const patch: Partial<TablesInsert<"contacts">> = {};
  const linked = local.bigin_id !== record.id;
  if (linked) patch.bigin_id = record.id;

  if (!local.crm_dirty_at) {
    if (name && name !== local.name) patch.name = name;
    // A bounce belongs to the old address (gap review area 7).
    if (email !== local.email) Object.assign(patch, { email, bounced_at: null });
    if ((account?.id ?? null) !== local.bigin_company_id || (account && account.name !== local.bigin_company_name)) {
      patch.bigin_company_id = account?.id ?? null;
      patch.bigin_company_name = account?.name || null;
    }
    if (account?.name && !local.company) patch.company = account.name;
  }

  // Opt-out is applied even to a dirty row — the one direction where acting on
  // a possibly-stale copy is safe. applyOptIn never restamps an existing one.
  let optedOut = false;
  if (optOut && !local.unsubscribed_at) {
    Object.assign(patch, applyOptIn(local, { newsletter: "unsubscribed", reOptIn: false }, stamp));
    optedOut = true;
  }

  const changed = Object.keys(patch).length > 0;
  return { kind: "update", patch: { ...patch, ...bookkeeping }, linked, optedOut, changed };
}

/** Zoho criteria treat ( ) , and \ as syntax — escape them inside a value. */
export const escapeCriteria = (value: string) => value.replace(/[(),\\]/g, "\\$&");

/** Zoho wants ISO 8601 with an offset and no milliseconds. */
const zohoTime = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "+00:00");

/** Constant-time check of the token Bigin echoes back on each notification. */
export function webhookTokenMatches(received: unknown, expected: string | undefined): boolean {
  if (!expected || typeof received !== "string") return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The mock Bigin routes (/api/mock/bigin/*, Preview with MOCK_INTEGRATIONS=1)
 * hold whatever contacts a Preview has pushed, and used to accept any
 * `Zoho-oauthtoken <anything>` — so anyone who found a Preview URL could read
 * them. The adapter now also sends this header when it talks to the mock, and
 * the routes refuse a call without it (store.ts guard).
 *
 * An HMAC of the deployment's own SUPABASE_SECRET_KEY: present and random on
 * every deployment that has a database, never sent anywhere but this
 * deployment's own mock routes, and not reversible into the key. No key, no
 * value — and the guard then refuses everything, failing closed.
 */
export const MOCK_KEY_HEADER = "x-smi-mock-key";
export function mockBiginKey(): string | null {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  return secret ? createHmac("sha256", secret).update("smi:bigin-mock").digest("hex") : null;
}

/* ---------- settings (cursor, last run, webhook channel) ---------- */

async function readSetting<T>(key: string): Promise<T | null> {
  const { data, error } = await serviceDb().from("settings").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(`settings read ${key}: ${error.message}`);
  return (data?.value as T | undefined) ?? null;
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  const { error } = await serviceDb().from("settings").upsert({ key, value: value as Json });
  if (error) throw new Error(`settings write ${key}: ${error.message}`);
}

export async function readLastRun(): Promise<LastRun | null> {
  return readSetting<LastRun>(CRM_LAST_KEY);
}

export async function saveLastRun(run: LastRun): Promise<void> {
  await writeSetting(CRM_LAST_KEY, run);
}

/** Whether the first import has run — before it, nothing is pulled automatically. */
export async function firstImportDone(): Promise<boolean> {
  return (await readSetting<{ since: string }>(CRM_CURSOR_KEY)) !== null;
}

/* ---------- stub ---------- */

const EMPTY_RESULT: SyncResult = { pulled: null, pushed: 0, pushFailed: 0, watch: "skipped" };

class LocalMirrorCrmStub implements CrmSync {
  readonly live = false;
  async pushContact(contactId: string): Promise<void> {
    console.log(`[crm] would push contact ${contactId} to Bigin`);
  }
  async pull(): Promise<PullSummary | null> {
    return null;
  }
  async pullIds(): Promise<void> {}
  async unlink(): Promise<void> {}
  async searchCompanies(): Promise<BiginCompany[]> {
    return [];
  }
  async sync(): Promise<SyncResult> {
    return EMPTY_RESULT;
  }
}

/* ---------- Bigin ---------- */

let cachedToken: { token: string; expiresAt: number } | null = null;

type RecordResult = {
  code?: string;
  message?: string;
  status?: string;
  details?: { id?: string; api_name?: string } & Record<string, unknown>;
};
type WriteResponse = { data?: RecordResult[] };
type ListResponse<T> = { data?: T[]; info?: { more_records?: boolean; next_page_token?: string | null } };

/** A refused Bigin call, with the per-record result kept so a caller can tell what it was refused for. */
export class BiginApiError extends Error {
  constructor(message: string, readonly status: number, readonly result: RecordResult | null) {
    super(message);
    this.name = "BiginApiError";
  }
}

/** The per-record result in a Bigin error body: inside `data[]` for writes, at the top level otherwise. */
function recordResult(body: unknown): RecordResult | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { data?: unknown; code?: unknown };
  if (Array.isArray(b.data) && b.data[0] && typeof b.data[0] === "object") return b.data[0] as RecordResult;
  return typeof b.code === "string" ? (b as RecordResult) : null;
}

/**
 * Could this refusal mean the record id in the URL no longer exists in Bigin?
 * Bigin documents INVALID_DATA for "the id specified is incorrect" and Zoho's
 * own docs word it "the id given seems to be invalid", naming no field — unlike
 * a bad field value, which names its api_name. Only a hint: the caller
 * confirms by reading the record back before acting on it.
 */
const mayBeGoneRecord = (e: BiginApiError) =>
  e.status === 404 || (e.result?.code === "INVALID_DATA" && (e.result.details?.api_name ?? "id") === "id");
/** Same, for the Account_Name lookup: the company was deleted or merged in Bigin. */
const mayBeGoneAccount = (e: BiginApiError) => e.result?.code === "INVALID_DATA" && e.result.details?.api_name === "Account_Name";

/**
 * Raw `fetch` against Bigin's OAuth2 + REST API — no Zoho SDK, matching every
 * other adapter in this directory. `mockBaseUrl()` (Preview only, see
 * `./mock-base-url.ts`) redirects both hosts to `/api/mock/bigin/*`.
 */
class BiginCrmSync implements CrmSync {
  readonly live = true;

  constructor(
    private clientId: string,
    private clientSecret: string,
    private refreshToken: string,
    private accountsBase: string,
    private apiBase: string,
    /** Only when talking to the mock: proves to its routes that the call is ours (see mockBiginKey). */
    private mockKey: string | null = null,
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

  /** One API call. 204 → null (Zoho's "nothing here"); any other non-2xx throws a BiginApiError, 429 (out of credits) included. */
  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T | null> {
    const token = await this.getToken();
    const res = await fetch(`${this.apiBase}/bigin/v2${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(this.mockKey ? { [MOCK_KEY_HEADER]: this.mockKey } : {}),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(detail);
      } catch {
        // not JSON — the status and the text are all there is
      }
      throw new BiginApiError(
        `Bigin ${init.method ?? "GET"} ${path.split("?")[0]} failed (${res.status}): ${detail.slice(0, 300)}`,
        res.status,
        recordResult(parsed),
      );
    }
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }

  /** Writes answer per record, and a rejected record can arrive as HTTP 202 — read the code, not the status. */
  private writtenId(body: WriteResponse | null, what: string): string {
    const result = body?.data?.[0];
    if (result?.code !== "SUCCESS" || !result.details?.id) {
      throw new BiginApiError(
        `Bigin rejected the ${what}: ${result?.code ?? "no result"} ${result?.message ?? ""} ${JSON.stringify(result?.details ?? {})}`.trim(),
        202,
        result ?? null,
      );
    }
    return result.details.id;
  }

  /**
   * Is this record really gone from Bigin? Asked before acting on a refusal
   * that only suggests it, so a contact is never unlinked from a record that
   * still exists. A record that doesn't exist reads back as 204 (Bigin's
   * status-code docs) — or, as Zoho CRM answers, the same INVALID_DATA.
   */
  private async isGone(path: string): Promise<boolean> {
    try {
      const body = await this.request<ListResponse<{ id?: string }>>(path);
      return !body?.data?.length;
    } catch (e) {
      if (e instanceof BiginApiError && mayBeGoneRecord(e)) return true;
      throw e;
    }
  }

  /** A20: look a contact up by email before ever creating one. */
  private async findContactByEmail(email: string): Promise<string | null> {
    const body = await this.request<ListResponse<{ id?: string }>>(
      `/Contacts/search?criteria=${encodeURIComponent(`(Email:equals:${escapeCriteria(email)})`)}`,
    );
    return body?.data?.[0]?.id ?? null;
  }

  private async findCompaniesByName(name: string): Promise<BiginCompany[]> {
    const body = await this.request<ListResponse<{ id?: string; Account_Name?: string }>>(
      `/Accounts/search?criteria=${encodeURIComponent(`(Account_Name:equals:${escapeCriteria(name)})`)}`,
    );
    return (body?.data ?? []).filter((a) => a.id).map((a) => ({ id: a.id!, name: a.Account_Name ?? name }));
  }

  async searchCompanies(q: string): Promise<BiginCompany[]> {
    const word = q.trim();
    if (word.length < 2) return [];
    const body = await this.request<ListResponse<{ id?: string; Account_Name?: string }>>(`/Accounts/search?word=${encodeURIComponent(word)}`);
    return (body?.data ?? []).filter((a) => a.id && a.Account_Name).map((a) => ({ id: a.id!, name: a.Account_Name! }));
  }

  /**
   * Push one contact. Two ways a push could otherwise fail for ever or fork the
   * record, both handled here:
   *
   *  · A stored bigin_id (or company link) Bigin no longer has — deleted there,
   *    and the delete notification never reached /api/webhooks/bigin. Every PUT
   *    to it is refused, so before this the push stayed dirty, crm_push died
   *    and crm_sync threw every 15 minutes. Now a refusal that looks like a
   *    missing id is confirmed by reading the record back; if it is gone, the
   *    link is cleared and the push goes on as for a never-linked contact
   *    (search by email, else create). A gone company is dropped the same way.
   *
   *  · Two pushes of a never-linked contact at once (a console edit and its
   *    queued retry, say) can both search, both find nothing and both create.
   *    The write-back only links a new record while the row is still
   *    unlinked (`bigin_id is null`), so exactly one wins; the other deletes
   *    the record it just made and pushes again — onto the winner's record,
   *    so its own, possibly newer, state still lands. Serialising pushes per
   *    contact would need a lock PostgREST can't hold across the HTTP calls;
   *    the conditional write is the one step that is atomic already.
   */
  async pushContact(contactId: string, opts: PushOptions = {}, afterLostRace = false): Promise<void> {
    const db = serviceDb();
    const { data: row, error } = await db.from("contacts").select(LOCAL_COLUMNS).eq("id", contactId).maybeSingle();
    if (error) throw new Error(`crm push: reading contact ${contactId}: ${error.message}`);
    if (!row) return; // deleted since it was queued — nothing left to push

    // Link to an existing Bigin company: the one already chosen, else an exact
    // name match — and only when exactly one company has that name.
    let account: BiginCompany | null = row.bigin_company_id ? { id: row.bigin_company_id, name: row.bigin_company_name ?? "" } : null;
    let autoLinked = false;
    if (!account && row.company?.trim()) {
      const matches = await this.findCompaniesByName(row.company.trim());
      if (matches.length === 1) {
        account = matches[0];
        autoLinked = true;
      }
    }

    // By stored id first, so an email changed here updates the same Bigin
    // record instead of orphaning it; by email only for a never-linked row.
    let existingId = row.bigin_id ?? (await this.findContactByEmail(row.email));
    let biginId: string;
    for (let attempt = 0; ; attempt++) {
      const create = !existingId;
      try {
        const body = await this.request<WriteResponse>(create ? "/Contacts" : `/Contacts/${encodeURIComponent(existingId!)}`, {
          method: create ? "POST" : "PUT",
          // trigger: [] — our writes must not fire Bigin workflow emails or automations
          body: { data: [contactPayload(row, { ...opts, create, account })], trigger: [] },
        });
        const written = this.writtenId(body, create ? "new contact" : "contact update");
        biginId = existingId ?? written;
        break;
      } catch (e) {
        // two repairs at most (record, then company); anything after that is a real refusal
        if (attempt >= 2 || !(e instanceof BiginApiError)) throw e;
        if (existingId && mayBeGoneRecord(e) && (await this.isGone(`/Contacts/${encodeURIComponent(existingId)}?fields=Email`))) {
          const stale = existingId;
          // Only the link we read, so a fresh link another push wrote meanwhile survives.
          const { error: unlinkError } = await db
            .from("contacts")
            .update({ bigin_id: null, bigin_modified_at: null })
            .eq("id", contactId)
            .eq("bigin_id", stale);
          if (unlinkError) throw new Error(`crm push: clearing the deleted Bigin record ${stale} from ${contactId}: ${unlinkError.message}`);
          console.warn(`[crm] Bigin no longer has contact ${stale} (linked to ${contactId}); unlinked, pushing as new`);
          const found = await this.findContactByEmail(row.email);
          existingId = found === stale ? null : found;
          continue;
        }
        if (account && mayBeGoneAccount(e) && (await this.isGone(`/Accounts/${encodeURIComponent(account.id)}?fields=Account_Name`))) {
          if (!autoLinked) {
            const { error: companyError } = await db
              .from("contacts")
              .update({ bigin_company_id: null, bigin_company_name: null })
              .eq("id", contactId)
              .eq("bigin_company_id", account.id);
            if (companyError) throw new Error(`crm push: clearing the deleted Bigin company from ${contactId}: ${companyError.message}`);
          }
          console.warn(`[crm] Bigin no longer has company ${account.id} (linked to ${contactId}); pushing without it`);
          account = null;
          autoLinked = false;
          continue;
        }
        throw e;
      }
    }

    const stamp = {
      bigin_id: biginId,
      last_synced_at: new Date().toISOString(),
      crm_dirty_at: null,
      ...(autoLinked && account ? { bigin_company_id: account.id, bigin_company_name: account.name } : {}),
    };
    if (existingId) {
      const { error: writeError } = await db.from("contacts").update(stamp).eq("id", contactId);
      if (writeError) throw new Error(`crm push: Bigin accepted ${contactId} but the write-back failed: ${writeError.message}`);
      return;
    }

    // A record we just created: link it only if nothing else linked this row first.
    const { data: claimed, error: claimError } = await db
      .from("contacts")
      .update(stamp)
      .eq("id", contactId)
      .is("bigin_id", null)
      .select("id")
      .maybeSingle();
    if (claimError) throw new Error(`crm push: Bigin created ${biginId} for ${contactId} but the write-back failed: ${claimError.message}`);
    if (claimed) return;

    // Lost the race: another push linked this contact while ours was creating.
    await this.deleteDuplicate(biginId, contactId);
    if (!afterLostRace) await this.pushContact(contactId, opts, true);
  }

  /** Remove a contact this adapter created a moment ago and turned out not to need. The one delete it ever makes in Bigin. */
  private async deleteDuplicate(biginId: string, contactId: string): Promise<void> {
    const body = await this.request<WriteResponse>(`/Contacts/${encodeURIComponent(biginId)}?wf_trigger=false`, { method: "DELETE" });
    if (body?.data?.[0]?.code !== "SUCCESS") {
      throw new Error(
        `crm push: ${contactId} was linked by a concurrent push, and deleting the duplicate Bigin contact ${biginId} failed — ` +
          `remove it in Bigin by hand: ${JSON.stringify(body?.data?.[0] ?? null)}`,
      );
    }
  }

  /**
   * Apply a batch of Bigin records. Shared by the poll and the webhook.
   * `seen` carries emails across pages so a Bigin-side duplicate is counted
   * once, not linked twice.
   */
  private async applyRecords(records: BiginContact[], summary: PullSummary, seen: Set<string>): Promise<void> {
    const db = serviceDb();
    const ids = records.map((r) => r.id);
    const emails = records.map(biginEmail).filter((e): e is string => !!e);

    const [byId, byEmail] = await Promise.all([
      ids.length ? db.from("contacts").select(LOCAL_COLUMNS).in("bigin_id", ids) : Promise.resolve({ data: [], error: null }),
      emails.length ? db.from("contacts").select(LOCAL_COLUMNS).in("email", emails) : Promise.resolve({ data: [], error: null }),
    ]);
    if (byId.error || byEmail.error) throw new Error(`crm pull: reading local contacts: ${(byId.error ?? byEmail.error)!.message}`);
    const localById = new Map((byId.data as LocalContact[]).map((c) => [c.bigin_id!, c]));
    const localByEmail = new Map((byEmail.data as LocalContact[]).map((c) => [c.email, c]));

    const inserts: { record: BiginContact; row: TablesInsert<"contacts"> }[] = [];
    const now = new Date();
    for (const record of records) {
      summary.fetched++;
      const email = biginEmail(record);
      if (!email) {
        summary.skippedNoEmail++; // contacts.email is not null — a phone-only Bigin contact has nowhere to go
        continue;
      }
      if (seen.has(email)) {
        summary.duplicates++;
        continue;
      }
      seen.add(email);

      const local = localById.get(record.id) ?? localByEmail.get(email) ?? null;
      if (local?.bigin_id && local.bigin_id !== record.id) {
        summary.duplicates++; // this email is already linked to a different Bigin record
        continue;
      }

      const result = reconcile(record, local, now);
      if (result.kind === "insert") {
        summary.inserted++;
        if (result.row.unsubscribed_at) summary.optedOut++;
        inserts.push({ record, row: result.row });
        continue;
      }
      // Bigin changed the email to one another local row already has — keep ours rather than collide on the unique key.
      const clash = result.patch.email ? localByEmail.get(result.patch.email) : undefined;
      if (clash && clash.id !== local!.id) {
        delete result.patch.email;
        summary.duplicates++;
      }
      if (result.linked) summary.linked++;
      if (result.optedOut) summary.optedOut++;
      if (result.changed) summary.updated++;
      else summary.unchanged++;
      if (!summary.dryRun) await this.updateLocal(local!.id, result.patch, summary);
    }
    if (inserts.length && !summary.dryRun) {
      const { error } = await db.from("contacts").insert(inserts.map((i) => i.row));
      if (error && error.code !== UNIQUE_VIOLATION) throw new Error(`crm pull: inserting ${inserts.length} contacts: ${error.message}`);
      // One row clashing on contacts.email or bigin_id fails the whole batch —
      // typically someone signed up here between our read and this insert. Go
      // row by row so the rest still land and the clash is resolved, not fatal.
      if (error) for (const { record, row } of inserts) await this.insertOne(record, row, summary, now);
    }
  }

  /**
   * A per-row update from a pull. A unique clash (the email or bigin_id taken
   * by a row written since the batch was read) is counted as a duplicate and
   * left for the next run, rather than failing every other row with it.
   */
  private async updateLocal(id: string, patch: Partial<TablesInsert<"contacts">>, summary: PullSummary): Promise<void> {
    const { error } = await serviceDb().from("contacts").update(patch).eq("id", id);
    if (!error) return;
    if (error.code !== UNIQUE_VIOLATION) throw new Error(`crm pull: updating contact ${id}: ${error.message}`);
    console.warn(`[crm] pull: contact ${id} clashed with a newer row (${error.message}); left for the next run`);
    summary.duplicates++;
  }

  /**
   * One insert from a batch that clashed. The clashing row exists now, so the
   * Bigin record is applied to it the way it would have been had the batch
   * read it — linked, or counted as a duplicate when it is already linked to a
   * different Bigin record — and the summary moves it out of `inserted`.
   */
  private async insertOne(record: BiginContact, row: TablesInsert<"contacts">, summary: PullSummary, now: Date): Promise<void> {
    const db = serviceDb();
    const { error } = await db.from("contacts").insert(row);
    if (!error) return;
    if (error.code !== UNIQUE_VIOLATION) throw new Error(`crm pull: inserting contact ${row.email}: ${error.message}`);

    summary.inserted--;
    if (row.unsubscribed_at) summary.optedOut--;
    // Two reads rather than one .or(): an email can hold the characters PostgREST's filter syntax uses.
    const [byId, byEmail] = await Promise.all([
      db.from("contacts").select(LOCAL_COLUMNS).eq("bigin_id", record.id).maybeSingle(),
      db.from("contacts").select(LOCAL_COLUMNS).eq("email", row.email).maybeSingle(),
    ]);
    if (byId.error || byEmail.error) throw new Error(`crm pull: reading the row ${row.email} clashed with: ${(byId.error ?? byEmail.error)!.message}`);
    const local = ((byId.data ?? byEmail.data) as LocalContact | null) ?? null;
    if (!local || (local.bigin_id && local.bigin_id !== record.id)) {
      summary.duplicates++;
      return;
    }
    const result = reconcile(record, local, now);
    if (result.kind !== "update") return; // unreachable: `local` is set
    if (result.linked) summary.linked++;
    if (result.optedOut) summary.optedOut++;
    if (result.changed) summary.updated++;
    else summary.unchanged++;
    await this.updateLocal(local.id, result.patch, summary);
  }

  async pull(opts: { dryRun?: boolean; allowFirstImport?: boolean } = {}): Promise<PullSummary | null> {
    const cursor = await readSetting<{ since: string }>(CRM_CURSOR_KEY);
    if (!cursor && !opts.allowFirstImport) return null;
    const since = cursor ? Date.parse(cursor.since) - CURSOR_OVERLAP_MS : null;

    const summary: PullSummary = {
      firstImport: !cursor, dryRun: !!opts.dryRun,
      fetched: 0, inserted: 0, updated: 0, linked: 0, optedOut: 0, unchanged: 0, skippedNoEmail: 0, duplicates: 0,
    };
    const seen = new Set<string>();
    let newest: string | null = null;
    let page = 1;
    let pageToken: string | null = null;

    // Newest first, so an incremental pull stops at the first record older
    // than the cursor. Past 2,000 records Bigin wants page_token, not page.
    for (let i = 0; i < MAX_PAGES; i++) {
      const paging: string = pageToken ? `page_token=${encodeURIComponent(pageToken)}` : `page=${page}`;
      const body: ListResponse<BiginContact> | null = await this.request<ListResponse<BiginContact>>(
        `/Contacts?fields=${PULL_FIELDS}&sort_by=Modified_Time&sort_order=desc&per_page=200&${paging}`,
      );
      const records = body?.data ?? [];
      newest ??= records[0]?.Modified_Time ?? null;

      const fresh = since === null ? records : records.filter((r) => !r.Modified_Time || Date.parse(r.Modified_Time) >= since);
      await this.applyRecords(fresh, summary, seen);

      const reachedCursor = fresh.length < records.length;
      if (reachedCursor || !body?.info?.more_records) break;
      if (body.info.next_page_token) pageToken = body.info.next_page_token;
      else page++;
    }

    // Only a completed run moves the cursor, so a failure mid-way is retried from the same point.
    if (!summary.dryRun) await writeSetting(CRM_CURSOR_KEY, { since: newest ?? cursor?.since ?? new Date().toISOString() });
    return summary;
  }

  async pullIds(ids: string[]): Promise<void> {
    if (!ids.length || !(await firstImportDone())) return; // the first import will pick them up
    const records: BiginContact[] = [];
    for (const id of ids.slice(0, 100)) {
      const body = await this.request<ListResponse<BiginContact>>(`/Contacts/${encodeURIComponent(id)}?fields=${PULL_FIELDS}`);
      if (body?.data?.[0]) records.push(body.data[0]);
    }
    const summary: PullSummary = {
      firstImport: false, dryRun: false,
      fetched: 0, inserted: 0, updated: 0, linked: 0, optedOut: 0, unchanged: 0, skippedNoEmail: 0, duplicates: 0,
    };
    await this.applyRecords(records, summary, new Set());
  }

  async unlink(ids: string[]): Promise<void> {
    if (!ids.length) return;
    // Bigin deleted them; we keep the row and its opt-out. A later local edit
    // will create a fresh Bigin record for it, which is the honest outcome.
    const { error } = await serviceDb().from("contacts").update({ bigin_id: null, bigin_modified_at: null }).in("bigin_id", ids);
    if (error) throw new Error(`crm unlink: ${error.message}`);
  }

  /**
   * Keep a Notifications API channel open so Bigin tells /api/webhooks/bigin
   * about contact changes. Channels last at most a day, so this renews on
   * every sync once less than 3h remain. A gap between expiry and renewal
   * costs nothing but latency: the poll still catches every change.
   */
  private async ensureWatch(): Promise<"ok" | "skipped"> {
    const token = process.env.BIGIN_WEBHOOK_TOKEN?.trim();
    const base = siteUrl();
    if (!token || /\/\/(localhost|127\.0\.0\.1)\b/.test(base)) return "skipped";

    const state = await readSetting<{ channel_id: string; expires_at: string }>(CRM_WATCH_KEY);
    if (state && Date.parse(state.expires_at) - Date.now() > 3 * 60 * 60_000) return "ok";

    const channelId = state?.channel_id ?? String(Date.now());
    const expires = new Date(Date.now() + 23.5 * 60 * 60_000);
    const watch = {
      watch: [{
        channel_id: Number(channelId),
        events: ["Contacts.all"],
        notify_url: `${base}/api/webhooks/bigin`,
        token,
        channel_expiry: zohoTime(expires),
      }],
    };
    // Re-enabling an existing channel_id may need the update verb rather than
    // create — unverified on a live account, so try create, then update.
    let ok = false;
    for (const method of ["POST", "PATCH"]) {
      try {
        const body = await this.request<{ watch?: Array<{ code?: string }> }>("/actions/watch", { method, body: watch });
        if (body?.watch?.[0]?.code === "SUCCESS") {
          ok = true;
          break;
        }
      } catch (e) {
        if (method === "PATCH") throw e;
      }
    }
    if (!ok) throw new Error("Bigin refused the notification channel (actions/watch)");
    await writeSetting(CRM_WATCH_KEY, { channel_id: channelId, expires_at: expires.toISOString() });
    return "ok";
  }

  async sync(opts: { allowFirstImport?: boolean } = {}): Promise<SyncResult> {
    // 1. pushes whose own retry job died, or never got queued
    const db = serviceDb();
    const { data: dirty, error } = await db
      .from("contacts")
      .select("id")
      .not("crm_dirty_at", "is", null)
      .lt("crm_dirty_at", new Date(Date.now() - DIRTY_GRACE_MS).toISOString())
      .limit(DIRTY_SWEEP_LIMIT);
    if (error) throw new Error(`crm sync: reading pending pushes: ${error.message}`);
    let pushed = 0, pushFailed = 0;
    for (const { id } of dirty ?? []) {
      try {
        await this.pushContact(id);
        pushed++;
      } catch (e) {
        pushFailed++;
        console.error(`[crm] retrying push for contact ${id} failed:`, e);
      }
    }

    // 2. Bigin → us   3. keep the webhook channel open (only once there is something to keep in step)
    const pulled = await this.pull({ allowFirstImport: opts.allowFirstImport });
    let watch: SyncResult["watch"] = "skipped";
    if (pulled) {
      try {
        watch = await this.ensureWatch();
      } catch (e) {
        watch = e instanceof Error ? e.message : String(e);
      }
    }

    const result: SyncResult = { pulled, pushed, pushFailed, watch };
    await saveLastRun({ at: new Date().toISOString(), preview: false, ...result });
    // Throw after recording, so the job retries and, if it keeps failing,
    // lands in "Needs You Today" instead of failing quietly.
    if (pushFailed) throw new Error(`crm sync: ${pushFailed} of ${pushed + pushFailed} pending pushes failed`);
    if (watch !== "ok" && watch !== "skipped") throw new Error(`crm sync: ${watch}`);
    return result;
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
    return new BiginCrmSync(clientId, clientSecret, refreshToken, accountsBase, apiBase, mock ? mockBiginKey() : null);
  }
  return new LocalMirrorCrmStub();
}

/**
 * The one write-through entry point for every local change to a contact.
 * Marks the row dirty, pushes it, and on failure queues a `crm_push` retry.
 * Never throws: the change has already been saved here, and a Bigin outage
 * must not cost anyone their subscription, unsubscribe or console edit.
 */
export async function syncContactToCrm(contactId: string, opts: PushOptions = {}): Promise<void> {
  const crm = getCrmSync();
  try {
    if (crm.live) {
      const { error } = await serviceDb().from("contacts").update({ crm_dirty_at: new Date().toISOString() }).eq("id", contactId);
      if (error) throw new Error(`marking contact ${contactId} for push: ${error.message}`);
    }
    await crm.pushContact(contactId, opts);
  } catch (e) {
    console.error(`[crm] push failed for contact ${contactId}; queued for retry:`, e);
    try {
      // lazy: jobs.ts imports this module lazily too, and its other imports aren't needed on this path
      const { enqueue } = await import("../jobs");
      await enqueue(
        "crm_push",
        { contact_id: contactId, name_changed: !!opts.nameChanged, re_opt_in: !!opts.reOptIn },
        new Date(Date.now() + 5 * 60_000),
      );
    } catch (queueError) {
      // still not lost: the row stays dirty and the next crm_sync sweep pushes it
      console.error(`[crm] could not queue the retry for contact ${contactId}:`, queueError);
    }
  }
}

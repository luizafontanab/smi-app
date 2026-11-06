import { getCrmSync, isScopeRefusal, NEWS_PAGE_FIELD, type CompanyNewsPages, type CrmSync } from "../adapters/crm";
import { serviceDb } from "../db/server";
import type { Json } from "../db/types";
import { applyBiginSources } from "../sources/bigin";

/**
 * A CRM company's News Page URL, edited in CRM's Companies box and written
 * through to Bigin (issue #55, spec #49, ADR 0002). It works the way a
 * contact edit does (lib/adapters/crm syncContactToCrm):
 *
 *   1. The edit is saved in `crm_companies` and marked pending
 *      (`news_page_pending_at`). The company sync keeps a pending value
 *      over Bigin's stale copy (lib/crm-companies/sync.ts).
 *   2. The company's story source follows the new address straight away —
 *      a blank one falls back to the Website, as the sync does.
 *   3. It's pushed to Bigin. Success clears the mark; a refusal leaves it
 *      and queues a `crm_push` retry, and the `crm_sync` sweep picks up any
 *      whose retry died.
 *
 * Editing needs a Bigin token with the Companies write scope, which the
 * production token doesn't have yet (HUMAN-TODO §7). The app knows from a
 * stored check (`settings.crm_companies_write`), refreshed by every company
 * sync and by any refused push, so the editor is disabled with "edit in Bigin
 * for now" up front instead of failing when someone clicks Save. Never
 * checked counts as not allowed.
 *
 * setCompanyNewsPage is the one entry point for any change to the address:
 * the Save in the editor, and "Use as News Page URL" (#56).
 */

export const COMPANY_WRITE_KEY = "crm_companies_write";
/**
 * Where the company sync keeps Bigin's Companies field list (#54,
 * lib/crm-companies/sync COMPANY_FIELDS_KEY): `newsPageField` is the API
 * name of the field labelled "News Page URL". Read here by key so this
 * module doesn't depend on the sync's types.
 */
const COMPANY_FIELDS_KEY = "crm_company_fields";
/** Whether the Bigin token may write companies, and when that was last learnt. */
export type CompanyWriteAccess = { allowed: boolean; at: string };

/** A pending edit younger than this is still being handled by its own push or retry job. */
const PENDING_GRACE_MS = 10 * 60_000;
const SWEEP_LIMIT = 50;

type Opts = { crm?: CrmSync; now?: () => Date };

export async function readCompanyWriteAccess(): Promise<CompanyWriteAccess | null> {
  const { data, error } = await serviceDb().from("settings").select("value").eq("key", COMPANY_WRITE_KEY).maybeSingle();
  if (error) throw new Error(`settings read ${COMPANY_WRITE_KEY}: ${error.message}`);
  return (data?.value as CompanyWriteAccess | undefined) ?? null;
}

/** The News Page URL field's API name as Bigin's field list gave it, else the assumed NEWS_PAGE_FIELD. */
async function newsPageField(): Promise<string> {
  const { data, error } = await serviceDb().from("settings").select("value").eq("key", COMPANY_FIELDS_KEY).maybeSingle();
  if (error) throw new Error(`settings read ${COMPANY_FIELDS_KEY}: ${error.message}`);
  const name = (data?.value as { newsPageField?: unknown } | undefined)?.newsPageField;
  return typeof name === "string" && name ? name : NEWS_PAGE_FIELD;
}

async function recordWriteAccess(allowed: boolean, now: () => Date): Promise<CompanyWriteAccess> {
  const access = { allowed, at: now().toISOString() };
  const { error } = await serviceDb().from("settings").upsert({ key: COMPANY_WRITE_KEY, value: access as unknown as Json });
  if (error) throw new Error(`settings write ${COMPANY_WRITE_KEY}: ${error.message}`);
  return access;
}

/**
 * Ask Bigin whether the token may write companies, and store the answer.
 * When Bigin can't say (down, out of credits), the stored answer stands.
 * Run by every company sync — the daily job and "Sync companies".
 */
export async function checkCompanyWriteAccess({ crm = getCrmSync(), now = () => new Date() }: Opts = {}): Promise<CompanyWriteAccess | null> {
  const allowed = await crm.canWriteCompanies();
  if (allowed === null) return readCompanyWriteAccess();
  return recordWriteAccess(allowed, now);
}

export type NewsPageSave = "pushed" | "pending" | "not_allowed" | "not_found";

/**
 * Save a company's News Page URL (blank → none), point its story source at
 * it, and push it to Bigin. The company is named by its row id (the CRM
 * editor) or its Bigin id. "pending" means saved but not yet in Bigin, with
 * a retry queued. "not_allowed": Bigin isn't connected, or the token isn't
 * known to write companies — nothing was saved. `deriveSources: false`
 * leaves story sources alone (the Story crawler is off); the next sync with
 * it on derives them from the saved value.
 */
export async function setCompanyNewsPage(
  company: { id: string } | { biginId: string },
  url: string | null,
  { crm = getCrmSync(), now = () => new Date(), deriveSources = true }: Opts & { deriveSources?: boolean } = {},
): Promise<NewsPageSave> {
  if (!crm.live || !(await readCompanyWriteAccess())?.allowed) return "not_allowed";
  const db = serviceDb();
  const stamp = now().toISOString();
  const [column, key] = "id" in company ? ["id", company.id] as const : ["bigin_id", company.biginId] as const;
  const { data: row, error } = await db.from("crm_companies")
    .update({ news_page_url: url?.trim() || null, news_page_pending_at: stamp, updated_at: stamp })
    .eq(column, key)
    .select("bigin_id, name, website, news_page_url")
    .maybeSingle();
  if (error) throw new Error(`saving company ${key}'s News Page URL: ${error.message}`);
  if (!row) return "not_found";
  const biginId = row.bigin_id;

  if (deriveSources) {
    // The edit is saved either way; a failure here is put right by the next company sync.
    try {
      await followSource(row, now);
    } catch (e) {
      console.error(`[crm] company ${biginId}: moving its story source to the new address failed; the next company sync will:`, e);
    }
  }
  const pushed = await pushCompanyNewsPage(biginId, { crm, now });
  return pushed === "pushed" ? "pushed" : "pending";
}

/** One company's story source, by the sync's rules: its News Page URL, else its Website, else none. */
async function followSource(c: { bigin_id: string; name: string; website: string | null; news_page_url: string | null }, now: () => Date) {
  const url = c.news_page_url ?? c.website;
  // Partial, so no other company's source is touched; `cleared` lets this one lose its source.
  const read: CompanyNewsPages = url
    ? { complete: false, companies: [{ id: c.bigin_id, name: c.name, url, fromWebsite: !c.news_page_url }] }
    : { complete: false, companies: [], cleared: [c.bigin_id] };
  await applyBiginSources(read, { now, record: false });
}

/**
 * Push a company's pending News Page URL to Bigin. "nothing" when no edit is
 * pending. On success the mark is cleared — only if no newer edit was saved
 * meanwhile, which then has its own push. On a refusal the edit stays
 * pending; `queueRetry` (off for the retry job itself, which is retried by
 * the queue) queues a `crm_push` for it. Never throws for a Bigin refusal.
 */
export async function pushCompanyNewsPage(
  biginId: string,
  { crm = getCrmSync(), now = () => new Date(), queueRetry = true }: Opts & { queueRetry?: boolean } = {},
): Promise<"pushed" | "pending" | "nothing"> {
  const db = serviceDb();
  const { data: row, error } = await db.from("crm_companies")
    .select("news_page_url, news_page_pending_at").eq("bigin_id", biginId).maybeSingle();
  if (error) throw new Error(`reading company ${biginId} to push: ${error.message}`);
  if (!row?.news_page_pending_at) return "nothing";

  try {
    await crm.updateCompanyNewsPage(biginId, row.news_page_url, await newsPageField());
  } catch (e) {
    console.error(`[crm] pushing company ${biginId}'s News Page URL failed${queueRetry ? "; queued for retry" : ""}:`, e);
    if (isScopeRefusal(e)) await recordWriteAccess(false, now);
    if (queueRetry) {
      try {
        // lazy: jobs.ts imports this module lazily too
        const { enqueue } = await import("../jobs");
        await enqueue("crm_push", { company_id: biginId }, new Date(now().getTime() + 5 * 60_000));
      } catch (queueError) {
        // still not lost: the row stays pending and the crm_sync sweep pushes it
        console.error(`[crm] could not queue the retry for company ${biginId}:`, queueError);
      }
    }
    return "pending";
  }

  const { error: clearError } = await db.from("crm_companies")
    .update({ news_page_pending_at: null })
    .eq("bigin_id", biginId)
    .eq("news_page_pending_at", row.news_page_pending_at);
  if (clearError) throw new Error(`Bigin took company ${biginId}'s News Page URL but clearing the pending mark failed: ${clearError.message}`);
  return "pushed";
}

/**
 * The `crm_sync` sweep: pushes whose own retry died or never got queued.
 * Skipped while the token can't write companies — they'd only be refused
 * again; the next company sync that finds the scope granted resumes them.
 */
export async function retryPendingCompanyPushes({ crm = getCrmSync(), now = () => new Date() }: Opts = {}): Promise<{ pushed: number; failed: number }> {
  const result = { pushed: 0, failed: 0 };
  if (!crm.live || !(await readCompanyWriteAccess())?.allowed) return result;
  const { data, error } = await serviceDb().from("crm_companies")
    .select("bigin_id")
    .not("news_page_pending_at", "is", null)
    .lt("news_page_pending_at", new Date(now().getTime() - PENDING_GRACE_MS).toISOString())
    .limit(SWEEP_LIMIT);
  if (error) throw new Error(`reading pending company pushes: ${error.message}`);
  for (const { bigin_id } of data ?? []) {
    const outcome = await pushCompanyNewsPage(bigin_id, { crm, now, queueRetry: false });
    if (outcome === "pushed") result.pushed++;
    else if (outcome === "pending") result.failed++;
  }
  return result;
}

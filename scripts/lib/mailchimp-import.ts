/**
 * Reconcile the agency's Mailchimp audience export with `contacts` (gap review
 * area 7; requirements/05-platform-layer.md:7 "Reconcile MailChimp-only
 * contacts; no duplicate records"; GAPS B5.13).
 *
 * Today's newsletter goes out from Formation Media's Mailchimp account, and the
 * app's list came from Bigin. Anyone who unsubscribed in Mailchimp but whose
 * opt-out never reached Bigin — the SOP says Bigin's Mailchimp integration
 * doesn't carry unsubscribes — would otherwise be mailed by the first send
 * from here. So the rules, in order of importance:
 *
 *   · Never re-subscribe anyone, and never clear an opt-out or a bounce.
 *   · Unsubscribed in Mailchimp → unsubscribed here, at Mailchimp's time
 *     (through applyOptIn, so it's the same "permanent" as every other route),
 *     and pushed to Bigin as an opt-out. Unknown to us → added, unsubscribed,
 *     so the opt-out is on record if they ever arrive from Bigin or a form.
 *   · Cleaned (Mailchimp's hard bounce) → bounced_at, not an unsubscribe
 *     (migration 20261021000005).
 *   · Subscribed and unknown to us → added as subscribed, source 'mailchimp'.
 *   · For a contact on our list, Mailchimp's opt-in time becomes the consent
 *     record (opt_in_source 'mailchimp') where we have none, or only Bigin's
 *     import date. Someone off the list here gets no record from it.
 *   · New contacts and new opt-outs are marked for a Bigin push
 *     (crm_dirty_at), which the crm_sync job's sweep sends. Evidence and
 *     bounces aren't opt-in changes, so they aren't pushed.
 *
 * Pure: the export and the current contacts in, the writes out. The script
 * (scripts/import-mailchimp.ts) reads, prints, and applies only on --apply.
 *
 * ⚠ The export's column names and time format follow Mailchimp's documented
 * audience export ("Email Address", "OPTIN_TIME", "CONFIRM_TIME",
 * "UNSUB_TIME", "CLEAN_TIME", times as "YYYY-MM-DD HH:MM:SS", taken as UTC).
 * No real export has been seen yet — check both on the first dry run.
 */
import { applyOptIn } from "../../src/lib/contacts";
import type { TablesInsert } from "../../src/lib/db/types";
import { EMAIL_RE } from "../../src/lib/validate";

export type MailchimpStatus = "subscribed" | "unsubscribed" | "cleaned";

export type MailchimpMember = {
  email: string;
  name: string | null;
  status: MailchimpStatus;
  /** CONFIRM_TIME (double opt-in) if present, else OPTIN_TIME. */
  optInAt: string | null;
  /** UNSUB_TIME or CLEAN_TIME, by status. */
  leftAt: string | null;
};

export type LocalContact = {
  id: string;
  email: string;
  subscribed: boolean;
  unsubscribed_at: string | null;
  bounced_at: string | null;
  opt_in_at: string | null;
  opt_in_source: string | null;
};

export type ImportPlan = {
  inserts: TablesInsert<"contacts">[];
  updates: { id: string; email: string; patch: Partial<TablesInsert<"contacts">> }[];
  counts: {
    read: number;
    added: { subscribed: number; unsubscribed: number; cleaned: number };
    unsubscribed: number;
    bounced: number;
    evidenced: number;
    /** Subscribed in Mailchimp but off our list (unsubscribed or "not subscribed") — left off. */
    keptOff: number;
    unchanged: number;
  };
  /** Rows that couldn't be used, with why. */
  skipped: string[];
};

/** RFC 4180: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(raw: string): string[][] {
  const text = raw.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

/** "2024-03-05 14:22:10" (UTC) → ISO, or null. */
export function mailchimpTime(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? `${v.replace(" ", "T")}Z` : v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Which of the three export files a name is, by its prefix. Null for anything else in the folder. */
export function statusOfFile(fileName: string): MailchimpStatus | null {
  const name = fileName.toLowerCase();
  if (!name.endsWith(".csv")) return null;
  // "unsubscribed_…" before "subscribed_…", which it would otherwise also match
  if (name.startsWith("unsubscribed")) return "unsubscribed";
  if (name.startsWith("cleaned")) return "cleaned";
  if (name.startsWith("subscribed")) return "subscribed";
  return null;
}

/** One export file's rows → members. Unusable rows go to `skipped`. */
export function readExportFile(raw: string, status: MailchimpStatus, fileName: string, skipped: string[]): MailchimpMember[] {
  const [header, ...rows] = parseCsv(raw);
  if (!header) return [];
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const at = { email: col("Email Address"), first: col("First Name"), last: col("Last Name"), optin: col("OPTIN_TIME"), confirm: col("CONFIRM_TIME"), unsub: col("UNSUB_TIME"), clean: col("CLEAN_TIME") };
  if (at.email < 0) {
    skipped.push(`${fileName}: no "Email Address" column — not a Mailchimp audience export?`);
    return [];
  }
  const get = (row: string[], i: number) => (i >= 0 ? row[i]?.trim() ?? "" : "");
  return rows.flatMap((row, n): MailchimpMember[] => {
    const email = get(row, at.email).toLowerCase();
    if (!EMAIL_RE.test(email)) {
      skipped.push(`${fileName} row ${n + 2}: not an email address (${JSON.stringify(get(row, at.email).slice(0, 60))})`);
      return [];
    }
    const name = [get(row, at.first), get(row, at.last)].filter(Boolean).join(" ") || null;
    return [{
      email,
      name,
      status,
      optInAt: mailchimpTime(get(row, at.confirm)) ?? mailchimpTime(get(row, at.optin)),
      leftAt: status === "unsubscribed" ? mailchimpTime(get(row, at.unsub)) : status === "cleaned" ? mailchimpTime(get(row, at.clean)) : null,
    }];
  });
}

/** An address in more than one file keeps the most restrictive: unsubscribed, then cleaned, then subscribed. */
const RANK: Record<MailchimpStatus, number> = { unsubscribed: 0, cleaned: 1, subscribed: 2 };

export function planMailchimpImport(members: MailchimpMember[], locals: LocalContact[], now: Date = new Date()): ImportPlan {
  const stamp = now.toISOString();
  const byEmail = new Map<string, MailchimpMember>();
  for (const m of members) {
    const seen = byEmail.get(m.email);
    if (!seen || RANK[m.status] < RANK[seen.status]) byEmail.set(m.email, m);
  }
  const local = new Map(locals.map((c) => [c.email.trim().toLowerCase(), c]));

  const plan: ImportPlan = {
    inserts: [],
    updates: [],
    counts: { read: members.length, added: { subscribed: 0, unsubscribed: 0, cleaned: 0 }, unsubscribed: 0, bounced: 0, evidenced: 0, keptOff: 0, unchanged: 0 },
    skipped: [],
  };

  for (const m of byEmail.values()) {
    const evidence = m.optInAt ? { opt_in_at: m.optInAt, opt_in_source: "mailchimp", opt_in_wording: null } : {};
    const c = local.get(m.email);

    if (!c) {
      plan.counts.added[m.status]++;
      plan.inserts.push({
        email: m.email,
        name: m.name,
        source: "mailchimp",
        subscribed: m.status !== "unsubscribed",
        unsubscribed_at: m.status === "unsubscribed" ? m.leftAt ?? stamp : null,
        bounced_at: m.status === "cleaned" ? m.leftAt ?? stamp : null,
        ...(m.status === "unsubscribed" ? {} : evidence),
        crm_dirty_at: stamp,
      });
      continue;
    }

    const patch: Partial<TablesInsert<"contacts">> = {};
    if (m.status === "unsubscribed" && !c.unsubscribed_at) {
      Object.assign(patch, applyOptIn(c, { newsletter: "unsubscribed", reOptIn: false }, new Date(m.leftAt ?? stamp)), { crm_dirty_at: stamp });
      plan.counts.unsubscribed++;
    }
    if (m.status === "cleaned" && !c.bounced_at) {
      patch.bounced_at = m.leftAt ?? stamp;
      plan.counts.bounced++;
    }
    // Better evidence than none, or than Bigin's import date — but only for
    // someone on our list. Not for someone Mailchimp has as unsubscribed:
    // their opt-in is history, not consent. Nor for anyone off the list here
    // (unsubscribed, or "not subscribed"): an opt-in record beside "not
    // subscribed" reads in the CRM as if they were on the list, and if an
    // admin puts them on later, that console opt-in is the record.
    if (m.status !== "unsubscribed" && c.subscribed && !c.unsubscribed_at && m.optInAt && (!c.opt_in_at || c.opt_in_source === "bigin")) {
      Object.assign(patch, evidence);
      plan.counts.evidenced++;
    }
    if (m.status === "subscribed" && (c.unsubscribed_at || !c.subscribed)) plan.counts.keptOff++;

    if (Object.keys(patch).length) plan.updates.push({ id: c.id, email: c.email, patch });
    else plan.counts.unchanged++;
  }
  return plan;
}

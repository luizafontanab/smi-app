import { describe, expect, it } from "vitest";
import {
  mailchimpTime,
  parseCsv,
  planMailchimpImport,
  readExportFile,
  statusOfFile,
  type LocalContact,
  type MailchimpMember,
} from "../../scripts/lib/mailchimp-import";

/**
 * Gap review area 7 (GAPS B5.13): the reconcile's one hard rule is that it
 * never puts anyone back on the list — a mistake there mails someone who
 * unsubscribed, which is the PECR breach the import exists to prevent.
 */

const NOW = new Date("2026-10-21T12:00:00.000Z");

function member(over: Partial<MailchimpMember> = {}): MailchimpMember {
  return { email: "a@b.com", name: "Ada Byron", status: "subscribed", optInAt: "2024-03-05T14:22:10.000Z", leftAt: null, ...over };
}

function contact(over: Partial<LocalContact> = {}): LocalContact {
  return { id: "c1", email: "a@b.com", subscribed: true, unsubscribed_at: null, bounced_at: null, opt_in_at: null, opt_in_source: null, ...over };
}

describe("parseCsv", () => {
  it("handles quoted commas, doubled quotes, CRLF, a BOM and a trailing newline", () => {
    expect(parseCsv('﻿Email Address,Notes\r\na@b.com,"one, ""two"""\r\n\r\n')).toEqual([
      ["Email Address", "Notes"],
      ["a@b.com", 'one, "two"'],
    ]);
  });

  it("keeps a line break inside a quoted field", () => {
    expect(parseCsv('a,b\n1,"x\ny"')).toEqual([["a", "b"], ["1", "x\ny"]]);
  });
});

describe("mailchimpTime", () => {
  it("reads Mailchimp's space-separated time as UTC", () => {
    expect(mailchimpTime("2024-03-05 14:22:10")).toBe("2024-03-05T14:22:10.000Z");
  });
  it("is null for blank or junk", () => {
    expect(mailchimpTime("")).toBeNull();
    expect(mailchimpTime("not a date")).toBeNull();
  });
});

describe("statusOfFile", () => {
  it("tells the three files apart, unsubscribed before subscribed", () => {
    expect(statusOfFile("unsubscribed_email_audience_export_abc.csv")).toBe("unsubscribed");
    expect(statusOfFile("subscribed_members_export_abc.csv")).toBe("subscribed");
    expect(statusOfFile("Cleaned_members_export_abc.CSV")).toBe("cleaned");
    expect(statusOfFile("readme.txt")).toBeNull();
    expect(statusOfFile("segments.csv")).toBeNull();
  });
});

describe("readExportFile", () => {
  it("maps the columns, lowercases the address and prefers the confirm time", () => {
    const raw = "Email Address,First Name,Last Name,OPTIN_TIME,CONFIRM_TIME,UNSUB_TIME\n" +
      " Ada@B.com ,Ada,Byron,2024-03-05 14:00:00,2024-03-05 14:22:10,2025-01-02 09:00:00\n";
    const skipped: string[] = [];
    expect(readExportFile(raw, "unsubscribed", "u.csv", skipped)).toEqual([
      { email: "ada@b.com", name: "Ada Byron", status: "unsubscribed", optInAt: "2024-03-05T14:22:10.000Z", leftAt: "2025-01-02T09:00:00.000Z" },
    ]);
    expect(skipped).toEqual([]);
  });

  it("skips a row without a usable address, and a file without the email column, saying why", () => {
    const skipped: string[] = [];
    expect(readExportFile("Email Address\nnot-an-email\n", "subscribed", "s.csv", skipped)).toEqual([]);
    expect(readExportFile("Name\nAda\n", "subscribed", "x.csv", skipped)).toEqual([]);
    expect(skipped).toEqual([expect.stringContaining("s.csv row 2"), expect.stringContaining("x.csv: no \"Email Address\"")]);
  });
});

describe("planMailchimpImport", () => {
  it("never re-subscribes someone who unsubscribed or was taken off here", () => {
    const plan = planMailchimpImport(
      [member({ email: "un@b.com" }), member({ email: "off@b.com" })],
      [contact({ id: "c1", email: "un@b.com", subscribed: false, unsubscribed_at: "2026-01-01T00:00:00Z" }), contact({ id: "c2", email: "off@b.com", subscribed: false })],
      NOW,
    );
    // Neither gets Mailchimp's opt-in as evidence either: a consent record
    // beside "not subscribed" would read in the CRM as if they were on the list.
    expect(plan.updates).toEqual([]);
    expect(plan.counts.keptOff).toBe(2);
    expect(plan.counts.evidenced).toBe(0);
    expect(plan.counts.unchanged).toBe(2);
  });

  it("unsubscribes a Mailchimp opt-out still on our list, at Mailchimp's time, and marks it for Bigin", () => {
    const plan = planMailchimpImport([member({ status: "unsubscribed", leftAt: "2025-01-02T09:00:00.000Z" })], [contact()], NOW);
    expect(plan.updates).toEqual([{
      id: "c1",
      email: "a@b.com",
      patch: { subscribed: false, unsubscribed_at: "2025-01-02T09:00:00.000Z", crm_dirty_at: NOW.toISOString() },
    }]);
    expect(plan.counts.unsubscribed).toBe(1);
  });

  it("never restamps an existing unsubscribe", () => {
    const plan = planMailchimpImport([member({ status: "unsubscribed", leftAt: "2025-01-02T09:00:00.000Z" })], [contact({ subscribed: false, unsubscribed_at: "2020-01-01T00:00:00Z" })], NOW);
    expect(plan.updates).toEqual([]);
    expect(plan.counts.unchanged).toBe(1);
  });

  it("records a cleaned address as bounced, not unsubscribed, and doesn't push it to Bigin", () => {
    const plan = planMailchimpImport([member({ status: "cleaned", leftAt: "2025-06-01T00:00:00.000Z" })], [contact({ opt_in_at: "2026-10-01T00:00:00Z", opt_in_source: "site_form" })], NOW);
    expect(plan.updates).toEqual([{ id: "c1", email: "a@b.com", patch: { bounced_at: "2025-06-01T00:00:00.000Z" } }]);
  });

  it("adds Mailchimp-only people: subscribers with evidence, opt-outs suppressed, bounces bounced — all marked for Bigin", () => {
    const plan = planMailchimpImport([
      member({ email: "sub@b.com" }),
      member({ email: "un@b.com", status: "unsubscribed", leftAt: "2025-01-02T09:00:00.000Z" }),
      member({ email: "cl@b.com", status: "cleaned", leftAt: null }),
    ], [], NOW);
    const dirty = NOW.toISOString();
    expect(plan.inserts).toEqual([
      { email: "sub@b.com", name: "Ada Byron", source: "mailchimp", subscribed: true, unsubscribed_at: null, bounced_at: null, opt_in_at: "2024-03-05T14:22:10.000Z", opt_in_source: "mailchimp", opt_in_wording: null, crm_dirty_at: dirty },
      { email: "un@b.com", name: "Ada Byron", source: "mailchimp", subscribed: false, unsubscribed_at: "2025-01-02T09:00:00.000Z", bounced_at: null, crm_dirty_at: dirty },
      { email: "cl@b.com", name: "Ada Byron", source: "mailchimp", subscribed: true, unsubscribed_at: null, bounced_at: dirty, opt_in_at: "2024-03-05T14:22:10.000Z", opt_in_source: "mailchimp", opt_in_wording: null, crm_dirty_at: dirty },
    ]);
    expect(plan.counts.added).toEqual({ subscribed: 1, unsubscribed: 1, cleaned: 1 });
  });

  it("matches case-insensitively, so no duplicate is created", () => {
    const plan = planMailchimpImport([member({ email: "a@b.com" })], [contact({ email: "A@B.com", opt_in_at: "2026-10-01T00:00:00Z", opt_in_source: "console" })], NOW);
    expect(plan.inserts).toEqual([]);
    expect(plan.counts.unchanged).toBe(1);
  });

  it("replaces Bigin's import date with Mailchimp's opt-in, but never real evidence", () => {
    const plan = planMailchimpImport(
      [member({ email: "x@b.com" }), member({ email: "y@b.com" })],
      [contact({ id: "c1", email: "x@b.com", opt_in_at: "2026-10-07T00:00:00Z", opt_in_source: "bigin" }), contact({ id: "c2", email: "y@b.com", opt_in_at: "2026-10-10T00:00:00Z", opt_in_source: "site_form" })],
      NOW,
    );
    expect(plan.updates.map((u) => u.id)).toEqual(["c1"]);
    expect(plan.updates[0].patch).toMatchObject({ opt_in_source: "mailchimp", opt_in_at: "2024-03-05T14:22:10.000Z" });
  });

  it("an address in two files keeps the stricter status", () => {
    const plan = planMailchimpImport([
      member({ status: "subscribed" }),
      member({ status: "unsubscribed", leftAt: "2025-01-02T09:00:00.000Z" }),
      member({ status: "cleaned" }),
    ], [], NOW);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({ subscribed: false, unsubscribed_at: "2025-01-02T09:00:00.000Z" });
  });
});

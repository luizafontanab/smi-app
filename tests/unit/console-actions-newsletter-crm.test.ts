import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addContact, createIssue, previewBiginPull, runBiginSync, saveContact, scheduleIssue, searchBiginCompanies, sendIssue, unscheduleIssue,
} from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole, enqueue, syncContactToCrm, crm, saveLastRun } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  enqueue: vi.fn(async () => {}),
  syncContactToCrm: vi.fn(async () => {}),
  crm: {
    sync: vi.fn(async (): Promise<unknown> => ({})),
    pull: vi.fn(async (): Promise<unknown> => null),
    searchCompanies: vi.fn(async (): Promise<{ id: string; name: string }[]> => []),
  },
  saveLastRun: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/jobs", () => ({ enqueue }));
vi.mock("@/lib/adapters/crm", () => ({ getCrmSync: vi.fn(() => crm), syncContactToCrm, saveLastRun }));

afterEach(() => {
  resetDbServerMocks();
  enqueue.mockReset().mockResolvedValue(undefined);
  syncContactToCrm.mockReset().mockResolvedValue(undefined);
  saveLastRun.mockReset().mockResolvedValue(undefined);
  crm.sync.mockReset().mockResolvedValue({});
  crm.pull.mockReset().mockResolvedValue(null);
  crm.searchCompanies.mockReset().mockResolvedValue([]);
});

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function db(map: Record<string, () => ReturnType<typeof queryBuilder>>) {
  const from = fromByTable(map, () => queryBuilder(dbOk(null)));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  return from;
}

describe("createIssue", () => {
  it("numbers a first issue from 47, and links the chosen stories in order", async () => {
    const issuesBuilder = queryBuilder(dbOk({ id: "iss1" }));
    const itemsBuilder = queryBuilder(dbOk(null));
    db({ newsletter_issues: () => issuesBuilder, newsletter_items: () => itemsBuilder });

    const fd = form({});
    fd.append("stories", "s1");
    fd.append("stories", "s2");
    await createIssue(fd);

    expect(issuesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ number: 47, web_slug: "issue-47" }));
    expect(itemsBuilder.insert).toHaveBeenCalledWith([
      { issue_id: "iss1", story_id: "s1", position: 0 },
      { issue_id: "iss1", story_id: "s2", position: 1 },
    ]);
  });

  it("continues numbering from the last issue", async () => {
    type Last = { number: number };
    type Created = { id: string };
    const issuesBuilder: ReturnType<typeof queryBuilder<Last | Created>> = queryBuilder<Last | Created>(() => {
      const inserts = (issuesBuilder.insert as ReturnType<typeof vi.fn>).mock.calls;
      return inserts.length ? dbOk<Created>({ id: "iss2" }) : dbOk<Last>({ number: 50 });
    });
    db({ newsletter_issues: () => issuesBuilder });

    await createIssue(form({}));

    expect(issuesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ number: 51 }));
  });
});

describe("sendIssue", () => {
  it("clears a prior send failure, drops back to draft, and enqueues the send", async () => {
    const issuesBuilder = queryBuilder(dbOk(null));
    db({ newsletter_issues: () => issuesBuilder });

    await sendIssue(form({ id: "iss1" }));

    expect(issuesBuilder.update).toHaveBeenCalledWith({ status: "draft", send_error: null });
    expect(issuesBuilder.eq).toHaveBeenCalledWith("status", "send_failed");
    expect(enqueue).toHaveBeenCalledWith("newsletter_send", { issue_id: "iss1" });
  });
});

describe("scheduleIssue", () => {
  it("does nothing without a scheduled time", async () => {
    const from = db({});
    await scheduleIssue(form({ id: "iss1" }));
    expect(from).not.toHaveBeenCalled();
  });

  it("schedules the issue and enqueues the send for that time", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ newsletter_issues: () => builder });

    await scheduleIssue(form({ id: "iss1", scheduled_at: "2026-09-01T09:00" }));

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(enqueue).toHaveBeenCalledWith("newsletter_send", { issue_id: "iss1" }, expect.any(Date));
  });
});

describe("unscheduleIssue", () => {
  it("cancels the pending job and reverts the issue to draft", async () => {
    const jobsBuilder = queryBuilder(dbOk(null));
    const issuesBuilder = queryBuilder(dbOk(null));
    db({ jobs: () => jobsBuilder, newsletter_issues: () => issuesBuilder });

    await unscheduleIssue(form({ id: "iss1" }));

    expect(jobsBuilder.delete).toHaveBeenCalled();
    expect(issuesBuilder.update).toHaveBeenCalledWith({ status: "draft", scheduled_at: null });
  });
});

describe("saveContact", () => {
  it("does nothing without an id", async () => {
    const from = db({});
    await saveContact(form({}));
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects an invalid email without writing anything", async () => {
    db({ contacts: () => queryBuilder(dbOk({ id: "c1", email: "old@example.com" })) });
    await expect(saveContact(form({ id: "c1", email: "nope", newsletter: "subscribed" })))
      .rejects.toThrow(/not%20a%20valid%20email/);
  });

  it("refuses to reassign an email already used by another contact", async () => {
    // first call to "contacts": the contact lookup; second: the clash lookup
    let call = 0;
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ contacts: () => queryBuilder(() =>
        call++ === 0 ? dbOk({ id: "c1", email: "old@example.com", subscribed: true, unsubscribed_at: null }) : dbOk({ id: "c2" }),
      ) }, () => queryBuilder(dbOk(null))),
    })));

    await expect(saveContact(form({ id: "c1", email: "new@example.com", newsletter: "subscribed" })))
      .rejects.toThrow(/already%20on%20another%20contact/);
  });

  it("updates the contact and pushes the change through to the CRM", async () => {
    const contactsBuilder = queryBuilder(dbOk({ id: "c1", email: "same@example.com", subscribed: true, unsubscribed_at: null }));
    db({ contacts: () => contactsBuilder });

    await expect(saveContact(form({ id: "c1", email: "same@example.com", name: "Acme", newsletter: "subscribed" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/crm?saved=1");

    expect(contactsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ email: "same@example.com", name: "Acme" }));
    // the whole row goes to Bigin by id; the name changed, so its fields go too
    expect(syncContactToCrm).toHaveBeenCalledWith("c1", { nameChanged: true, reOptIn: false });
  });

  it("does not resend the name to Bigin when it wasn't edited", async () => {
    db({ contacts: () => queryBuilder(dbOk({ id: "c1", email: "same@example.com", name: "Acme", subscribed: true, unsubscribed_at: null })) });
    await expect(saveContact(form({ id: "c1", email: "same@example.com", name: "Acme", newsletter: "subscribed" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/crm?saved=1");
    expect(syncContactToCrm).toHaveBeenCalledWith("c1", { nameChanged: false, reOptIn: false });
  });

  it("tells Bigin about an explicit re-opt-in, the one case that clears its opt-out", async () => {
    db({ contacts: () => queryBuilder(dbOk({ id: "c1", email: "a@example.com", name: null, subscribed: false, unsubscribed_at: "2026-01-01T00:00:00Z" })) });
    await expect(saveContact(form({ id: "c1", email: "a@example.com", newsletter: "subscribed", re_opt_in: "on" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/crm?saved=1");
    expect(syncContactToCrm).toHaveBeenCalledWith("c1", expect.objectContaining({ reOptIn: true }));
  });

  it("saves the Bigin company chosen in the picker, and clears it when unlinked", async () => {
    const contactsBuilder = queryBuilder(dbOk({ id: "c1", email: "a@example.com", name: null, subscribed: true, unsubscribed_at: null }));
    db({ contacts: () => contactsBuilder });

    await expect(saveContact(form({ id: "c1", email: "a@example.com", newsletter: "subscribed", bigin_company_id: "900", bigin_company_name: "Acme" })))
      .rejects.toThrow("NEXT_REDIRECT");
    await expect(saveContact(form({ id: "c1", email: "a@example.com", newsletter: "subscribed", bigin_company_id: "", bigin_company_name: "" })))
      .rejects.toThrow("NEXT_REDIRECT");
    await expect(saveContact(form({ id: "c1", email: "a@example.com", newsletter: "subscribed" })))
      .rejects.toThrow("NEXT_REDIRECT");

    const updates = (contactsBuilder.update as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(updates[0]).toMatchObject({ bigin_company_id: "900", bigin_company_name: "Acme" });
    expect(updates[1]).toMatchObject({ bigin_company_id: null, bigin_company_name: null });
    expect(updates[2]).not.toHaveProperty("bigin_company_id"); // no picker on the form → link untouched
  });

  it("reports a race-lost unique-email conflict in the same friendly words", async () => {
    type Contact = { id: string; email: string; subscribed: boolean; unsubscribed_at: string | null };
    const contactsBuilder: ReturnType<typeof queryBuilder<Contact>> = queryBuilder<Contact>(() => {
      const updates = (contactsBuilder.update as ReturnType<typeof vi.fn>).mock.calls;
      return updates.length
        ? (dbError("duplicate", { code: "23505" }) as DbResult<Contact>)
        : dbOk<Contact>({ id: "c1", email: "same@example.com", subscribed: true, unsubscribed_at: null });
    });
    db({ contacts: () => contactsBuilder });

    await expect(saveContact(form({ id: "c1", email: "same@example.com", newsletter: "subscribed" })))
      .rejects.toThrow(/already%20on%20another%20contact/);
  });
});

describe("addContact", () => {
  it("does nothing without an email", async () => {
    const from = db({});
    await addContact(form({ email: "" }));
    expect(from).not.toHaveBeenCalled();
  });

  it("does not duplicate an existing contact, or push it to the CRM again", async () => {
    const contactsBuilder = queryBuilder(dbOk({ id: "c1" }));
    db({ contacts: () => contactsBuilder });
    await addContact(form({ email: "existing@example.com" }));
    expect(contactsBuilder.insert).not.toHaveBeenCalled();
    expect(syncContactToCrm).not.toHaveBeenCalled();
  });

  it("creates a new contact and pushes the whole row to the CRM by id", async () => {
    let call = 0;
    // 1: the existing-email lookup (none), 2: the insert returning the new id
    const contactsBuilder = queryBuilder(() => (call++ === 0 ? dbOk(null) : dbOk({ id: "c-new" })));
    db({ contacts: () => contactsBuilder });

    await addContact(form({ email: "new@example.com", name: " Ada Byron ", company: "Acme" }));

    expect(contactsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ email: "new@example.com", name: "Ada Byron", company: "Acme", source: "console" }));
    expect(syncContactToCrm).toHaveBeenCalledWith("c-new");
  });
});

describe("Bigin console actions", () => {
  it("searchBiginCompanies passes the term through, and answers empty rather than erroring when Bigin fails", async () => {
    crm.searchCompanies.mockResolvedValueOnce([{ id: "900", name: "Acme" }]);
    expect(await searchBiginCompanies("Acm")).toEqual([{ id: "900", name: "Acme" }]);
    expect(crm.searchCompanies).toHaveBeenCalledWith("Acm");

    vi.spyOn(console, "error").mockImplementation(() => {});
    crm.searchCompanies.mockRejectedValueOnce(new Error("Bigin down"));
    expect(await searchBiginCompanies("Acm")).toEqual([]);
  });

  it("previewBiginPull is a dry run that may include the first import, and records it as a preview", async () => {
    crm.pull.mockResolvedValueOnce({ inserted: 3 });
    await expect(previewBiginPull()).rejects.toThrow("NEXT_REDIRECT:/console/crm?synced=preview");
    expect(crm.pull).toHaveBeenCalledWith({ dryRun: true, allowFirstImport: true });
    expect(saveLastRun).toHaveBeenCalledWith(expect.objectContaining({ preview: true, pulled: { inserted: 3 } }));
  });

  it("runBiginSync is the only path allowed to run the first import", async () => {
    await expect(runBiginSync()).rejects.toThrow("NEXT_REDIRECT:/console/crm?synced=1");
    expect(crm.sync).toHaveBeenCalledWith({ allowFirstImport: true });
  });

  it("runBiginSync reports a failure on the page instead of throwing it", async () => {
    crm.sync.mockRejectedValueOnce(new Error("1 of 1 pending pushes failed"));
    await expect(runBiginSync()).rejects.toThrow(/console\/crm\?error=Bigin%20sync%20finished%20with%20a%20problem/);
  });
});

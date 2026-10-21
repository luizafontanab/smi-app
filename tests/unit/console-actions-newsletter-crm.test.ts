import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addContact, approveIssue, attachNewsletterAd, createIssue, placeNewsletterAd, previewBiginPull, runBiginSync, saveContact, saveProofChecks, scheduleIssue,
  searchBiginCompanies, searchIssueContent, sendIssue, sendTestIssue, unscheduleIssue, updateIssue, withdrawApproval,
} from "@/app/console/actions";
import { PROOF_KEYS } from "@/lib/newsletter-proof";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole, enqueue, syncContactToCrm, crm, saveLastRun, firstImportDone, readLastRun } = vi.hoisted(() => ({
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
  firstImportDone: vi.fn(async () => true),
  readLastRun: vi.fn(async (): Promise<unknown> => null),
}));
const { renderIssueHtml, emailSend } = vi.hoisted(() => ({
  renderIssueHtml: vi.fn(async (): Promise<{ subject: string; html: string; text: string } | null> => null),
  emailSend: vi.fn(async () => {}),
}));
vi.mock("@/lib/adapters/newsletter", () => ({ renderIssueHtml }));
vi.mock("@/lib/adapters/email", () => ({ getEmailSender: () => ({ send: emailSend }) }));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/jobs", () => ({ enqueue }));
vi.mock("@/lib/adapters/crm", () => ({ getCrmSync: vi.fn(() => crm), syncContactToCrm, saveLastRun, firstImportDone, readLastRun }));

afterEach(() => {
  resetDbServerMocks();
  renderIssueHtml.mockReset().mockResolvedValue(null);
  emailSend.mockReset().mockResolvedValue(undefined);
  enqueue.mockReset().mockResolvedValue(undefined);
  syncContactToCrm.mockReset().mockResolvedValue(undefined);
  saveLastRun.mockReset().mockResolvedValue(undefined);
  firstImportDone.mockReset().mockResolvedValue(true);
  readLastRun.mockReset().mockResolvedValue(null);
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
    const issuesBuilder = queryBuilder(dbOk({ approved_at: "2026-10-20T09:00:00Z" }));
    db({ newsletter_issues: () => issuesBuilder });

    await sendIssue(form({ id: "iss1", confirm: "1" }));

    expect(issuesBuilder.update).toHaveBeenCalledWith({ status: "draft", send_error: null });
    expect(issuesBuilder.eq).toHaveBeenCalledWith("status", "send_failed");
    expect(enqueue).toHaveBeenCalledWith("newsletter_send", { issue_id: "iss1" });
  });

  it("refuses without the ticked confirm, before reading anything", async () => {
    const from = db({});
    await expect(sendIssue(form({ id: "iss1" }))).rejects.toThrow("NEXT_REDIRECT:/console/newsletter/iss1?error=");
    expect(from).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses an issue that isn't approved to send", async () => {
    const issuesBuilder = queryBuilder(dbOk({ approved_at: null }));
    db({ newsletter_issues: () => issuesBuilder });

    await expect(sendIssue(form({ id: "iss1", confirm: "1" }))).rejects.toThrow("NEXT_REDIRECT:/console/newsletter/iss1?error=");
    expect(issuesBuilder.update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("scheduleIssue", () => {
  it("does nothing without a scheduled time", async () => {
    const from = db({});
    await scheduleIssue(form({ id: "iss1" }));
    expect(from).not.toHaveBeenCalled();
  });

  it("schedules the issue and enqueues the send for that time", async () => {
    const builder = queryBuilder(dbOk({ approved_at: "2026-10-20T09:00:00Z" }));
    db({ newsletter_issues: () => builder });

    await scheduleIssue(form({ id: "iss1", scheduled_at: "2026-09-01T09:00" }));

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(enqueue).toHaveBeenCalledWith("newsletter_send", { issue_id: "iss1" }, expect.any(Date));
  });

  it("refuses an issue that isn't approved to send", async () => {
    const builder = queryBuilder(dbOk({ approved_at: null }));
    db({ newsletter_issues: () => builder });

    await expect(scheduleIssue(form({ id: "iss1", scheduled_at: "2026-09-01T09:00" }))).rejects.toThrow("NEXT_REDIRECT:/console/newsletter/iss1?error=");
    expect(builder.update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

const ALL_TICKED = Object.fromEntries(PROOF_KEYS.map((key) => [key, true]));

describe("approveIssue", () => {
  it("records who approved it and the audience count, once the proof is complete and tested", async () => {
    const issuesBuilder = queryBuilder(dbOk({ status: "draft", proof_checks: ALL_TICKED, last_test_sent_at: "2026-10-20T08:00:00Z" }));
    const contactsBuilder = queryBuilder({ data: null, error: null, count: 2712 } as DbResult<null>);
    db({ newsletter_issues: () => issuesBuilder, contacts: () => contactsBuilder });

    await approveIssue(form({ id: "iss1" }));

    expect(issuesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      approved_by: "admin1", approved_recipients: 2712, approved_at: expect.any(String),
    }));
  });

  it("refuses while any proof item is unticked", async () => {
    const allButOne: Record<string, boolean> = { ...ALL_TICKED };
    delete allButOne.audience;
    const issuesBuilder = queryBuilder(dbOk({ status: "draft", proof_checks: allButOne, last_test_sent_at: "2026-10-20T08:00:00Z" }));
    db({ newsletter_issues: () => issuesBuilder });

    await expect(approveIssue(form({ id: "iss1" }))).rejects.toThrow("1%20proof%20item%20is%20still%20unticked");
    expect(issuesBuilder.update).not.toHaveBeenCalled();
  });

  it("refuses with no test sent since the last change", async () => {
    const issuesBuilder = queryBuilder(dbOk({ status: "draft", proof_checks: ALL_TICKED, last_test_sent_at: null }));
    db({ newsletter_issues: () => issuesBuilder });

    await expect(approveIssue(form({ id: "iss1" }))).rejects.toThrow("send%20a%20test");
    expect(issuesBuilder.update).not.toHaveBeenCalled();
  });

  it("refuses an issue that has already been sent", async () => {
    const issuesBuilder = queryBuilder(dbOk({ status: "sent", proof_checks: ALL_TICKED, last_test_sent_at: "2026-10-20T08:00:00Z" }));
    db({ newsletter_issues: () => issuesBuilder });

    await expect(approveIssue(form({ id: "iss1" }))).rejects.toThrow("NEXT_REDIRECT:/console/newsletter/iss1?error=");
    expect(issuesBuilder.update).not.toHaveBeenCalled();
  });
});

describe("withdrawApproval", () => {
  it("clears the approval, and pulls a scheduled issue back to draft with its job cancelled", async () => {
    const issuesBuilder = queryBuilder(dbOk({ status: "scheduled" }));
    const jobsBuilder = queryBuilder(dbOk(null));
    db({ newsletter_issues: () => issuesBuilder, jobs: () => jobsBuilder });

    await withdrawApproval(form({ id: "iss1" }));

    expect(jobsBuilder.delete).toHaveBeenCalled();
    expect(jobsBuilder.filter).toHaveBeenCalledWith("payload->>issue_id", "eq", "iss1");
    expect(issuesBuilder.update).toHaveBeenCalledWith({
      approved_at: null, approved_by: null, approved_recipients: null, status: "draft", scheduled_at: null,
    });
  });

  it("leaves a draft a draft", async () => {
    const issuesBuilder = queryBuilder(dbOk({ status: "draft" }));
    const jobs = vi.fn();
    db({ newsletter_issues: () => issuesBuilder, jobs });

    await withdrawApproval(form({ id: "iss1" }));

    expect(jobs).not.toHaveBeenCalled();
    expect(issuesBuilder.update).toHaveBeenCalledWith({ approved_at: null, approved_by: null, approved_recipients: null });
  });
});

describe("saveProofChecks", () => {
  it("stores only known keys", async () => {
    const issuesBuilder = queryBuilder(dbOk({ status: "draft", approved_at: null }));
    db({ newsletter_issues: () => issuesBuilder });
    const fd = form({ id: "iss1" });
    fd.append("checks", "story_links");
    fd.append("checks", "not_a_real_key");

    await saveProofChecks(fd);

    expect(issuesBuilder.update).toHaveBeenCalledWith({ proof_checks: { story_links: true } });
  });

  it("withdraws the approval when an approved issue loses a tick", async () => {
    const issuesBuilder = queryBuilder(dbOk({ status: "draft", approved_at: "2026-10-20T09:00:00Z" }));
    db({ newsletter_issues: () => issuesBuilder });
    const fd = form({ id: "iss1" });
    fd.append("checks", "story_links");

    await saveProofChecks(fd);

    expect(issuesBuilder.update).toHaveBeenCalledWith({ approved_at: null, approved_by: null, approved_recipients: null });
  });

  it("keeps the approval when the proof stays complete", async () => {
    const issuesBuilder = queryBuilder(dbOk({ status: "draft", approved_at: "2026-10-20T09:00:00Z" }));
    db({ newsletter_issues: () => issuesBuilder });
    const fd = form({ id: "iss1" });
    for (const key of PROOF_KEYS) fd.append("checks", key);

    await saveProofChecks(fd);

    expect(issuesBuilder.update).toHaveBeenCalledTimes(1);
    expect(issuesBuilder.update).toHaveBeenCalledWith({ proof_checks: ALL_TICKED });
  });
});

describe("edits withdraw approval", () => {
  it("updateIssue clears approval and the test stamp, keeps the ticks, and unschedules a scheduled issue", async () => {
    const issuesBuilder = queryBuilder(dbOk({ status: "scheduled" }));
    const itemsBuilder = queryBuilder(dbOk(null));
    const jobsBuilder = queryBuilder(dbOk(null));
    db({ newsletter_issues: () => issuesBuilder, newsletter_items: () => itemsBuilder, jobs: () => jobsBuilder });

    await updateIssue(form({ id: "iss1", subject: "October", intro: "" }));

    expect(jobsBuilder.delete).toHaveBeenCalled();
    const cleared = vi.mocked(issuesBuilder.update as ReturnType<typeof vi.fn>).mock.calls.map(([v]) => v)
      .find((v) => "approved_at" in (v as object));
    expect(cleared).toEqual(expect.objectContaining({
      last_edited_by: "admin1", approved_at: null, approved_by: null, approved_recipients: null,
      last_test_sent_at: null, last_test_sent_by: null, status: "draft", scheduled_at: null,
    }));
    expect(cleared).not.toHaveProperty("proof_checks");
  });

  it("attaching an advert withdraws approval too", async () => {
    const issuesBuilder = queryBuilder(dbOk({ status: "draft" }));
    const adsBuilder = queryBuilder(dbOk(null));
    db({ newsletter_issues: () => issuesBuilder, newsletter_ads: () => adsBuilder });

    await attachNewsletterAd(form({ issue_id: "iss1", advert_id: "ad1" }));

    expect(issuesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ approved_at: null, last_test_sent_at: null }));
    expect(issuesBuilder.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }));
  });
});

describe("issue layout (gap review area 5)", () => {
  const OLD = "11111111-1111-4111-8111-111111111111";
  const VID = "22222222-2222-4222-8222-222222222222";
  const NEW = "33333333-3333-4333-8333-333333333333";

  it("updateIssue saves the posted order, stories and videos mixed, including an item older than the picker shows", async () => {
    const issuesBuilder = queryBuilder(dbOk({ status: "draft" }));
    const itemsBuilder = queryBuilder(dbOk(null));
    db({ newsletter_issues: () => issuesBuilder, newsletter_items: () => itemsBuilder });
    const fd = form({ id: "iss1", subject: "November", intro: "", preview_text: "  Ten stories, one show  " });
    for (const item of [`video:${VID}`, `story:${OLD}`, `story:${NEW}`, "story:junk"]) fd.append("items", item);

    await updateIssue(fd);

    expect(itemsBuilder.delete).toHaveBeenCalled();
    expect(itemsBuilder.insert).toHaveBeenCalledWith([
      { issue_id: "iss1", video_id: VID, position: 0 },
      { issue_id: "iss1", story_id: OLD, position: 1 },
      { issue_id: "iss1", story_id: NEW, position: 2 },
    ]);
    expect(issuesBuilder.update).toHaveBeenCalledWith({ subject: "November", intro: "", preview_text: "Ten stories, one show" });
  });

  it("updateIssue stores blank preview text as null", async () => {
    const issuesBuilder = queryBuilder(dbOk({ status: "draft" }));
    db({ newsletter_issues: () => issuesBuilder, newsletter_items: () => queryBuilder(dbOk(null)) });

    await updateIssue(form({ id: "iss1", subject: "November", intro: "", preview_text: " " }));

    expect(issuesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ preview_text: null }));
  });

  it("createIssue still takes the two checklists, stories first", async () => {
    const itemsBuilder = queryBuilder(dbOk(null));
    db({ newsletter_issues: () => queryBuilder(dbOk({ id: "iss9", number: 51 })), newsletter_items: () => itemsBuilder });
    const fd = form({ subject: "December" });
    fd.append("videos", VID);
    fd.append("stories", OLD);

    await createIssue(fd);

    expect(itemsBuilder.insert).toHaveBeenCalledWith([
      { issue_id: "iss9", story_id: OLD, position: 0 },
      { issue_id: "iss9", video_id: VID, position: 1 },
    ]);
  });

  it("placeNewsletterAd sets an advert's place and withdraws approval", async () => {
    const issuesBuilder = queryBuilder(dbOk({ status: "draft" }));
    const adsBuilder = queryBuilder(dbOk(null));
    db({ newsletter_issues: () => issuesBuilder, newsletter_ads: () => adsBuilder });

    await placeNewsletterAd(form({ issue_id: "iss1", advert_id: "ad1", after_item: "5" }));

    expect(adsBuilder.update).toHaveBeenCalledWith({ after_item: 5 });
    expect(adsBuilder.eq).toHaveBeenCalledWith("advert_id", "ad1");
    expect(issuesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ approved_at: null }));
  });

  it("placeNewsletterAd turns a blank place back to automatic", async () => {
    const adsBuilder = queryBuilder(dbOk(null));
    db({ newsletter_issues: () => queryBuilder(dbOk({ status: "draft" })), newsletter_ads: () => adsBuilder });

    await placeNewsletterAd(form({ issue_id: "iss1", advert_id: "ad1", after_item: "" }));

    expect(adsBuilder.update).toHaveBeenCalledWith({ after_item: null });
  });

  it.each(["0", "2.5", "three"])("placeNewsletterAd rejects %j without writing", async (value) => {
    const adsBuilder = queryBuilder(dbOk(null));
    db({ newsletter_issues: () => queryBuilder(dbOk({ status: "draft" })), newsletter_ads: () => adsBuilder });

    await expect(placeNewsletterAd(form({ issue_id: "iss1", advert_id: "ad1", after_item: value }))).rejects.toThrow("NEXT_REDIRECT:/console/newsletter/iss1?error=");
    expect(adsBuilder.update).not.toHaveBeenCalled();
  });

  it("placeNewsletterAd refuses a sent issue", async () => {
    const adsBuilder = queryBuilder(dbOk(null));
    db({ newsletter_issues: () => queryBuilder(dbOk({ status: "sent" })), newsletter_ads: () => adsBuilder });

    await expect(placeNewsletterAd(form({ issue_id: "iss1", advert_id: "ad1", after_item: "2" }))).rejects.toThrow("NEXT_REDIRECT:/console/newsletter/iss1?error=");
    expect(adsBuilder.update).not.toHaveBeenCalled();
  });

  it("attachNewsletterAd allows one association logo per issue — the masthead has room for one", async () => {
    const adsBuilder = queryBuilder(dbOk([{ advert: { format: "association_logo" } }]));
    db({
      newsletter_issues: () => queryBuilder(dbOk({ status: "draft" })),
      adverts: () => queryBuilder(dbOk({ format: "association_logo" })),
      newsletter_ads: () => adsBuilder,
    });

    await expect(attachNewsletterAd(form({ issue_id: "iss1", advert_id: "logo2" }))).rejects.toThrow("NEXT_REDIRECT:/console/newsletter/iss1?error=");
    expect(adsBuilder.insert).not.toHaveBeenCalled();
  });

  it("attachNewsletterAd still adds a banner next to an association logo", async () => {
    const adsBuilder = queryBuilder(dbOk([{ advert: { format: "association_logo" } }]));
    db({
      newsletter_issues: () => queryBuilder(dbOk({ status: "draft" })),
      adverts: () => queryBuilder(dbOk({ format: "newsletter_banner" })),
      newsletter_ads: () => adsBuilder,
    });

    await attachNewsletterAd(form({ issue_id: "iss1", advert_id: "banner1" }));

    expect(adsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ advert_id: "banner1" }));
  });

  it("searchIssueContent searches published titles since a date, with LIKE wildcards escaped, newest first", async () => {
    const storiesBuilder = queryBuilder(dbOk([
      { id: "s1", title: "100% laser", published_at: "2025-03-01T09:00:00Z", status: "published" },
    ]));
    const videosBuilder = queryBuilder(dbOk([
      { id: "v1", title: "100% laser, filmed", published_at: "2025-04-01T09:00:00Z", status: "published" },
    ]));
    db({ stories: () => storiesBuilder, videos: () => videosBuilder });

    const found = await searchIssueContent(" 100%_laser ", "2025-01-01");

    expect(storiesBuilder.eq).toHaveBeenCalledWith("status", "published");
    expect(storiesBuilder.ilike).toHaveBeenCalledWith("title", "%100\\%\\_laser%");
    expect(storiesBuilder.gte).toHaveBeenCalledWith("published_at", "2025-01-01");
    expect(found.map((r) => [r.kind, r.id])).toEqual([["video", "v1"], ["story", "s1"]]);
  });

  it("searchIssueContent ignores a malformed date and an empty term", async () => {
    const storiesBuilder = queryBuilder(dbOk([]));
    db({ stories: () => storiesBuilder, videos: () => queryBuilder(dbOk([])) });

    await searchIssueContent("", "yesterday");

    expect(storiesBuilder.ilike).not.toHaveBeenCalled();
    expect(storiesBuilder.gte).not.toHaveBeenCalled();
  });

  it("searchIssueContent requires the console", async () => {
    requireConsole.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login"));
    await expect(searchIssueContent("laser", "")).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("sendTestIssue", () => {
  it("emails the signed-in admin a [TEST] copy with a working unsubscribe link, and records it", async () => {
    const issuesBuilder = queryBuilder(dbOk({ status: "draft" }));
    db({ newsletter_issues: () => issuesBuilder });
    renderIssueHtml.mockResolvedValue({ subject: "October", html: "<p>hi</p>", text: "hi" });

    await expect(sendTestIssue(form({ id: "iss1" }))).rejects.toThrow("NEXT_REDIRECT:/console/newsletter/iss1?tested=1");

    expect(renderIssueHtml).toHaveBeenCalledWith("iss1", { unsubscribeUrl: expect.stringMatching(/\/unsubscribe$/) });
    expect(emailSend).toHaveBeenCalledWith({ to: "jas@smi.local", subject: "[TEST] October", html: "<p>hi</p>", text: "hi" });
    expect(issuesBuilder.update).toHaveBeenCalledWith({ last_test_sent_at: expect.any(String), last_test_sent_by: "admin1" });
  });

  it("records nothing when the email provider refuses", async () => {
    const issuesBuilder = queryBuilder(dbOk({ status: "draft" }));
    db({ newsletter_issues: () => issuesBuilder });
    renderIssueHtml.mockResolvedValue({ subject: "October", html: "<p>hi</p>", text: "hi" });
    emailSend.mockRejectedValueOnce(new Error("403 domain not verified"));

    await expect(sendTestIssue(form({ id: "iss1" }))).rejects.toThrow("NEXT_REDIRECT:/console/newsletter/iss1?error=");
    expect(issuesBuilder.update).not.toHaveBeenCalled();
  });

  it("refuses a sent issue without sending anything", async () => {
    const issuesBuilder = queryBuilder(dbOk({ status: "sent" }));
    db({ newsletter_issues: () => issuesBuilder });

    await expect(sendTestIssue(form({ id: "iss1" }))).rejects.toThrow("NEXT_REDIRECT:/console/newsletter/iss1?error=");
    expect(emailSend).not.toHaveBeenCalled();
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

  it("runBiginSync is the only path allowed to run the first import — straight after a preview", async () => {
    firstImportDone.mockResolvedValueOnce(false);
    readLastRun.mockResolvedValueOnce({ at: new Date(Date.now() - 5 * 60_000).toISOString(), preview: true, pulled: { inserted: 3 }, pushed: 0, pushFailed: 0, watch: "skipped" });
    await expect(runBiginSync()).rejects.toThrow("NEXT_REDIRECT:/console/crm?synced=1");
    expect(crm.sync).toHaveBeenCalledWith({ allowFirstImport: true });
  });

  // The preview rule used to exist only in which button the page showed; the
  // action is POST-reachable and always passed allowFirstImport: true.
  it("refuses the first import with no preview, without syncing", async () => {
    firstImportDone.mockResolvedValueOnce(false);
    await expect(runBiginSync()).rejects.toThrow(/NEXT_REDIRECT:\/console\/crm\?error=Preview%20the%20import%20first/);
    expect(crm.sync).not.toHaveBeenCalled();
  });

  it("refuses the first import when the preview is over an hour old", async () => {
    firstImportDone.mockResolvedValueOnce(false);
    readLastRun.mockResolvedValueOnce({ at: new Date(Date.now() - 61 * 60_000).toISOString(), preview: true, pulled: { inserted: 3 }, pushed: 0, pushFailed: 0, watch: "skipped" });
    await expect(runBiginSync()).rejects.toThrow(/error=Preview%20the%20import%20first/);
    expect(crm.sync).not.toHaveBeenCalled();
  });

  it("refuses the first import when the last run was a real sync, not a preview", async () => {
    firstImportDone.mockResolvedValueOnce(false);
    readLastRun.mockResolvedValueOnce({ at: new Date().toISOString(), preview: false, pulled: null, pushed: 0, pushFailed: 0, watch: "skipped" });
    await expect(runBiginSync()).rejects.toThrow(/error=Preview%20the%20import%20first/);
    expect(crm.sync).not.toHaveBeenCalled();
  });

  it("once imported, a sync needs no preview and doesn't ask for the first import", async () => {
    await expect(runBiginSync()).rejects.toThrow("NEXT_REDIRECT:/console/crm?synced=1");
    expect(crm.sync).toHaveBeenCalledWith({ allowFirstImport: false });
  });

  it("runBiginSync reports a failure on the page instead of throwing it", async () => {
    crm.sync.mockRejectedValueOnce(new Error("1 of 1 pending pushes failed"));
    await expect(runBiginSync()).rejects.toThrow(/console\/crm\?error=Bigin%20sync%20finished%20with%20a%20problem/);
  });
});

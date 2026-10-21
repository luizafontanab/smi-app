// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import IssueDetail from "@/app/console/newsletter/[id]/page";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
vi.mock("@/lib/auth", () => ({ requireConsole: vi.fn(async () => ({ userId: "admin1", role: "admin" })) }));
vi.mock("@/lib/adapters/newsletter", () => ({ renderIssueHtml: vi.fn(async () => null) }));

afterEach(() => resetDbServerMocks());

const ISSUE_ID = "11111111-1111-4111-8111-111111111111";
const props = { params: Promise.resolve({ id: ISSUE_ID }), searchParams: Promise.resolve({}) } as never;

const row = (id: string, title: string, status = "published") => ({ id, title, published_at: "2026-01-05T09:00:00Z", status });

describe("/console/newsletter/[id] story picker", () => {
  it("lists every picked item in issue order, lead first, even one outside the latest 20", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({
        newsletter_issues: () => queryBuilder(dbOk({
          id: ISSUE_ID, number: 48, subject: "October", intro: "", status: "draft", sent_count: null, opens_count: 0, clicks_count: 0,
        })),
        newsletter_items: () => queryBuilder(dbOk([
          { position: 0, story_id: "old", video_id: null, story: row("old", "Older story"), video: null },
          { position: 1, story_id: null, video_id: "gone", story: null, video: row("gone", "Withdrawn video", "withdrawn") },
        ])),
        newsletter_ads: () => queryBuilder(dbOk([])),
        adverts: () => queryBuilder(dbOk([])),
        // The recent window: neither picked item is in it.
        stories: () => queryBuilder(dbOk([row("new", "Newer story")])),
        videos: () => queryBuilder(dbOk([])),
        contacts: () => queryBuilder({ data: null, error: null, count: 0 }),
      }),
    })));

    const { container } = render(await IssueDetail(props));

    // Posted in order, so a save keeps both, the old one as the lead.
    const posted = [...container.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="items"]')].map((i) => i.value);
    expect(posted).toEqual(["story:old", "video:gone"]);
    expect(screen.getByRole("button", { name: "Move Older story up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Withdrawn video down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove Withdrawn video" }).closest("li")).toHaveTextContent("not live");
    // The recent one is offered to add, not already in.
    expect(screen.getByRole("button", { name: "Add Newer story" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Older story" })).toBeNull();
  });
});

describe("/console/newsletter/[id] proof and approval", () => {
  // newsletter_issues answers both the issue read and the "last sent issue"
  // read, so the first call gets the issue and the second the baseline.
  function stubIssue(issue: Record<string, unknown>, lastSent: { number: number; sent_count: number } | null) {
    let issueReads = 0;
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({
        newsletter_issues: () => queryBuilder(dbOk(issueReads++ === 0 ? {
          id: ISSUE_ID, number: 49, subject: "November", intro: "", status: "draft", sent_count: null, opens_count: 0, clicks_count: 0,
          proof_checks: {}, last_test_sent_at: null, last_test_sent_by: null, approved_at: null, approved_by: null, approved_recipients: null,
          ...issue,
        } : lastSent)),
        newsletter_items: () => queryBuilder(dbOk([])),
        newsletter_ads: () => queryBuilder(dbOk([])),
        adverts: () => queryBuilder(dbOk([])),
        stories: () => queryBuilder(dbOk([])),
        videos: () => queryBuilder(dbOk([])),
        contacts: () => queryBuilder({ data: null, error: null, count: 120 }),
        profiles: () => queryBuilder(dbOk([{ user_id: "admin1", display_name: "Jas" }])),
      }),
    })));
  }

  it("holds approval back until there's a test and a full proof, and says what's missing", async () => {
    stubIssue({}, { number: 48, sent_count: 100 });

    render(await IssueDetail(props));

    expect(screen.getByRole("button", { name: "Approve to send" })).toBeDisabled();
    expect(screen.getByText(/Still needed: a test send and 17 unticked proof items/)).toBeInTheDocument();
    // 120 against 100 is 20% off: flagged, not blocked.
    expect(screen.getByText(/\+20\.0% vs issue #48/)).toHaveTextContent("More than 5% off last month");
  });

  it("shows who approved it and when, with a way to withdraw", async () => {
    stubIssue({ approved_at: "2026-10-20T09:00:00Z", approved_by: "admin1", approved_recipients: 102, last_test_sent_at: "2026-10-20T08:00:00Z", last_test_sent_by: "admin1" }, { number: 48, sent_count: 100 });

    render(await IssueDetail(props));

    expect(screen.getByText(/Approved to send by Jas, 20 Oct 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Last test: Jas/)).toBeInTheDocument();
    expect(screen.getByText(/102 recipients when approved, \+2\.0% vs issue #48/)).not.toHaveTextContent("More than 5%");
    expect(screen.getByRole("button", { name: "Withdraw approval" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve to send" })).toBeNull();
  });
});

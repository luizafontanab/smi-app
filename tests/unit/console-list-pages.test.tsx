// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import StoriesPage from "@/app/console/stories/page";
import MembersAdminPage from "@/app/console/members/page";
import CrmAdminPage from "@/app/console/crm/page";
import PageLayoutsPage from "@/app/console/pages/page";
import VideosPage from "@/app/console/videos/page";
import EventsPage from "@/app/console/events/page";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
vi.mock("@/lib/auth", () => ({ requireConsole: vi.fn(async () => ({ userId: "admin1", role: "admin" })) }));
vi.mock("@/lib/adapters/crm", () => ({
  getCrmSync: () => ({ live: false }),
  firstImportDone: vi.fn(async () => false),
  readLastRun: vi.fn(async () => null),
}));
vi.mock("@/lib/activity", () => ({ memberActivityTimeline: vi.fn(async () => []) }));
vi.mock("@/lib/blocks/layouts", () => ({ getLayout: vi.fn(async () => ({ blocks: [] })) }));
vi.mock("@/lib/variant", async (orig) => ({ ...(await orig<typeof import("@/lib/variant")>()), defaultVariant: vi.fn(async () => "grid") }));
vi.mock("@/lib/queries", async (orig) => {
  const { resolveHomeSections } = await import("@/lib/home-sections");
  return {
    ...(await orig<typeof import("@/lib/queries")>()),
    homeSectionsSetting: vi.fn(async () => resolveHomeSections(null)),
    // The events page's Featured Event card; nothing booked, pinned or upcoming.
    featuredEvent: vi.fn(async () => ({ event: null, source: "fallback" as const, placement: null })),
  };
});
vi.mock("@/app/console/pages/LayoutEditor", () => ({ LayoutEditor: () => null }));

afterEach(() => resetDbServerMocks());

const props = (searchParams: Record<string, string>) =>
  ({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) }) as never;

/**
 * A counted list of `total` rows that behaves like PostgREST: a range starting
 * past the last row is a 416 (PGRST103), anything else is its slice.
 */
function pagedTable(total: number, row: (i: number) => Record<string, unknown>) {
  const builder = queryBuilder(() => {
    const [from, to] = vi.mocked(builder.range as (a: number, b: number) => unknown).mock.calls.at(-1) as [number, number];
    if (from > 0 && from >= total) return dbError("Requested range not satisfiable", { code: "PGRST103" });
    const end = Math.min(to + 1, total);
    return dbOk(Array.from({ length: Math.max(0, end - from) }, (_, k) => row(from + k)), total);
  });
  return builder;
}

const story = (i: number) => ({
  id: `s${i}`, title: `Story ${i}`, status: "draft", source: "admin", scheduled_at: null, published_at: null,
  pinned_until: null, updated_at: "2026-10-01T00:00:00Z", member: null,
});

describe("console lists past their last page", () => {
  it("/console/stories?view=list&page=999 shows the last page instead of the error boundary", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ stories: () => pagedTable(60, story), settings: () => queryBuilder(dbOk(null)) }),
    })));
    render(await StoriesPage(props({ view: "list", page: "999" })));
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Story 59")).toBeInTheDocument();
  });

  it("/console/members?page=999 shows the last page", async () => {
    const member = (i: number) => ({ id: `m${i}`, name: `Member ${i}`, status: "active", archived_at: null, joined_at: null, billing_mode: "stripe", paid_at: null, comped_until: null, draft_submitted_at: null, industry: null });
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ members: () => pagedTable(51, member) }) })));
    render(await MembersAdminPage(props({ page: "999" })));
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Member 50")).toBeInTheDocument();
  });

  it("/console/crm?page=999 shows the last page", async () => {
    const contact = (i: number) => ({ id: `c${i}`, email: `c${i}@x.test`, name: `Contact ${i}`, company: null, member_id: null, subscribed: true, unsubscribed_at: null, member: null, last_synced_at: null, bigin_id: null, bigin_company_name: null, crm_dirty_at: null });
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ contacts: () => pagedTable(75, contact), members: () => queryBuilder(dbOk([])) }),
    })));
    render(await CrmAdminPage(props({ page: "999" })));
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("c74@x.test")).toBeInTheDocument();
  });
});

describe("/console/stories", () => {
  it("the calendar never reads a member's unsubmitted draft", async () => {
    const stories = queryBuilder(dbOk([]));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ stories: () => stories, settings: () => queryBuilder(dbOk(null)) }),
    })));
    render(await StoriesPage(props({ view: "calendar" })));
    expect(stories.eq).toHaveBeenCalledWith("member_draft", false);
  });

  it("shows the ?error= a refused board move or a stale editor link sends back", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ stories: () => queryBuilder(dbOk([])), settings: () => queryBuilder(dbOk(null)) }),
    })));
    render(await StoriesPage(props({ view: "calendar", error: "Can't move a published story straight to awaiting_approval." })));
    expect(screen.getByRole("alert")).toHaveTextContent("Can't move a published story straight to awaiting_approval.");
  });
});

// Review fix, 3 Nov: an Approve or Publish now on a video or event deleted in
// another tab lands here with ?error=, which used to be dropped unshown.
describe.each([
  ["/console/videos", VideosPage, "Video not found."],
  ["/console/events", EventsPage, "Event not found."],
] as const)("%s", (_path, Page, message) => {
  it("shows the ?error= an editor sends back", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({}, () => queryBuilder(dbOk([]))) })));
    render(await Page(props({ view: "calendar", error: message })));
    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  it("shows no alert without one", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({}, () => queryBuilder(dbOk([]))) })));
    render(await Page(props({ view: "calendar" })));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("/console/pages?type=story&entity=", () => {
  const ID = "11111111-1111-1111-1111-111111111111";

  it("a member's unsubmitted draft is treated as no story selected — its title never shows", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({
        stories: () => queryBuilder(dbOk({ title: "Private draft title", member_draft: true })),
        page_layouts: () => queryBuilder(dbOk(null)),
      }),
    })));
    render(await PageLayoutsPage(props({ type: "story", entity: ID })));
    expect(screen.queryByText("Private draft title")).not.toBeInTheDocument();
    expect(screen.queryByText(/Editing the layout for/)).not.toBeInTheDocument();
  });

  it("any other story still gets its own layout, labelled by title", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({
        stories: () => queryBuilder(dbOk({ title: "Desk story", member_draft: false })),
        page_layouts: () => queryBuilder(dbOk(null)),
      }),
    })));
    render(await PageLayoutsPage(props({ type: "story", entity: ID })));
    expect(screen.getByText("Desk story")).toBeInTheDocument();
  });
});

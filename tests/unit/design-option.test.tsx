// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

/**
 * Seam 1 of the Classic design option (#68, #69): the hook-point module
 * src/components/design-option.ts. On staging every piece is Current's own
 * component; the `classic` branch rewrites only that module to point at its
 * own. So the property worth holding is: each route renders whatever the
 * module exports. The module is replaced here with stand-ins, and a route that
 * imported a Current component directly would render that instead and fail.
 */

const { piece } = vi.hoisted(() => {
  const piece = (name: string) =>
    Object.assign((props: Record<string, unknown>) => <div data-testid={`piece-${name}`} data-props={Object.keys(props).sort().join(",")} />, { displayName: name });
  return { piece };
});
vi.mock("@/components/design-option", () => ({
  Header: piece("Header"),
  Footer: piece("Footer"),
  HomeView: piece("HomeView"),
  StoryView: piece("StoryView"),
  IndustryView: piece("IndustryView"),
  NewsletterIssueView: piece("NewsletterIssueView"),
  JoinView: piece("JoinView"),
}));

const m = vi.hoisted(() => ({
  currentUser: vi.fn(async (): Promise<unknown> => null),
  storyBySlug: vi.fn(),
  storyForPreview: vi.fn(),
  newsletterBySlug: vi.fn(),
  loadIndustryHub: vi.fn(),
}));
vi.mock("@/lib/variant", () => ({
  siteVariant: async () => "grid",
  pickView: async (views: Record<string, unknown>) => views.grid,
}));
vi.mock("@/lib/auth", () => ({ currentUser: m.currentUser, isAdmin: () => false }));
vi.mock("@/lib/queries", () => ({
  storyBySlug: m.storyBySlug,
  storyForPreview: m.storyForPreview,
  newsletterBySlug: m.newsletterBySlug,
  industryBySlug: vi.fn(async () => null),
  activeTakeover: vi.fn(async () => null),
  industries: vi.fn(async () => []),
}));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/notifications", () => ({ unreadNotificationCount: vi.fn(async () => 0) }));
vi.mock("@/lib/analytics", () => ({ record: vi.fn(), requestContext: vi.fn(async () => ({})), newsletterClick: vi.fn(() => ({})) }));
vi.mock("@/lib/newsletter-tracking", () => ({ issueFromLink: vi.fn(async () => null), newsletterLinkParams: vi.fn(() => ({})) }));
vi.mock("@/lib/newsletter-extras", () => ({ issueExtras: vi.fn(async () => ({ events: [], directory: [] })) }));
vi.mock("@/lib/story-page", () => ({ loadStoryPageData: vi.fn(async () => ({ members: [], industrySlug: null })) }));
vi.mock("@/lib/story-preview", () => ({ canPreviewStory: () => true, redirectsToLiveStory: () => false, previewBackHref: () => "/console" }));
vi.mock("@/app/(public)/home.data", () => ({ loadHome: vi.fn(async () => ({ stories: [] })) }));
vi.mock("@/app/(public)/industry/[slug]/hub.data", () => ({ loadIndustryHub: m.loadIndustryHub }));
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

import { resetDbServerMocks, sessionDb } from "../stubs/db-server";
import { asDb, dbOk, mockDb } from "../stubs/supabase";
import PublicLayout from "@/app/(public)/layout";
import HomePage from "@/app/(public)/page";
import StoryPage from "@/app/(public)/news/[slug]/page";
import StoryPreviewPage from "@/app/(public)/preview/story/[id]/page";
import IndustryPage from "@/app/(public)/industry/[slug]/page";
import NewsletterIssuePage from "@/app/(public)/newsletters/[slug]/page";
import JoinPage from "@/app/(public)/join/page";
import LoginPage from "@/app/login/page";
import ResetPage from "@/app/reset/page";
import NewPasswordPage from "@/app/reset/new/page";
import UnsubscribePage from "@/app/unsubscribe/page";
import RootNotFound from "@/app/not-found";

afterEach(() => {
  vi.clearAllMocks();
  resetDbServerMocks();
});

const routeProps = (params: Record<string, string>) =>
  ({ params: Promise.resolve(params), searchParams: Promise.resolve({}) }) as never;
const story = { id: "11111111-1111-4111-8111-111111111111", slug: "a-story", title: "A story", status: "draft", member_id: null, categories: [], cover_path: null, social_posts: null };

describe("the hook-point module", () => {
  it("resolves each of the seven pieces to Current's component", async () => {
    const pieces = await vi.importActual<typeof import("@/components/design-option")>("@/components/design-option");
    // On the `classic` branch the pieces are Classic's own; its tests live in tests/unit/classic.
    if (pieces.DESIGN_OPTION !== "current") return;
    const { SiteHeader } = await import("@/components/SiteHeader");
    const { GridSiteFooter } = await import("@/components/GridSiteFooter");
    const { GridHome } = await import("@/app/(public)/home.grid");
    const { StoryPageView } = await import("@/components/story/StoryPageView");
    const { IndustryPageView } = await import("@/components/industry/IndustryPageView");
    const { NewsletterIssueView } = await import("@/components/newsletter/NewsletterIssueView");
    const { JoinPageView } = await import("@/components/join/JoinPageView");

    expect(pieces.Header).toBe(SiteHeader);
    expect(pieces.Footer).toBe(GridSiteFooter);
    expect(pieces.HomeView).toBe(GridHome);
    expect(pieces.StoryView).toBe(StoryPageView);
    expect(pieces.IndustryView).toBe(IndustryPageView);
    expect(pieces.NewsletterIssueView).toBe(NewsletterIssueView);
    expect(pieces.JoinView).toBe(JoinPageView);
  });
});

describe("routes render their piece through the module", () => {
  it("public layout: header and footer", async () => {
    render(await PublicLayout({ children: <p>page</p> }));
    expect(screen.getByTestId("piece-Header")).toBeInTheDocument();
    expect(screen.getByTestId("piece-Footer")).toBeInTheDocument();
  });

  it("home", async () => {
    render(await HomePage());
    expect(screen.getByTestId("piece-HomeView")).toBeInTheDocument();
  });

  it("published story and story preview share one piece", async () => {
    m.storyBySlug.mockResolvedValue({ ...story, status: "published" });
    const { unmount } = render(await StoryPage(routeProps({ slug: "a-story" })));
    expect(screen.getByTestId("piece-StoryView")).toBeInTheDocument();
    unmount();

    m.currentUser.mockResolvedValueOnce({ role: "admin", userId: "u1", memberId: null });
    m.storyForPreview.mockResolvedValue(story);
    render(await StoryPreviewPage(routeProps({ id: story.id })));
    expect(screen.getByTestId("piece-StoryView")).toBeInTheDocument();
  });

  it("industry", async () => {
    m.loadIndustryHub.mockResolvedValue({ industry: { name: "Laser" } });
    render(await IndustryPage(routeProps({ slug: "laser" })));
    expect(screen.getByTestId("piece-IndustryView")).toHaveAttribute("data-props", "hub,slug");
  });

  it("newsletter issue", async () => {
    m.newsletterBySlug.mockResolvedValue({ id: "iss1", number: 50, items: [], ads: [] });
    render(await NewsletterIssuePage(routeProps({ slug: "issue-50" })));
    expect(screen.getByTestId("piece-NewsletterIssueView")).toHaveAttribute("data-props", "extras,issue");
  });

  it("join", () => {
    render(JoinPage());
    expect(screen.getByTestId("piece-JoinView")).toBeInTheDocument();
  });
});

describe('the public-site scope, data-site="public"', () => {
  const scoped = (container: HTMLElement) => container.querySelector('[data-site="public"]');

  it("wraps the public layout: header, page and footer", async () => {
    const { container } = render(await PublicLayout({ children: <p>page</p> }));
    const scope = scoped(container);
    expect(scope).not.toBeNull();
    expect(scope).toContainElement(screen.getByTestId("piece-Header"));
    expect(scope).toContainElement(screen.getByRole("main"));
    expect(scope).toContainElement(screen.getByTestId("piece-Footer"));
  });

  it("is on each public surface outside the layout: login, reset, reset/new, unsubscribe, root 404", async () => {
    sessionDb.mockResolvedValue(asDb(mockDb({ auth: { getUser: vi.fn(async () => dbOk({ user: { email: "a@b.test" } })) } })));
    const surfaces = [
      await LoginPage(routeProps({})),
      await ResetPage(routeProps({})),
      await NewPasswordPage(routeProps({})),
      await UnsubscribePage(routeProps({})),
      RootNotFound(),
    ];
    for (const page of surfaces) {
      const { container, unmount } = render(page);
      // On the outermost element, so the whole surface is in scope.
      expect(container.firstElementChild).toHaveAttribute("data-site", "public");
      unmount();
    }
  });

  /*
   * Rendering the console and dashboard layouts needs their whole auth stack,
   * so this half is a source check: the attribute may appear only in the files
   * that own a public surface. A console or dashboard file that gained it
   * would turn an option's styling on there.
   */
  it("appears nowhere else: not on the root layout, the console or the dashboard", () => {
    const src = path.resolve(__dirname, "../../src");
    const files = (fs.readdirSync(src, { recursive: true }) as string[]).filter((f) => f.endsWith(".tsx"));
    const holders = files.filter((f) => fs.readFileSync(path.join(src, f), "utf8").includes("data-site=")).sort();
    expect(holders).toEqual([
      "app/(public)/layout.tsx",
      "app/login/page.tsx",
      "app/not-found.tsx",
      "app/reset/new/page.tsx",
      "app/reset/page.tsx",
      "app/unsubscribe/page.tsx",
    ]);
  });

  it("every public surface loads the module, so an option's stylesheet reaches it", () => {
    const src = path.resolve(__dirname, "../../src/app");
    for (const f of ["(public)/layout.tsx", "login/page.tsx", "reset/page.tsx", "reset/new/page.tsx", "unsubscribe/page.tsx", "not-found.tsx"]) {
      expect(fs.readFileSync(path.join(src, f), "utf8"), f).toMatch(/from "@\/components\/design-option"|import "@\/components\/design-option"/);
    }
  });
});

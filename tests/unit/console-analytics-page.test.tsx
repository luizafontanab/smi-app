// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AnalyticsPage from "@/app/console/analytics/page";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { requestHeaders, resetNextHeadersMocks } from "../stubs/next-headers";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
vi.mock("@/lib/auth", () => ({ requireConsole: vi.fn(async () => ({ userId: "admin1", role: "admin" })) }));

const current = {
  views: 421, users: 157, new_users: 121, sessions: 220,
  top_pages: [{ path: "/member", views: 12 }, { path: "/news/mazak", views: 10 }],
  sources: [{ source: "google.com", users: 61 }, { source: "(direct)", users: 38 }, { source: "chatgpt.com", users: 12 }],
  devices: [{ device: "desktop", users: 115 }, { device: "mobile", users: 41 }, { device: "unknown", users: 1 }],
  countries: [{ country: "GB", users: 140 }, { country: "unknown", users: 17 }],
  daily: [{ day: "2026-10-26", views: 140 }, { day: "2026-10-28", views: 281 }],
};
const previous = { views: 358, users: 125, new_users: 102, sessions: 172, top_pages: [{ path: "/member", views: 21 }], sources: [{ source: "google.com", users: 56 }], devices: [], countries: [], daily: [] };

let rpc: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
let consent: ReturnType<typeof queryBuilder>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
  vi.stubEnv("SITE_URL", "https://sheetmetalindustries.com");
  rpc = vi.fn<(...args: unknown[]) => unknown>().mockResolvedValueOnce(dbOk(current)).mockResolvedValueOnce(dbOk(previous));
  consent = queryBuilder(dbOk([{ total_requests: 100, consented_requests: 62 }]));
  const from = fromByTable({ consent_stats: () => consent }, () => queryBuilder(dbOk([])));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from, rpc })));
});

afterEach(() => {
  resetDbServerMocks();
  resetNextHeadersMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const open = (searchParams: Record<string, string> = {}) =>
  AnalyticsPage({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) } as never);

describe("console analytics", () => {
  it("asks for the chosen range and the same-length period before it, in London days", async () => {
    render(await open({ from: "2026-10-26", to: "2026-10-28" }));
    expect(rpc).toHaveBeenNthCalledWith(1, "site_stats", {
      p_from: "2026-10-26 00:00:00 Europe/London",
      p_to: "2026-10-29 00:00:00 Europe/London",
      p_site_host: "sheetmetalindustries.com",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "site_stats", expect.objectContaining({
      p_from: "2026-10-23 00:00:00 Europe/London",
      p_to: "2026-10-26 00:00:00 Europe/London",
    }));
    expect(screen.getByText(/26 Oct 2026 – 28 Oct 2026 · compared with 23 Oct 2026 – 25 Oct 2026/)).toBeInTheDocument();
  });

  it("treats the serving host as the site itself, port dropped, so internal referrers read as direct", async () => {
    requestHeaders.set("host", "smi-git-staging.vercel.app:443");
    render(await open());
    expect(rpc).toHaveBeenNthCalledWith(1, "site_stats", expect.objectContaining({ p_site_host: "smi-git-staging.vercel.app" }));
  });

  it("shows the headline figures with their change", async () => {
    render(await open());
    const views = screen.getByText("Views", { selector: "p" }).parentElement!;
    expect(within(views).getByText("421")).toBeInTheDocument();
    expect(views).toHaveTextContent("17.6%");
    expect(screen.getByText("Sessions per user", { selector: "p" }).parentElement).toHaveTextContent("1.4");
  });

  it("lists top pages linked to the live site, with per-page change and a grand total", async () => {
    render(await open());
    expect(screen.getByRole("link", { name: "/member" })).toHaveAttribute("href", "https://sheetmetalindustries.com/member");
    const row = screen.getByRole("link", { name: "/member" }).closest("tr")!;
    expect(row).toHaveTextContent("42.9%");
    expect(screen.getByText("Grand total").closest("tr")).toHaveTextContent("421");
    expect(screen.getByText("1–2 / 2")).toBeInTheDocument();
  });

  it("names sources by site, and shows a dash where there is nothing to compare", async () => {
    render(await open());
    const chatgpt = screen.getByText("chatgpt.com").closest("tr")!;
    expect(chatgpt).toHaveTextContent("12");
    expect(chatgpt).toHaveTextContent("–");
    expect(screen.getByText("AI assistants")).toBeInTheDocument();
  });

  it("shows devices and countries, with unknowns labelled", async () => {
    render(await open());
    expect(screen.getByText("desktop").closest("tr")).toHaveTextContent("115");
    expect(screen.getByText("United Kingdom").closest("tr")).toHaveTextContent("140");
    expect(screen.getAllByText("Unknown")).toHaveLength(2);
  });

  it("discloses the consent rate for the period", async () => {
    render(await open({ days: "7" }));
    expect(consent.gte).toHaveBeenCalledWith("day", "2026-10-23");
    expect(consent.lte).toHaveBeenCalledWith("day", "2026-10-29");
    expect(screen.getByText(/62% of visits in this period accepted/)).toBeInTheDocument();
  });
});

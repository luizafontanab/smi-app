// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SocialReachPage from "@/app/console/social-reach/page";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
vi.mock("@/lib/auth", () => ({ requireConsole: vi.fn(async () => ({ userId: "admin1", role: "admin" })) }));
vi.mock("@/app/console/social-reach/actions", () => ({
  saveSocialReachHomepage: vi.fn(), clearSocialReachHomepage: vi.fn(), saveSocialReachPlatforms: vi.fn(),
}));

const CREDENTIALS = ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_ACCESS_TOKEN", "INSTAGRAM_ACCESS_TOKEN", "YOUTUBE_API_KEY"];
beforeEach(() => { for (const k of CREDENTIALS) vi.stubEnv(k, ""); });
afterEach(() => { resetDbServerMocks(); vi.unstubAllEnvs(); });

/** settings rows by key, and the newsletter audience count. */
function data(rows: Record<string, unknown>, subscribers = 0) {
  const contacts = queryBuilder(dbOk(null, subscribers));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
    from: fromByTable({
      settings: () => {
        const b: ReturnType<typeof queryBuilder> = queryBuilder(() => {
          const key = vi.mocked(b.eq as (c: string, v: string) => unknown).mock.calls.at(-1)?.[1];
          return dbOk(key && key in rows ? { value: rows[key] } : null);
        });
        return b;
      },
      contacts: () => contacts,
    }),
  })));
  return { contacts };
}
const page = async (searchParams: Record<string, string> = {}) =>
  render(await SocialReachPage({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) } as never));
const row = (name: string) => screen.getByRole("rowheader", { name: new RegExp(`^${name}`) }).closest("tr")!;

describe("/console/social-reach", () => {
  it("with nothing saved and no credentials: no homepage figure, and every platform is typed in by hand", async () => {
    data({});
    await page();
    expect(screen.getByText(/Nothing saved, so the homepage shows only/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove from homepage/ })).not.toBeInTheDocument();
    for (const name of ["LinkedIn", "Facebook", "Instagram", "YouTube", "X", "TikTok"]) {
      const r = row(name);
      expect(within(r).getByText("Not connected: enter by hand")).toBeInTheDocument();
      expect(within(r).getByLabelText(`${name} followers`)).toHaveValue("");
      expect(within(r).getByLabelText(`${name} views`)).toBeInTheDocument();
    }
  });

  it("shows the saved homepage figure, and hand-entered values with their dates", async () => {
    data({
      social_reach_homepage: { value: 12500, label: "Followers across our channels", as_of: "2026-11-04T12:00:00.000Z" },
      social_reach_manual: { linkedin: { followers: { value: 4200, at: "2026-10-01T09:00:00.000Z" }, views: { value: 18000, period: "last 30 days", at: "2026-10-01T09:00:00.000Z" } } },
    });
    await page();
    expect(screen.getByText("12,500")).toBeInTheDocument();
    expect(screen.getByLabelText("Number")).toHaveValue("12500");
    expect(screen.getByLabelText("Caption under the number")).toHaveValue("Followers across our channels");
    const linkedin = row("LinkedIn");
    expect(within(linkedin).getByLabelText("LinkedIn followers")).toHaveValue("4200");
    expect(within(linkedin).getByLabelText("LinkedIn views period")).toHaveValue("last 30 days");
    expect(within(linkedin).getAllByText("Entered by hand, 1 Oct 2026")).toHaveLength(2);
  });

  it("shows a fetched count read-only, and links YouTube's terms", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "k");
    data({ social_reach_fetched: { youtube: { value: 1230, at: new Date().toISOString(), error: null } } });
    await page();
    const youtube = row("YouTube");
    expect(within(youtube).getByText("1,230")).toBeInTheDocument();
    expect(within(youtube).queryByLabelText("YouTube followers")).not.toBeInTheDocument();
    expect(within(youtube).getByText(/^Fetched automatically, updated/)).toBeInTheDocument();
    expect(within(youtube).getByText(/rounds this down to three significant figures/)).toBeInTheDocument();
    expect(within(youtube).getByRole("link", { name: "YouTube Terms of Service" })).toHaveAttribute("href", "https://www.youtube.com/t/terms");
  });

  it("shows the newsletter audience from the shared query, outside the sums", async () => {
    const { contacts } = data({}, 2712);
    await page();
    const subscribers = row("Newsletter subscribers");
    expect(within(subscribers).getByText("2,712")).toBeInTheDocument();
    expect(within(subscribers).getByText(/Not included in either sum/)).toBeInTheDocument();
    expect(contacts.eq).toHaveBeenCalledWith("subscribed", true);
    expect(contacts.is).toHaveBeenCalledWith("unsubscribed_at", null);
    expect(contacts.is).toHaveBeenCalledWith("bounced_at", null);
    expect(within(row("Sum of the figures above")).getAllByText("0")).toHaveLength(2);
  });

  it("puts a refused save's message beside its field and keeps what was typed", async () => {
    data({});
    await page({ e_value: "Enter a whole number of 0 or more.", value: "-5", label: "Reach" });
    const input = screen.getByLabelText("Number");
    expect(input).toHaveValue("-5");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a whole number of 0 or more.");
  });
});

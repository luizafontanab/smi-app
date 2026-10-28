// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MemberLayout from "@/app/dashboard/layout";
import DashboardLeadsPage from "@/app/dashboard/leads/page";
import { serviceDb } from "@/lib/db/server";
import { resetDbServerMocks } from "../stubs/db-server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";

/**
 * The member Leads page behind its feature flag (/console/features): off hides
 * the nav entry and sends the address to the dashboard before any lead-gen
 * query runs; on leaves both as they were.
 */

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { isFeatureEnabled, getLeadGenSource } = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(async () => true),
  getLeadGenSource: vi.fn(() => ({ search: vi.fn(async () => []), mark: vi.fn() })),
}));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled }));
vi.mock("@/lib/adapters/leadgen", () => ({ getLeadGenSource }));
vi.mock("@/lib/auth", () => ({
  requireMemberView: vi.fn(async () => ({ memberId: "mem1", email: "member@acme.example", viewingAs: null })),
}));
vi.mock("@/lib/notifications", () => ({ unreadNotificationCount: vi.fn(async () => 0) }));
// The layout's header pieces: not what's under test, and their own import graphs are large.
vi.mock("@/app/actions", () => ({ signOut: vi.fn() }));
vi.mock("@/components/SiteHeader", () => ({ memberAccountLinks: () => [] }));
vi.mock("@/app/dashboard/actions", () => ({ markProspectFollowUp: vi.fn(), unmarkProspect: vi.fn() }));

afterEach(() => {
  resetDbServerMocks();
  isFeatureEnabled.mockReset().mockResolvedValue(true);
  getLeadGenSource.mockClear();
});

function db() {
  const from = fromByTable({
    members: () => queryBuilder(dbOk({ name: "Acme", status: "active" })),
    prospect_marks: () => queryBuilder(dbOk([])),
  });
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
}

describe("member nav", () => {
  it("shows Leads while the flag is on", async () => {
    db();
    render(await MemberLayout({ children: null }));
    expect(screen.getByRole("link", { name: "Leads" })).toBeTruthy();
  });

  it("drops Leads while the flag is off, leaving the rest", async () => {
    db();
    isFeatureEnabled.mockResolvedValue(false);
    render(await MemberLayout({ children: null }));
    expect(isFeatureEnabled).toHaveBeenCalledWith("member_leads");
    expect(screen.queryByRole("link", { name: "Leads" })).toBeNull();
    expect(screen.getByRole("link", { name: "Stats" })).toBeTruthy();
  });
});

describe("/dashboard/leads", () => {
  it("sends the member to their dashboard while the flag is off, without querying leads", async () => {
    db();
    isFeatureEnabled.mockResolvedValue(false);
    await expect(DashboardLeadsPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(getLeadGenSource).not.toHaveBeenCalled();
  });

  it("renders while the flag is on", async () => {
    db();
    render(await DashboardLeadsPage());
    expect(screen.getByRole("heading", { name: "Leads" })).toBeTruthy();
  });
});

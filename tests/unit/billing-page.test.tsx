// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import BillingSettingsPage from "@/app/dashboard/settings/billing/page";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
vi.mock("@/lib/auth", () => ({
  requireMemberView: vi.fn(async () => ({ memberId: "mem1", email: "m@acme.example", viewingAs: null })),
}));
vi.mock("@/lib/invoice-pdf", () => ({ signedInvoiceUrl: vi.fn(async () => null) }));
vi.mock("@/lib/adapters/advert-checkout", () => ({ advertPaymentsMode: () => "simulated" }));
// The page's own chrome — not what this test is about.
vi.mock("@/app/dashboard/settings/SettingsTabs", () => ({ SettingsTabs: () => null }));

afterEach(() => resetDbServerMocks());

const invoice = (id: string, number: string) => ({
  id, number, description: null, amount_pennies: 4000, issued_on: "2026-10-01", status: "issued", pdf_path: null,
});

// Follow-up 16 Oct: the pay page only takes advert/visibility invoices
// (lib/invoicing isPayableOnline); the list offered "Pay now" on anything not
// SMI-JOIN-, so the seed's SMI-2026-… membership rows linked to a 404.
describe("/dashboard/settings/billing Pay now", () => {
  it("is offered exactly where the pay page will take it", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({
        invoices: () => queryBuilder(dbOk([
          invoice("i-adv", "SMI-ADV-MG3K2Q7F-4K9Z"),
          invoice("i-vis", "SMI-VIS-MG3K2Q7F-0AB1"),
          invoice("i-join", "SMI-JOIN-MG3K2Q7F-77QX"),
          invoice("i-old", "SMI-2026-0042"),
        ])),
        members: () => queryBuilder(dbOk({ billing_mode: "card", joined_at: "2026-01-01", status: "active", cancel_requested_at: null })),
      }),
    })));

    render(await BillingSettingsPage());

    const hrefs = screen.getAllByRole("link", { name: "Pay now" }).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/dashboard/pay/invoice/i-adv", "/dashboard/pay/invoice/i-vis"]);
    expect(screen.getAllByText("unpaid")).toHaveLength(2);
  });
});

// #91 (Jas item 24): members ask SMI to cancel; the billing page only points
// them at the Contact page.
describe("/dashboard/settings/billing membership section", () => {
  const renderWith = async (member: Record<string, unknown>) => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({
        invoices: () => queryBuilder(dbOk([])),
        members: () => queryBuilder(dbOk({ billing_mode: "card", joined_at: "2026-01-01", ...member })),
      }),
    })));
    render(await BillingSettingsPage());
  };

  it("offers no cancel button or dialog, only the contact sentence", async () => {
    await renderWith({ status: "active", cancel_requested_at: null });

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    const sentence = screen.getByText(/To change or end your membership,/);
    expect(within(sentence).getByRole("link", { name: "get in touch" }).getAttribute("href")).toBe("/contact");
  });

  it("keeps the pending text, with the date and a Contact page link", async () => {
    await renderWith({ status: "active", cancel_requested_at: "2026-11-02T10:00:00Z" });

    const pending = screen.getByText(/Cancellation requested on 2026-11-02/);
    expect(pending.textContent).toMatch(/stays active for the rest of the current billing period/);
    expect(within(pending).getByRole("link", { name: "Contact SMI" }).getAttribute("href")).toBe("/contact");
    expect(screen.queryByText(/To change or end your membership/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows nothing about cancelling when the membership isn't active", async () => {
    await renderWith({ status: "lapsed", cancel_requested_at: null });

    expect(screen.queryByText(/To change or end your membership/)).toBeNull();
    expect(screen.queryByText(/Cancellation requested/)).toBeNull();
  });
});

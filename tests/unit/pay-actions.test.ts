import { afterEach, describe, expect, it, vi } from "vitest";
import { payMembership } from "@/app/dashboard/pay/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { RedirectSignal } from "../stubs/next-navigation";
import type { CurrentUser } from "@/lib/auth";
import type { CheckoutResult } from "@/lib/adapters/payments";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireMember, createCheckout, paymentsAreLive, applyPaymentResult, notifyAdminFunnel } = vi.hoisted(() => ({
  requireMember: vi.fn(async (): Promise<CurrentUser & { memberId: string }> => ({
    userId: "u1", email: "member@acme.example", role: "member", memberId: "mem1", displayName: "Acme",
  })),
  createCheckout: vi.fn<() => Promise<CheckoutResult>>(async () => ({ kind: "paid" })),
  paymentsAreLive: vi.fn(() => false),
  applyPaymentResult: vi.fn(async () => {}),
  notifyAdminFunnel: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ requireMember }));
vi.mock("@/lib/adapters/payments", () => ({ getPayments: () => ({ createCheckout }), paymentsAreLive }));
vi.mock("@/lib/membership", () => ({ applyPaymentResult }));
vi.mock("@/lib/notify-admin", () => ({ notifyAdminFunnel }));

afterEach(() => {
  resetDbServerMocks();
  vi.clearAllMocks();
});

const PREV = { message: "" };
const memberRow = (over: Record<string, unknown> = {}) =>
  queryBuilder(dbOk({ id: "mem1", name: "Acme", paid_at: null, comped_until: null, ...over }));

function form(fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("payMembership", () => {
  it("records a stub payment, notifies the funnel, and redirects to the dashboard", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow() })));

    await expect(payMembership(PREV, form())).rejects.toThrow(RedirectSignal);
    expect(createCheckout).toHaveBeenCalledWith({ memberId: "mem1", email: "member@acme.example", companyName: "Acme", promoCode: undefined });
    expect(applyPaymentResult).toHaveBeenCalledWith("mem1", { kind: "paid" });
    expect(notifyAdminFunnel).toHaveBeenCalled();
  });

  it("refuses to charge twice: an already-paid member is bounced to the dashboard before checkout", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow({ paid_at: "2026-08-01T00:00:00Z" }) })));

    await expect(payMembership(PREV, form())).rejects.toThrow(RedirectSignal);
    expect(createCheckout).not.toHaveBeenCalled();
    expect(applyPaymentResult).not.toHaveBeenCalled();
  });

  it("a comped member is likewise bounced before checkout", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow({ comped_until: "2027-01-01" }) })));

    await expect(payMembership(PREV, form())).rejects.toThrow(RedirectSignal);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("surfaces a checkout error as a form message without applying anything", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow() })));
    createCheckout.mockResolvedValueOnce({ kind: "error", message: "Unknown promo code." });

    expect(await payMembership(PREV, form({ promo: "NOPE" }))).toEqual({ message: "Unknown promo code." });
    expect(applyPaymentResult).not.toHaveBeenCalled();
    expect(notifyAdminFunnel).not.toHaveBeenCalled();
  });

  it("passes the promo code through and reports the comped months to the funnel", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow() })));
    createCheckout.mockResolvedValueOnce({ kind: "comped", months: 12 });

    await expect(payMembership(PREV, form({ promo: "smi-free-year" }))).rejects.toThrow(RedirectSignal);
    expect(createCheckout).toHaveBeenCalledWith(expect.objectContaining({ promoCode: "smi-free-year" }));
    expect(applyPaymentResult).toHaveBeenCalledWith("mem1", { kind: "comped", months: 12 });
    expect(notifyAdminFunnel).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("12 months"),
    }));
  });

  it("a live-Stripe redirect result goes straight to the checkout URL with nothing applied", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow() })));
    createCheckout.mockResolvedValueOnce({ kind: "redirect", url: "https://checkout.stripe.test/cs_1" });

    await expect(payMembership(PREV, form())).rejects.toThrow("https://checkout.stripe.test/cs_1");
    expect(applyPaymentResult).not.toHaveBeenCalled();
  });

  it("fails soft when the member row cannot be loaded", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(dbOk(null)) })));

    expect((await payMembership(PREV, form())).message).toMatch(/sign in again/);
    expect(createCheckout).not.toHaveBeenCalled();
  });
});

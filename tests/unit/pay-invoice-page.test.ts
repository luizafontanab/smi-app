import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PayInvoicePage from "@/app/dashboard/pay/invoice/[id]/page";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { MemberView } from "@/lib/auth";
import { EmbeddedCheckout } from "@/app/dashboard/pay/invoice/[id]/EmbeddedCheckout";

/**
 * The pay page's own guards (the action has its twin in
 * pay-invoice-actions.test.ts): who may open it, which invoices it serves, and
 * what the Stripe return path hands to settleInvoice().
 */
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireMemberView, settleInvoice, retrieveCheckoutSession } = vi.hoisted(() => ({
  requireMemberView: vi.fn(async (): Promise<MemberView> => ({ memberId: "m1", email: "ops@acme.example", viewingAs: null })),
  settleInvoice: vi.fn(async () => ({ settled: true, memberId: "m1" })),
  retrieveCheckoutSession: vi.fn(async () => ({
    status: "complete", paymentStatus: "paid", invoiceId: INV, kind: "advert_invoice", clientSecret: null, amountTotal: 65000, currency: "gbp",
  })),
}));
vi.mock("@/lib/auth", () => ({ requireMemberView }));
vi.mock("@/lib/advert-payments", () => ({ settleInvoice, formatPounds: (p: number) => `£${(p / 100).toFixed(2)}` }));
vi.mock("@/lib/adapters/advert-checkout", async (orig) => ({
  ...(await orig<typeof import("@/lib/adapters/advert-checkout")>()),
  retrieveCheckoutSession,
}));
vi.mock("@/app/dashboard/pay/invoice/actions", () => ({ simulateInvoicePayment: vi.fn() }));

const INV = "11111111-1111-4111-8111-111111111111";
const row = {
  id: INV, member_id: "m1", number: "SMI-ADV-1", amount_pennies: 65000, status: "issued",
  description: "Advert: x", issued_on: "2026-10-16", paid_at: null, advert_booking_id: null,
};

function db(invoice: unknown) {
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ invoices: () => queryBuilder(dbOk(invoice)) }) })));
}

const open = (searchParams: Record<string, string> = {}) =>
  PayInvoicePage({ params: Promise.resolve({ id: INV }), searchParams: Promise.resolve(searchParams) } as never);

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_1");
  vi.stubEnv("MOCK_INTEGRATIONS", "");
});
afterEach(() => {
  resetDbServerMocks();
  vi.unstubAllEnvs();
  settleInvoice.mockClear();
  retrieveCheckoutSession.mockClear();
  requireMemberView.mockClear();
});

/** Every element in a rendered tree — enough to ask whether one was mounted without rendering it. */
function elements(node: unknown): { type: unknown; props: Record<string, unknown> }[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const el = node as { type: unknown; props: Record<string, unknown> };
  return [el, ...elements(el.props.children)];
}

describe("/dashboard/pay/invoice/[id]", () => {
  it("serves the member's own advertising invoice", async () => {
    db(row);
    await expect(open()).resolves.toBeTruthy();
  });

  // Review finding 10: the billing page hid the link, but the URL still worked.
  it("404s a membership invoice, even the member's own", async () => {
    db({ ...row, number: "SMI-JOIN-MG3K2Q" });
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s someone else's invoice", async () => {
    db({ ...row, member_id: "m2" });
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("settles on Stripe's return with what Stripe says was paid, for settle_invoice() to check", async () => {
    db(row);
    await open({ session_id: "cs_test_1" });
    expect(settleInvoice).toHaveBeenCalledWith(INV, { sessionId: "cs_test_1", paid: { amountPennies: 65000, currency: "gbp" } });
  });

  it("still renders when that fast-path settle fails — the webhook retries until it lands", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    settleInvoice.mockRejectedValueOnce(new Error("connection reset"));
    db(row);
    await expect(open({ session_id: "cs_test_1" })).resolves.toBeTruthy();
  });

  // Fix-list 94: an admin viewing as the member only looks.
  describe("while an admin is viewing as the member", () => {
    beforeEach(() => {
      requireMemberView.mockResolvedValueOnce({ memberId: "m1", email: "ops@acme.example", viewingAs: { adminUserId: "a1", adminName: "Jas" } });
    });

    it("doesn't settle on a Stripe return — the webhook stays the authority", async () => {
      db(row);
      await open({ session_id: "cs_test_1" });
      expect(settleInvoice).not.toHaveBeenCalled();
      expect(retrieveCheckoutSession).not.toHaveBeenCalled();
    });

    it("doesn't mount the checkout, which would ask for a session as it loads", async () => {
      db(row);
      const tree = elements(await open());
      expect(tree.some((el) => el.type === EmbeddedCheckout)).toBe(false);
      const text = tree.flatMap((el) => [el.props.children].flat().filter((c) => typeof c === "string")).join("");
      expect(text).toContain("payment form is hidden");
    });
  });

  it("mounts the checkout for the member themselves", async () => {
    db(row);
    expect(elements(await open()).some((el) => el.type === EmbeddedCheckout)).toBe(true);
  });
});

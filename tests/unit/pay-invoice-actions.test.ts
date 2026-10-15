import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInvoiceCheckoutSession, simulateInvoicePayment } from "@/app/dashboard/pay/invoice/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireMember, settleInvoice, createInvoiceCheckout } = vi.hoisted(() => ({
  requireMember: vi.fn(async (): Promise<CurrentUser & { memberId: string }> => ({
    userId: "u1", email: "ops@acme.example", role: "member", memberId: "m1", displayName: "Acme",
  })),
  settleInvoice: vi.fn(async () => ({ settled: true, memberId: "m1" })),
  createInvoiceCheckout: vi.fn(async () => ({ ok: true as const, clientSecret: "cs_1_secret", sessionId: "cs_1" })),
}));
vi.mock("@/lib/auth", () => ({ requireMember }));
vi.mock("@/lib/advert-payments", () => ({ settleInvoice }));
vi.mock("@/lib/adapters/advert-checkout", async (orig) => ({
  ...(await orig<typeof import("@/lib/adapters/advert-checkout")>()),
  createInvoiceCheckout,
}));

const INV = "11111111-1111-4111-8111-111111111111";
const issued = { id: INV, member_id: "m1", number: "SMI-ADV-1", amount_pennies: 65000, status: "issued", description: "Advert: x" };

function db(row: unknown) {
  const from = fromByTable({ invoices: () => queryBuilder(dbOk(row)) });
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");
  vi.stubEnv("MOCK_INTEGRATIONS", "");
});
afterEach(() => {
  resetDbServerMocks();
  vi.unstubAllEnvs();
  settleInvoice.mockClear();
  createInvoiceCheckout.mockClear();
});

describe("createInvoiceCheckoutSession", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_1");
  });

  it("charges the invoice's own amount — the browser only names the invoice", async () => {
    db(issued);
    await expect(createInvoiceCheckoutSession(INV)).resolves.toBe("cs_1_secret");
    expect(createInvoiceCheckout).toHaveBeenCalledWith(expect.objectContaining({
      invoiceId: INV, amountPennies: 65000, memberId: "m1", email: "ops@acme.example", description: "Advert: x",
    }));
  });

  it("refuses someone else's invoice", async () => {
    db({ ...issued, member_id: "someone-else" });
    await expect(createInvoiceCheckoutSession(INV)).rejects.toThrow(/can't be paid/);
    expect(createInvoiceCheckout).not.toHaveBeenCalled();
  });

  it("refuses an invoice that's already paid", async () => {
    db({ ...issued, status: "paid" });
    await expect(createInvoiceCheckoutSession(INV)).rejects.toThrow(/can't be paid/);
  });
});

describe("simulateInvoicePayment", () => {
  it("settles the member's own invoice where payment is simulated", async () => {
    db(issued);
    await expect(simulateInvoicePayment(form({ invoice_id: INV }))).rejects.toThrow(`NEXT_REDIRECT:/dashboard/pay/invoice/${INV}?paid=1`);
    expect(settleInvoice).toHaveBeenCalledWith(INV);
  });

  it("is refused wherever real Stripe is configured — no free adverts by direct POST", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_1");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_live_1");
    db(issued);
    await expect(simulateInvoicePayment(form({ invoice_id: INV }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(settleInvoice).not.toHaveBeenCalled();
  });

  it("won't settle another member's invoice", async () => {
    db({ ...issued, member_id: "someone-else" });
    await simulateInvoicePayment(form({ invoice_id: INV })).catch(() => {});
    expect(settleInvoice).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInvoiceCheckoutSession, simulateInvoicePayment } from "@/app/dashboard/pay/invoice/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireMember, settleInvoice, invoiceCheckoutSecret } = vi.hoisted(() => ({
  requireMember: vi.fn(async (): Promise<CurrentUser & { memberId: string }> => ({
    userId: "u1", email: "ops@acme.example", role: "member", memberId: "m1", displayName: "Acme",
  })),
  settleInvoice: vi.fn(async () => ({ settled: true, memberId: "m1" })),
  invoiceCheckoutSecret: vi.fn<(...args: unknown[]) => Promise<{ ok: true; clientSecret: string } | { ok: false; error: string; alreadyPaid?: boolean }>>(
    async () => ({ ok: true, clientSecret: "cs_1_secret" }),
  ),
}));
vi.mock("@/lib/auth", () => ({ requireMember }));
vi.mock("@/lib/advert-payments", () => ({ settleInvoice, invoiceCheckoutSecret }));

const INV = "11111111-1111-4111-8111-111111111111";
const issued = {
  id: INV, member_id: "m1", number: "SMI-ADV-1", amount_pennies: 65000, status: "issued", description: "Advert: x",
  checkout_session_id: null, checkout_expires_at: null,
};

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
  invoiceCheckoutSecret.mockReset().mockResolvedValue({ ok: true, clientSecret: "cs_1_secret" });
});

describe("createInvoiceCheckoutSession", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_1");
  });

  it("charges the invoice's own amount — the browser only names the invoice", async () => {
    db(issued);
    await expect(createInvoiceCheckoutSession(INV)).resolves.toBe("cs_1_secret");
    expect(invoiceCheckoutSecret).toHaveBeenCalledWith(
      expect.objectContaining({ id: INV, amount_pennies: 65000, description: "Advert: x", checkout_session_id: null }),
      { memberId: "m1", email: "ops@acme.example" },
      expect.stringContaining(`/dashboard/pay/invoice/${INV}?session_id={CHECKOUT_SESSION_ID}`),
    );
  });

  it("refuses someone else's invoice", async () => {
    db({ ...issued, member_id: "someone-else" });
    await expect(createInvoiceCheckoutSession(INV)).rejects.toThrow(/can't be paid/);
    expect(invoiceCheckoutSecret).not.toHaveBeenCalled();
  });

  // Review finding 10: a membership invoice reached advert checkout by direct URL.
  it("refuses a membership invoice — it's paid through the subscription", async () => {
    db({ ...issued, number: "SMI-JOIN-MG3K2Q" });
    await expect(createInvoiceCheckoutSession(INV)).rejects.toThrow(/can't be paid/);
    db({ ...issued, number: "SMI-2026-100" });
    await expect(createInvoiceCheckoutSession(INV)).rejects.toThrow(/can't be paid/);
    expect(invoiceCheckoutSecret).not.toHaveBeenCalled();
  });

  it("tells the member to refresh when the open session has just been paid", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db(issued);
    invoiceCheckoutSecret.mockResolvedValueOnce({ ok: false, error: "complete", alreadyPaid: true });
    await expect(createInvoiceCheckoutSession(INV)).rejects.toThrow(/just been paid/);
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

  it("won't settle a membership invoice", async () => {
    db({ ...issued, number: "SMI-JOIN-MG3K2Q" });
    await simulateInvoicePayment(form({ invoice_id: INV })).catch(() => {});
    expect(settleInvoice).not.toHaveBeenCalled();
  });

  it("won't settle another member's invoice", async () => {
    db({ ...issued, member_id: "someone-else" });
    await simulateInvoicePayment(form({ invoice_id: INV })).catch(() => {});
    expect(settleInvoice).not.toHaveBeenCalled();
  });
});

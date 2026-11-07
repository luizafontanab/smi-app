import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MemberPayPage from "@/app/dashboard/pay/page";
import { PayForm } from "@/app/dashboard/pay/PayForm";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { MemberView } from "@/lib/auth";

// logError is the seam these failure paths report through (docs/logging.md);
// mocked so a test never writes to the real error log.
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));
afterEach(() => logError.mockReset());

/**
 * /dashboard/pay with embedded Checkout (GAPS B1.7): what Stripe's return
 * (`?session_id=`) may record, and for whom. The recording itself, and its
 * once-only guarantee, is tested in membership.test.ts and stripe-webhook.test.ts.
 */
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireMemberView, recordMembershipCheckout, retrieveCheckoutSession } = vi.hoisted(() => ({
  requireMemberView: vi.fn(async (): Promise<MemberView> => ({ memberId: "m1", email: "ops@acme.example", viewingAs: null })),
  recordMembershipCheckout: vi.fn(async () => true),
  retrieveCheckoutSession: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireMemberView }));
vi.mock("@/lib/membership", () => ({ recordMembershipCheckout }));
vi.mock("@/lib/adapters/advert-checkout", async (orig) => ({
  ...(await orig<typeof import("@/lib/adapters/advert-checkout")>()),
  retrieveCheckoutSession,
}));
vi.mock("@/app/dashboard/pay/actions", () => ({ payMembership: vi.fn() }));

const paidSession = (over: Record<string, unknown> = {}) => ({
  status: "complete", paymentStatus: "paid", invoiceId: null, kind: "membership", clientSecret: null,
  amountTotal: 4000, currency: "gbp", clientReferenceId: "m1", memberId: "m1", subscriptionId: "sub_1", customerId: "cus_1",
  ...over,
});

// The page reads the member twice when it records a payment: before, and after.
let member: { status: string; paid_at: string | null; comped_until: string | null };
function db() {
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ members: () => queryBuilder(dbOk({ ...member })) }) })));
}

const open = (searchParams: Record<string, string> = {}) =>
  MemberPayPage({ searchParams: Promise.resolve(searchParams) } as never);

function elements(node: unknown): { type: unknown; props: Record<string, unknown> }[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const el = node as { type: unknown; props: Record<string, unknown> };
  return [el, ...elements(el.props.children)];
}

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_1");
  vi.stubEnv("MOCK_INTEGRATIONS", "");
  member = { status: "draft", paid_at: null, comped_until: null };
  recordMembershipCheckout.mockImplementation(async () => {
    member.paid_at = "2026-10-29T10:00:00Z";
    return true;
  });
  retrieveCheckoutSession.mockResolvedValue(paidSession());
  db();
});
afterEach(() => {
  resetDbServerMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("/dashboard/pay — Stripe's return", () => {
  it("records the member's own paid session and moves them on to step 3", async () => {
    await expect(open({ session_id: "cs_live_1" })).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=paid");
    expect(recordMembershipCheckout).toHaveBeenCalledWith("m1", { sessionId: "cs_live_1", subscriptionId: "sub_1", customerId: "cus_1" });
  });

  it("ignores another member's session: the id in the URL is not proof", async () => {
    retrieveCheckoutSession.mockResolvedValueOnce(paidSession({ clientReferenceId: "m2", memberId: "m2" }));
    await expect(open({ session_id: "cs_live_2" })).resolves.toBeTruthy();
    expect(retrieveCheckoutSession).toHaveBeenCalledWith("cs_live_2");
    expect(recordMembershipCheckout).not.toHaveBeenCalled();
  });

  it("ignores an advert session, even the member's own", async () => {
    retrieveCheckoutSession.mockResolvedValueOnce(paidSession({ kind: "advert_invoice" }));
    await open({ session_id: "cs_live_3" });
    expect(retrieveCheckoutSession).toHaveBeenCalledWith("cs_live_3");
    expect(recordMembershipCheckout).not.toHaveBeenCalled();
  });

  it("records nothing for a session not yet paid, and says so", async () => {
    retrieveCheckoutSession.mockResolvedValueOnce(paidSession({ status: "open", paymentStatus: "unpaid" }));
    const tree = elements(await open({ session_id: "cs_live_4" }));
    expect(recordMembershipCheckout).not.toHaveBeenCalled();
    const text = tree.flatMap((el) => [el.props.children].flat().filter((c) => typeof c === "string")).join("");
    expect(text).toContain("haven't received confirmation");
  });

  it("still renders when the fast-path record fails — the webhook retries until it lands", async () => {
    recordMembershipCheckout.mockRejectedValueOnce(new Error("connection reset"));
    await expect(open({ session_id: "cs_live_5" })).resolves.toBeTruthy();
  });

  it("sends a member the webhook already recorded straight on, without asking Stripe", async () => {
    member.paid_at = "2026-10-29T09:59:00Z";
    await expect(open({ session_id: "cs_live_6" })).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=paid");
    expect(retrieveCheckoutSession).not.toHaveBeenCalled();
  });

  it("never reads a session back on the hosted-redirect path (no publishable key)", async () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");
    await open({ session_id: "cs_live_7" });
    expect(retrieveCheckoutSession).not.toHaveBeenCalled();
  });
});

describe("/dashboard/pay — the form", () => {
  it("gives the form what it needs to open the embedded modal", async () => {
    const form = elements(await open()).find((el) => el.type === PayForm);
    expect(form?.props.embed).toEqual({ publishableKey: "pk_test_1", stripeJsUrl: "https://js.stripe.com/dahlia/stripe.js" });
  });

  it("gives it none without a publishable key, so the form keeps the hosted redirect", async () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");
    const form = elements(await open()).find((el) => el.type === PayForm);
    expect(form?.props.embed).toBeNull();
  });

  // Fix-list 94: an admin viewing as the member only looks.
  it("while an admin is viewing as the member: no recording, no form", async () => {
    requireMemberView.mockResolvedValueOnce({ memberId: "m1", email: "ops@acme.example", viewingAs: { adminUserId: "a1", adminName: "Jas" } });
    const tree = elements(await open({ session_id: "cs_live_8" }));
    expect(retrieveCheckoutSession).not.toHaveBeenCalled();
    expect(recordMembershipCheckout).not.toHaveBeenCalled();
    expect(tree.some((el) => el.type === PayForm)).toBe(false);
  });
});

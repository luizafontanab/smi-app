import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccount } from "@/app/(public)/join/account/actions";
import { sessionDb } from "@/lib/db/server";
import { asDb, mockDb } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { ProvisionResult } from "@/lib/membership";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { allowRequest, provisionMember, notifyAdminFunnel, enqueue } = vi.hoisted(() => ({
  allowRequest: vi.fn(async () => true),
  provisionMember: vi.fn(async (): Promise<ProvisionResult> => ({ memberId: "m1" })),
  notifyAdminFunnel: vi.fn(async () => {}),
  enqueue: vi.fn(async () => {}),
}));
vi.mock("@/lib/rate-limit", () => ({ allowRequest, HOUR: 3_600_000 }));
vi.mock("@/lib/membership", () => ({ provisionMember }));
vi.mock("@/lib/notify-admin", () => ({ notifyAdminFunnel }));
vi.mock("@/lib/jobs", () => ({ enqueue }));

afterEach(() => {
  resetDbServerMocks();
  allowRequest.mockReset().mockResolvedValue(true);
  provisionMember.mockReset().mockResolvedValue({ memberId: "m1" });
  notifyAdminFunnel.mockReset().mockResolvedValue(undefined);
  enqueue.mockReset().mockResolvedValue(undefined);
});

function form(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const base = { email: "founder@acme.example", password: "correcthorse", company: "Acme Ltd" };
  for (const [k, v] of Object.entries({ ...base, ...overrides })) fd.set(k, v);
  return fd;
}

function stubSignIn() {
  const signInWithPassword = vi.fn(async () => ({ data: {}, error: null }));
  vi.mocked(sessionDb).mockResolvedValue(asDb(mockDb({ auth: { signInWithPassword } })));
  return signInWithPassword;
}

describe("createAccount", () => {
  it("rejects a malformed email before ever hitting the rate limiter", async () => {
    const result = await createAccount({ message: "" }, form({ email: "not-an-email" }));
    expect(result).toEqual({ message: "Please enter a valid email." });
    expect(allowRequest).not.toHaveBeenCalled();
  });

  it("requires an 8-character password", async () => {
    const result = await createAccount({ message: "" }, form({ password: "short" }));
    expect(result).toEqual({ message: "Password needs at least 8 characters." });
  });

  it("requires a company name", async () => {
    const result = await createAccount({ message: "" }, form({ company: "  " }));
    expect(result).toEqual({ message: "Company name is required." });
  });

  it("refuses over the join-flow rate limit without provisioning anything", async () => {
    allowRequest.mockResolvedValue(false);
    const result = await createAccount({ message: "" }, form());
    expect(result!.message).toContain("Too many attempts");
    expect(provisionMember).not.toHaveBeenCalled();
  });

  it("surfaces provisionMember's error rather than proceeding", async () => {
    provisionMember.mockResolvedValue({ error: "That email is already registered." });
    const result = await createAccount({ message: "" }, form());
    expect(result).toEqual({ message: "That email is already registered." });
    expect(notifyAdminFunnel).not.toHaveBeenCalled();
  });

  it("notifies Jas by email, queues the member's welcome email, signs them in, and redirects to payment", async () => {
    const signIn = stubSignIn();

    await expect(createAccount({ message: "" }, form({ email: "Founder@Acme.example" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/pay");

    expect(provisionMember).toHaveBeenCalledWith({ email: "founder@acme.example", password: "correcthorse", company: "Acme Ltd" });
    // Two separate axes (fix-list 71): `kind`/`category` say what the console
    // inbox row IS, and `emailKind` names the editable template the email to
    // Jas is rendered from. A signup is a notification — nothing to reply to —
    // and it carries the member id so the row can link to their record.
    expect(notifyAdminFunnel).toHaveBeenCalledWith(expect.objectContaining({
      category: "notification",
      kind: "signup_started",
      emailKind: "admin_new_signup",
      name: "Acme Ltd",
      memberId: "m1",
      payload: { member_id: "m1" },
    }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", { member_id: "m1", kind: "welcome" });
    expect(signIn).toHaveBeenCalledWith({ email: "founder@acme.example", password: "correcthorse" });
  });

  it("passes through optional phone/website/address when given, so the draft page starts pre-filled", async () => {
    stubSignIn();

    await expect(createAccount({ message: "" }, form({ phone: " 0121 000 0000 ", website: " https://acme.example ", address: " 1 Foundry Rd " })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/pay");

    expect(provisionMember).toHaveBeenCalledWith({
      email: "founder@acme.example",
      password: "correcthorse",
      company: "Acme Ltd",
      phone: "0121 000 0000",
      website: "https://acme.example",
      address: "1 Foundry Rd",
    });
  });

  it("still signs the member in and redirects even when the welcome email fails to queue", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubSignIn();
    enqueue.mockRejectedValue(new Error("queue unavailable"));

    await expect(createAccount({ message: "" }, form())).rejects.toThrow("NEXT_REDIRECT:/dashboard/pay");

    expect(errorSpy).toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth";

const { requireConsole } = vi.hoisted(() => ({ requireConsole: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireConsole }));

import { isDeveloper, requireDeveloper } from "@/lib/developer";

const admin = (email: string): CurrentUser => ({ userId: "u1", email, role: "admin", memberId: null, displayName: null });

afterEach(() => {
  vi.unstubAllEnvs();
  requireConsole.mockReset();
});

// docs/logging.md: the error log is developer-only, and Jas is an admin too,
// so the allowlist — not the role — is the gate.
describe("developer gate", () => {
  it("lets in only admins whose email is on DEVELOPER_EMAILS, case-insensitively", () => {
    vi.stubEnv("DEVELOPER_EMAILS", " Dev@Example.com , other@example.com");
    expect(isDeveloper(admin("dev@example.com"))).toBe(true);
    expect(isDeveloper(admin("jas@example.com"))).toBe(false);
    expect(isDeveloper({ ...admin("dev@example.com"), role: "member" })).toBe(false);
    expect(isDeveloper(null)).toBe(false);
  });

  it("lets nobody in when the allowlist is unset", () => {
    vi.stubEnv("DEVELOPER_EMAILS", "");
    expect(isDeveloper(admin("dev@example.com"))).toBe(false);
  });

  it("404s an admin who isn't a developer, rather than revealing the page", async () => {
    vi.stubEnv("DEVELOPER_EMAILS", "dev@example.com");
    requireConsole.mockResolvedValue(admin("jas@example.com"));
    await expect(requireDeveloper()).rejects.toThrow("NEXT_NOT_FOUND");

    requireConsole.mockResolvedValue(admin("dev@example.com"));
    await expect(requireDeveloper()).resolves.toMatchObject({ email: "dev@example.com" });
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { cookies } from "next/headers";
import { DevTaskLauncher } from "@/components/dev-task/DevTaskLauncher";
import { currentUser, isAdmin } from "@/lib/auth";
import { cookieStore, resetNextHeadersMocks } from "../stubs/next-headers";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/auth", () => ({ currentUser: vi.fn(), isAdmin: vi.fn() }));
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const ADMIN = { userId: "u1", email: "jas@smi.local", role: "admin" as const, memberId: null, displayName: "Jas" };

afterEach(() => {
  vi.mocked(currentUser).mockReset();
  vi.mocked(isAdmin).mockReset();
  resetNextHeadersMocks();
  resetDbServerMocks();
});

describe("DevTaskLauncher", () => {
  it("renders nothing for an anonymous visitor (no sb- cookie at all)", async () => {
    const { container } = render(<>{await DevTaskLauncher()}</>);
    expect(container).toBeEmptyDOMElement();
    expect(currentUser).not.toHaveBeenCalled();
  });

  it("renders nothing for a signed-in non-admin", async () => {
    cookieStore.set("sb-access-token", "x");
    vi.mocked(currentUser).mockResolvedValue({ ...ADMIN, role: "member" });
    vi.mocked(isAdmin).mockReturnValue(false);
    const { container } = render(<>{await DevTaskLauncher()}</>);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the widget for a signed-in admin, named by display name", async () => {
    cookieStore.set("sb-access-token", "x");
    vi.mocked(currentUser).mockResolvedValue(ADMIN);
    vi.mocked(isAdmin).mockReturnValue(true);
    render(<>{await DevTaskLauncher()}</>);
    expect(screen.getByRole("button", { name: "Feedback" })).toBeInTheDocument();
    expect(cookies).toHaveBeenCalled();
  });
});

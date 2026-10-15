// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { cookies } from "next/headers";
import { usePathname } from "next/navigation";
import { ThemeLauncher } from "@/components/ThemeLauncher";
import { currentUser, isAdmin } from "@/lib/auth";
import { cookieStore, resetNextHeadersMocks } from "../stubs/next-headers";

vi.mock("@/lib/auth", () => ({ currentUser: vi.fn(), isAdmin: vi.fn() }));

// The switcher is switched off site-wide (lib/theme-switcher-flag.ts), but the
// tests below cover how it behaves when it is back on. A getter, so one test
// can flip it off without a second file.
const flag = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/theme-switcher-flag", () => ({
  get THEME_SWITCHER_ENABLED() {
    return flag.enabled;
  },
}));

const ADMIN = { userId: "u1", email: "jas@smi.local", role: "admin" as const, memberId: null, displayName: "Jas" };

function signedInAdmin() {
  cookieStore.set("sb-access-token", "x");
  vi.mocked(currentUser).mockResolvedValue(ADMIN);
  vi.mocked(isAdmin).mockReturnValue(true);
}

beforeEach(() => {
  // The next/navigation alias is module-level; set a value per test rather than
  // relying on the stub's default, which a mockReset() elsewhere would drop.
  vi.mocked(usePathname).mockReturnValue("/");
});

afterEach(() => {
  flag.enabled = true;
  vi.mocked(currentUser).mockReset();
  vi.mocked(isAdmin).mockReset();
  vi.mocked(usePathname).mockReturnValue("/");
  resetNextHeadersMocks();
});

describe("ThemeLauncher", () => {
  it("renders nothing, even for an admin, while the switcher is switched off", async () => {
    flag.enabled = false;
    signedInAdmin();
    // The stub's cookies() call count is never reset between tests.
    vi.mocked(cookies).mockClear();
    const { container } = render(<>{await ThemeLauncher()}</>);
    expect(container).toBeEmptyDOMElement();
    // Off means off before any work: no cookie read, no auth round-trip.
    expect(cookies).not.toHaveBeenCalled();
    expect(currentUser).not.toHaveBeenCalled();
  });

  it("renders nothing for an anonymous visitor (no sb- cookie at all)", async () => {
    const { container } = render(<>{await ThemeLauncher()}</>);
    expect(container).toBeEmptyDOMElement();
    // The point of the cookie pre-test: no auth round-trip on a public page view.
    expect(currentUser).not.toHaveBeenCalled();
  });

  it("renders nothing for a signed-in non-admin", async () => {
    cookieStore.set("sb-access-token", "x");
    vi.mocked(currentUser).mockResolvedValue({ ...ADMIN, role: "member" });
    vi.mocked(isAdmin).mockReturnValue(false);
    const { container } = render(<>{await ThemeLauncher()}</>);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the collapsed chip for an admin, with the designs not yet exposed", async () => {
    signedInAdmin();
    render(<>{await ThemeLauncher()}</>);

    const chip = screen.getByRole("button", { name: "Theme" });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(cookies).toHaveBeenCalled();
    // hidden keeps the panel out of the accessibility tree, so *byRole cannot
    // see the design buttons until it is opened.
    expect(screen.queryByRole("button", { name: "Forge" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Grid" })).not.toBeInTheDocument();
  });

  it("expands to the design switcher when the chip is clicked, and collapses again", async () => {
    signedInAdmin();
    render(<>{await ThemeLauncher()}</>);

    const chip = screen.getByRole("button", { name: "Theme" });
    fireEvent.click(chip);

    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grid" })).toBeInTheDocument();
    // aria-controls has to point at something real, open or shut.
    expect(document.getElementById(chip.getAttribute("aria-controls")!)).not.toBeNull();

    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Forge" })).not.toBeInTheDocument();
  });

  it("floats clear of the Feedback button and the dev indicator, and drops out of print", async () => {
    signedInAdmin();
    render(<>{await ThemeLauncher()}</>);

    // Bottom-LEFT because bottom-right is DevTaskWidget's Feedback button, and
    // bottom-20 rather than bottom-4 because Next's dev-tools badge sits in the
    // bottom-left corner and would make the chip unclickable under `next dev`.
    // These are requirements, not decoration.
    const dock = screen.getByRole("button", { name: "Theme" }).parentElement!;
    expect(dock).toHaveClass("fixed", "bottom-20", "left-4", "z-50", "print:hidden");
  });

  it("stays out of the console, where the header already carries a switcher", async () => {
    signedInAdmin();
    vi.mocked(usePathname).mockReturnValue("/console/adverts");
    const { container } = render(<>{await ThemeLauncher()}</>);
    expect(container).toBeEmptyDOMElement();
  });
});

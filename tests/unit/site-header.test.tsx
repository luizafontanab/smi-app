// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { memberAccountLinks, SiteHeader } from "@/components/SiteHeader";
import type { CurrentUser } from "@/lib/auth";

// SiteHeader passes the shared signOut server action into the account menu;
// its module graph (db, rate-limit) has no place in a jsdom render.
vi.mock("@/app/actions", () => ({ signOut: vi.fn() }));

function user(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return { userId: "u1", email: "member@acme.test", role: "member", memberId: "m1", displayName: "Acme Co", ...overrides };
}

describe("logged out", () => {
  it("shows join/login links and no account menu", () => {
    render(<SiteHeader user={null} />);
    // MobileNav also renders these, but its <dialog> starts closed, which
    // excludes its content from the accessibility tree until opened.
    expect(screen.getByRole("link", { name: "Become a Member" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Login" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Account:/ })).not.toBeInTheDocument();
  });
});

// Grid shares forge's structure — menus right of the mark — in a light tone.
describe("light tone (grid design)", () => {
  it("renders forge's menus and actions on a light bar with the ink mark", () => {
    const { container } = render(<SiteHeader user={null} tone="light" />);
    expect(container.querySelector("header")).toHaveClass("bg-white");
    expect(container.querySelector("header img")).toHaveAttribute("src", "/logo-wide-ink.svg");
    expect(screen.getByRole("button", { name: /Media/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Members/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Featured Machine" })).toHaveAttribute("href", "/featured-machine");
    expect(screen.getByRole("link", { name: "Events" })).toHaveAttribute("href", "/event");
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("href", "/search");
    expect(screen.getByRole("link", { name: "Become a Member" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Login" })).toBeInTheDocument();
  });

  // The bar's own controls only — the mobile drawer has its own (light) palette.
  it("keeps near-black hovers off the light bar", () => {
    render(<SiteHeader user={null} tone="light" />);
    for (const el of [
      screen.getByRole("button", { name: /Media/ }),
      screen.getByRole("link", { name: "Featured Machine" }),
      screen.getByRole("link", { name: "Login" }),
      screen.getByRole("button", { name: "Open menu" }),
    ]) {
      expect(el.className).not.toContain("chrome-hover");
      expect(el.className).toContain("hover:bg-shade");
    }
  });
});

describe("logged in", () => {
  it("member gets the account menu with member area, notifications and help", () => {
    render(<SiteHeader user={user({ role: "member" })} />);
    expect(screen.getByRole("button", { name: "Account: Acme Co" })).toHaveAttribute("aria-haspopup", "true");
    expect(screen.getByRole("link", { name: "Member area" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Notifications" })).toHaveAttribute("href", "/dashboard/notifications");
    expect(screen.getByRole("link", { name: "Help" })).toHaveAttribute("href", "/dashboard/help");
    expect(screen.queryByRole("link", { name: "What's new" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Become a Member" })).not.toBeInTheDocument();
  });

  it("admin gets the console entries and no help link", () => {
    render(<SiteHeader user={user({ role: "admin", displayName: "Jas" })} />);
    expect(screen.getByRole("button", { name: "Account: Jas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Admin console" })).toHaveAttribute("href", "/console");
    expect(screen.getByRole("link", { name: "Notifications" })).toHaveAttribute("href", "/console/notifications");
    expect(screen.getByRole("link", { name: "What's new" })).toHaveAttribute("href", "/console/releases");
    expect(screen.queryByRole("link", { name: "Help" })).not.toBeInTheDocument();
  });

  it("falls back to the email when there is no display name", () => {
    render(<SiteHeader user={user({ displayName: null, email: "someone@acme.test" })} />);
    expect(screen.getByRole("button", { name: "Account: someone@acme.test" })).toBeInTheDocument();
  });
});

describe("memberAccountLinks", () => {
  // The member area renders this directly — so an admin viewing as a member
  // (fix-list 94) sees the member's menu, not the console's.
  it("is the member menu, with the unread count as a badge only when there is one", () => {
    expect(memberAccountLinks(3)).toEqual([
      { href: "/dashboard", label: "Member area" },
      { href: "/dashboard/notifications", label: "Notifications", badge: 3 },
      { href: "/dashboard/help", label: "Help" },
    ]);
    expect(memberAccountLinks(0)[1].badge).toBeUndefined();
  });
});

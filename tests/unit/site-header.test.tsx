// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteHeader } from "@/components/SiteHeader";
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

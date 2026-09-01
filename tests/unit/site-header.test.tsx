// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteHeader } from "@/components/SiteHeader";
import type { CurrentUser } from "@/lib/auth";

function user(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return { userId: "u1", email: "member@acme.test", role: "member", memberId: "m1", displayName: "Acme Co", ...overrides };
}

describe("logged out", () => {
  it("shows join/login links and no account pill", () => {
    render(<SiteHeader user={null} />);
    // MobileNav also renders these, but its <dialog> starts closed, which
    // excludes its content from the accessibility tree until opened.
    expect(screen.getByRole("link", { name: "Become a Member" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Login" })).toBeInTheDocument();
  });
});

describe("logged in", () => {
  it("member role links to the dashboard", () => {
    render(<SiteHeader user={user({ role: "member" })} />);
    const links = screen.getAllByRole("link", { name: "Acme Co" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("link", { name: "Become a Member" })).not.toBeInTheDocument();
  });

  it("non-member role links to the console", () => {
    render(<SiteHeader user={user({ role: "admin", displayName: "Jas" })} />);
    expect(screen.getAllByRole("link", { name: "Jas" })[0]).toHaveAttribute("href", "/console");
  });

  it("falls back to the email when there is no display name", () => {
    render(<SiteHeader user={user({ displayName: null, email: "someone@acme.test" })} />);
    expect(screen.getAllByRole("link", { name: "someone@acme.test" })).toHaveLength(1);
  });
});

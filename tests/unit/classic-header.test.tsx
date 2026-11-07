// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { ClassicHeader } from "@/components/classic/ClassicHeader";
import type { CurrentUser } from "@/lib/auth";

// The header passes the shared signOut server action into the account menu;
// its module graph (db, rate-limit) has no place in a jsdom render.
vi.mock("@/app/actions", () => ({ signOut: vi.fn() }));

afterEach(() => {
  vi.mocked(usePathname).mockReset();
});

/**
 * Seam 2 of the Classic design option (#68, #71): the Classic header, rendered
 * with the same props as Current's SiteHeader. MobileNav's drawer also lists
 * News and Events, but its <dialog> starts closed, which keeps those links out
 * of the accessibility tree — so a role query finds the flat menu's alone.
 */
function at(path: string) {
  vi.mocked(usePathname).mockReturnValue(path);
  render(<ClassicHeader user={null} />);
}

describe("the flat menu's current section", () => {
  it("is News on /news", () => {
    at("/news");
    expect(screen.getByRole("link", { name: "News" })).toHaveAttribute("aria-current", "page");
  });

  it("is News on a story under /news", () => {
    at("/news/some-story");
    expect(screen.getByRole("link", { name: "News" })).toHaveAttribute("aria-current", "true");
  });

  it("is Newsletters, not News, on a newsletter issue", () => {
    at("/newsletters/issue-12");
    expect(screen.getByRole("link", { name: "News" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Newsletters" })).toHaveAttribute("aria-current", "true");
  });

  it("marks one item at most, and Home only on the home page", () => {
    at("/news/some-story");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(document.querySelectorAll('[data-part="site-menu"] [aria-current]')).toHaveLength(1);
  });

  it("is Home on /", () => {
    at("/");
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(document.querySelectorAll('[data-part="site-menu"] [aria-current]')).toHaveLength(1);
  });
});

describe("the account controls", () => {
  const member: CurrentUser = { userId: "u1", email: "member@acme.test", role: "member", memberId: "m1", displayName: "Acme Co" };

  it("show the login icon and no account menu when signed out", () => {
    at("/");
    expect(screen.getByRole("link", { name: "Member login" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("button", { name: /Account:/ })).not.toBeInTheDocument();
  });

  it("show the account menu with the unread count, and no login icon, when signed in", () => {
    vi.mocked(usePathname).mockReturnValue("/");
    render(<ClassicHeader user={member} unread={3} />);
    expect(screen.getByRole("button", { name: "Account: Acme Co, 3 unread notifications" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Notifications, 3 unread" })).toHaveAttribute("href", "/dashboard/notifications");
    expect(screen.queryByRole("link", { name: "Member login" })).not.toBeInTheDocument();
  });

  it("keep search in the bar", () => {
    at("/");
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("href", "/search");
  });
});

describe("keyboard", () => {
  it("sets no positive tabindex (the live site's tabindex=1 is not copied)", () => {
    at("/");
    const positive = [...document.querySelectorAll("[tabindex]")].filter((el) => Number(el.getAttribute("tabindex")) > 0);
    expect(positive).toEqual([]);
  });
});

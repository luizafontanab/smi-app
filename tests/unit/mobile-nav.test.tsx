// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MobileNav } from "@/components/MobileNav";

// jsdom doesn't implement <dialog>'s showModal()/close() (they no-op instead
// of toggling the `open` attribute) — drive them directly so the component's
// own onClose handler (which refocuses the trigger) still fires.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

describe("MobileNav", () => {
  it("opens the drawer from the hamburger button", () => {
    render(<MobileNav user={null} />);
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(dialog).toHaveAttribute("open");
  });

  it("closing returns focus to the hamburger trigger", () => {
    render(<MobileNav user={null} />);
    const trigger = screen.getByRole("button", { name: "Open menu" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.getByRole("dialog", { hidden: true })).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
  });

  it("a link click closes the drawer", () => {
    render(<MobileNav user={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.click(screen.getByRole("link", { name: "Events" }));
    expect(screen.getByRole("dialog", { hidden: true })).not.toHaveAttribute("open");
  });

  it("shows the account links instead of join/login links once opened for a signed-in user", () => {
    render(<MobileNav
      user={{ userId: "u1", email: "member@acme.test", role: "member", memberId: "m1", displayName: "Acme Co" }}
      accountLinks={[
        { href: "/dashboard", label: "Member area" },
        { href: "/dashboard/help", label: "Help" },
      ]}
      signOutAction={async () => {}}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("link", { name: "Member area" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Help" })).toHaveAttribute("href", "/dashboard/help");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Become a Member" })).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountForm } from "@/app/(public)/join/account/AccountForm";

// The form only hands the action to useActionState; nothing here submits.
vi.mock("@/app/(public)/join/account/actions", () => ({ createAccount: vi.fn() }));

const types = [{ id: 1, name: "Equipment Supplier" }, { id: 2, name: "Software" }];

// #33: the right keyboard and autofill token per field, so a phone offers a
// generated password and fills company, phone and address.
describe("AccountForm field hints", () => {
  it.each([
    ["Company name", "organization", "text"],
    ["Email", "email", "email"],
    ["Password (8+ characters)", "new-password", "password"],
    ["Phone (optional)", "tel", "tel"],
    ["Address (optional)", "street-address", "text"],
  ])("%s has autocomplete=%s", (label, token, type) => {
    render(<AccountForm membershipTypes={types} maxTypes={3} />);
    const input = screen.getByLabelText(new RegExp(`^${label.replace(/[()+]/g, "\\$&")}`));
    expect(input).toHaveAttribute("autocomplete", token);
    expect((input as HTMLInputElement).type).toBe(type);
  });

  it("gives the website a URL keyboard without demanding a scheme", () => {
    render(<AccountForm membershipTypes={types} maxTypes={3} />);
    const website = screen.getByLabelText(/^Website/);
    expect(website).toHaveAttribute("inputmode", "url");
    expect(website).toHaveAttribute("autocomplete", "url");
    // type=url would reject "acme.co.uk", which the action accepts.
    expect((website as HTMLInputElement).type).toBe("text");
  });

  it("labels every business-type checkbox so the whole row is the tap target", () => {
    render(<AccountForm membershipTypes={types} maxTypes={3} />);
    expect(screen.getByRole("checkbox", { name: "Equipment Supplier" })).toHaveAttribute("name", "membership_types");
    expect(screen.getByRole("checkbox", { name: "Software" })).toHaveAttribute("value", "2");
  });
});

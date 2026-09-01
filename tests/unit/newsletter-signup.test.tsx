// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
});

describe("NewsletterSignup", () => {
  it("renders an email field and a subscribe button", () => {
    render(<NewsletterSignup />);
    const email = screen.getByPlaceholderText("you@company.co.uk");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toBeRequired();
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
  });
});

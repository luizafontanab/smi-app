// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContactForm } from "@/components/ContactForm";
import { resetDbServerMocks } from "../stubs/db-server";

// sendContactMessage -> serviceDb.
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
});

describe("ContactForm", () => {
  it("carries its kind in a hidden field", () => {
    const { container } = render(<ContactForm kind="advertising" />);
    expect(container.querySelector('input[type="hidden"][name="kind"]')).toHaveValue("advertising");
  });

  it("labels the message field per kind", () => {
    const { rerender } = render(<ContactForm kind="contact" />);
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    rerender(<ContactForm kind="advertising" />);
    expect(screen.getByLabelText("What are you interested in?")).toBeInTheDocument();
  });

  it("requires name, email, and message", () => {
    render(<ContactForm kind="contact" />);
    expect(screen.getByLabelText("Name")).toBeRequired();
    expect(screen.getByLabelText("Email")).toBeRequired();
    expect(screen.getByLabelText("Message")).toBeRequired();
  });
});

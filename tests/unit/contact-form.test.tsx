// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContactForm } from "@/components/ContactForm";
import { resetDbServerMocks } from "../stubs/db-server";

// sendContactMessage -> serviceDb.
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

// Held open by hand so the in-flight render is observable rather than raced past.
const { sendContactMessage } = vi.hoisted(() => ({ sendContactMessage: vi.fn() }));
vi.mock("@/app/(public)/actions", () => ({ sendContactMessage }));

afterEach(() => {
  resetDbServerMocks();
  sendContactMessage.mockReset();
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

  it("gives name and email autofill hints so phones can fill them (#33)", () => {
    render(<ContactForm kind="advertising" />);
    expect(screen.getByLabelText("Name")).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
  });

  it("keeps the status region silent but present before anything is sent", () => {
    // The live region has to exist in the initial DOM or a screen reader has
    // nothing to announce into when the result lands.
    render(<ContactForm kind="contact" />);
    const status = document.getElementById("contact-status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveClass("sr-only");
  });

  it("disables the button while sending, then announces the result", async () => {
    let resolveAction: (value: { message: string }) => void = () => {};
    sendContactMessage.mockImplementation(
      () => new Promise<{ message: string }>((resolve) => { resolveAction = resolve; }),
    );

    render(<ContactForm kind="contact" />);
    // All three fields are required, so an incomplete form never fires submit.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sam Smith" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@fabricators.test" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Please call me back." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Sending…"));
    expect(screen.getByRole("button")).toBeDisabled();

    await act(async () => {
      resolveAction({ message: "Thanks — we'll be in touch." });
    });

    await waitFor(() => expect(screen.getByText("Thanks — we'll be in touch.")).toBeInTheDocument());
    expect(document.getElementById("contact-status")).toHaveClass("text-sm", "text-graphite");
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });
});

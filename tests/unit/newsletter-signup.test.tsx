// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

// The server action is what useActionState drives; held open by hand below so
// the in-flight render is observable rather than raced past.
const { subscribeNewsletter } = vi.hoisted(() => ({ subscribeNewsletter: vi.fn() }));
vi.mock("@/app/(public)/actions", () => ({ subscribeNewsletter }));

afterEach(() => {
  resetDbServerMocks();
  subscribeNewsletter.mockReset();
});

describe("NewsletterSignup", () => {
  it("renders an email field and a subscribe button", () => {
    subscribeNewsletter.mockResolvedValue({ message: "" });
    render(<NewsletterSignup surface="footer" />);
    const email = screen.getByPlaceholderText("you@company.co.uk");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toBeRequired();
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
  });

  it("keeps the status region silent but present before anything is submitted", () => {
    // The live region has to exist in the initial DOM or a screen reader has
    // nothing to announce into when the result lands.
    subscribeNewsletter.mockResolvedValue({ message: "" });
    render(<NewsletterSignup surface="footer" />);
    const status = document.getElementById("newsletter-status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveClass("sr-only");
  });

  it("disables the button while the subscription is in flight, then shows the result", async () => {
    let resolveAction: (value: { message: string }) => void = () => {};
    subscribeNewsletter.mockImplementation(
      () => new Promise<{ message: string }>((resolve) => { resolveAction = resolve; }),
    );

    render(<NewsletterSignup surface="footer" />);
    // The email field is required, so an empty form never fires submit at all.
    fireEvent.change(screen.getByPlaceholderText("you@company.co.uk"), {
      target: { value: "reader@fabricators.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));

    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("…"));
    expect(screen.getByRole("button")).toBeDisabled();

    await act(async () => {
      resolveAction({ message: "Thanks — check your inbox." });
    });

    await waitFor(() => expect(screen.getByText("Thanks — check your inbox.")).toBeInTheDocument());
    // Visible now, so it drops sr-only and takes the emphasis class.
    expect(document.getElementById("newsletter-status")).toHaveClass("text-xs", "font-semibold");
    expect(screen.getByRole("button", { name: "Subscribe" })).not.toBeDisabled();
  });
});

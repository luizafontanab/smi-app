// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { RetryButton } from "@/components/RetryButton";

/**
 * #48 on the error pages: Next's retry() re-fetches the page but returns
 * nothing to wait on, so "Try again" goes off and says so on the first click,
 * and comes back if the page fails again (a new error) or nothing happens.
 */
describe("RetryButton", () => {
  afterEach(() => vi.useRealTimers());

  it("calls retry once, then is disabled and says it's trying", () => {
    const retry = vi.fn();
    render(<RetryButton retry={retry} error={new Error("x")} />);
    const button = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Trying again…" })).toBeDisabled();
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  });

  it("comes back when the retry fails with a new error", () => {
    const { rerender } = render(<RetryButton retry={() => {}} error={new Error("first")} />);
    fireEvent.click(screen.getByRole("button"));
    rerender(<RetryButton retry={() => {}} error={new Error("second")} />);
    expect(screen.getByRole("button", { name: "Try again" })).not.toBeDisabled();
  });

  it("comes back after a while if nothing happened", () => {
    vi.useFakeTimers();
    render(<RetryButton retry={() => {}} error={new Error("x")} />);
    fireEvent.click(screen.getByRole("button"));
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole("button", { name: "Try again" })).not.toBeDisabled();
  });
});

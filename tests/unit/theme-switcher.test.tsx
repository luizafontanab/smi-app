// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(useRouter).mockReset();
  document.cookie = "smi-theme=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC";
});

async function flushMountTimer() {
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
}

describe("ThemeSwitcher", () => {
  it("highlights whichever theme is currently stamped on <html>", async () => {
    document.documentElement.setAttribute("data-theme", "grid");
    render(<ThemeSwitcher />);
    await flushMountTimer();
    expect(screen.getByRole("button", { name: "Grid" })).toHaveClass("bg-brand");
    expect(screen.getByRole("button", { name: "Forge" })).not.toHaveClass("bg-brand");
  });

  it("switching theme updates the DOM attribute, the cookie, and refreshes the router", async () => {
    const refresh = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh, prefetch: vi.fn(),
      // Next 16 addition — see node_modules/next/dist/shared/lib/app-router-context.shared-runtime.d.ts
      bfcacheId: "test",
    });

    render(<ThemeSwitcher />);
    await flushMountTimer();
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("grid");
    expect(document.cookie).toContain("smi-theme=grid");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("compact mode renders just the toggle, no label", async () => {
    render(<ThemeSwitcher compact />);
    await flushMountTimer();
    expect(screen.queryByText("Theme")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forge" })).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CookieConsent } from "@/components/CookieConsent";
import { CONSENT_COOKIE } from "@/lib/consent";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  // jsdom's cookie jar isn't cleared by RTL's cleanup() — expire it explicitly.
  document.cookie = `${CONSENT_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC`;
});

async function flushMountTimer() {
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
}

describe("CookieConsent", () => {
  it("shows the banner after mount when no consent cookie is set", async () => {
    render(<CookieConsent />);
    expect(screen.queryByText(/We use cookies/)).not.toBeInTheDocument();
    await flushMountTimer();
    expect(screen.getByText(/We use cookies/)).toBeInTheDocument();
  });

  it("stays hidden when a consent cookie is already set", async () => {
    document.cookie = `${CONSENT_COOKIE}=all; path=/`;
    render(<CookieConsent />);
    await flushMountTimer();
    expect(screen.queryByText(/We use cookies/)).not.toBeInTheDocument();
  });

  it("accepting all hides the banner and stores the 'all' choice", async () => {
    render(<CookieConsent />);
    await flushMountTimer();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.queryByText(/We use cookies/)).not.toBeInTheDocument();
    expect(document.cookie).toContain(`${CONSENT_COOKIE}=all`);
  });

  it("choosing essential-only stores the 'essential' choice", async () => {
    render(<CookieConsent />);
    await flushMountTimer();
    fireEvent.click(screen.getByRole("button", { name: "Essential only" }));
    expect(document.cookie).toContain(`${CONSENT_COOKIE}=essential`);
  });
});

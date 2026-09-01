// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CookieSettingsLink } from "@/components/CookieSettingsLink";
import { CONSENT_COOKIE } from "@/lib/consent";

afterEach(() => {
  vi.restoreAllMocks();
  document.cookie = `${CONSENT_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC`;
});

describe("CookieSettingsLink", () => {
  it("expires the consent cookie and reloads the page", () => {
    document.cookie = `${CONSENT_COOKIE}=all; path=/`;
    // jsdom's location.reload isn't a configurable property to spy on directly —
    // replace the whole location object instead.
    const reload = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });

    render(<CookieSettingsLink />);
    fireEvent.click(screen.getByRole("button", { name: "Cookie settings" }));

    expect(document.cookie).not.toContain(`${CONSENT_COOKIE}=all`);
    expect(reload).toHaveBeenCalledOnce();
  });
});

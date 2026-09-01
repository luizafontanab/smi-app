// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { AdPreviewToggle } from "@/components/console/AdPreviewToggle";

afterEach(() => {
  vi.mocked(useRouter).mockReset();
  document.cookie = "smi-ads=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC";
});

describe("AdPreviewToggle", () => {
  it("turning preview on sets the cookie and refreshes", () => {
    const refresh = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh, prefetch: vi.fn(), bfcacheId: "test" });

    render(<AdPreviewToggle initialOn={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));

    expect(document.cookie).toContain("smi-ads=empty");
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Turn off" })).toHaveAttribute("aria-pressed", "true");
  });

  it("turning preview off expires the cookie", () => {
    vi.mocked(useRouter).mockReturnValue({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), bfcacheId: "test" });

    render(<AdPreviewToggle initialOn={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));

    expect(document.cookie).not.toContain("smi-ads=empty");
  });
});

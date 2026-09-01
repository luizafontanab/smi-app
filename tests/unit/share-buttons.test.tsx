// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ShareButtons } from "@/components/ShareButtons";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ShareButtons", () => {
  it("opens each network's share intent for the current page URL", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<ShareButtons />);
    fireEvent.click(screen.getByRole("button", { name: "Facebook" }));
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("https://www.facebook.com/sharer/sharer.php?u="),
      "_blank",
      "noopener,width=600,height=440",
    );
    expect(open.mock.calls[0][0]).toContain(encodeURIComponent(window.location.href));

    fireEvent.click(screen.getByRole("button", { name: "X" }));
    expect(open.mock.calls[1][0]).toContain("https://twitter.com/intent/tweet?url=");

    fireEvent.click(screen.getByRole("button", { name: "LinkedIn" }));
    expect(open.mock.calls[2][0]).toContain("https://www.linkedin.com/sharing/share-offsite/?url=");
  });
});

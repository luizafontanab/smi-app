// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FocusPicker } from "@/components/FocusPicker";
import { DEFAULT_FOCUS } from "@/lib/focus";

afterEach(() => {
  vi.restoreAllMocks();
});

// jsdom's getBoundingClientRect is all zeros by default, which would make the
// click-to-focus math divide by zero — stub a stable 320x192 box (matches the
// component's own h-48 w-80).
function stubBoundingBox() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, width: 320, height: 192, right: 320, bottom: 192, toJSON: () => {},
  });
}

describe("FocusPicker", () => {
  it("starts from the given initial focus and zoom", () => {
    const { container } = render(<FocusPicker src="https://cdn.test/cover.jpg" initial={{ x: 0.25, y: 0.75, scale: 1.5 }} />);
    expect(container.querySelector('input[name="focus_x"]')).toHaveValue("0.25");
    expect(container.querySelector('input[name="focus_y"]')).toHaveValue("0.75");
    expect(container.querySelector('input[name="focus_scale"]')).toHaveValue("1.5");
    expect(screen.getByText("1.50×")).toBeInTheDocument();
  });

  it("clicking the crop box sets the focal point from click position", () => {
    stubBoundingBox();
    const { container } = render(<FocusPicker src="https://cdn.test/cover.jpg" initial={DEFAULT_FOCUS} />);
    const box = container.querySelector(".cursor-crosshair")!;
    fireEvent.click(box, { clientX: 80, clientY: 96 }); // quarter across, half down
    expect(container.querySelector('input[name="focus_x"]')).toHaveValue("0.25");
    expect(container.querySelector('input[name="focus_y"]')).toHaveValue("0.5");
  });

  it("the zoom slider updates the scale hidden field and its readout", () => {
    const { container } = render(<FocusPicker src="https://cdn.test/cover.jpg" initial={DEFAULT_FOCUS} />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1.8" } });
    expect(screen.getByText("1.80×")).toBeInTheDocument();
    expect(container.querySelector('input[name="focus_scale"]')).toHaveValue("1.8");
  });
});

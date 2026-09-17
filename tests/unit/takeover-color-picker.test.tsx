// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TakeoverColorPicker } from "@/components/console/TakeoverColorPicker";

describe("TakeoverColorPicker", () => {
  it("starts from the brand default and shows its ratio against white", () => {
    render(<TakeoverColorPicker />);
    expect(screen.getByLabelText("Brand colour (hex)")).toHaveValue("#ff8200");
    expect(screen.getByText(/:1 against white/)).toBeInTheDocument();
  });

  it("shows a fail message for a colour below the AA threshold", () => {
    render(<TakeoverColorPicker />);
    fireEvent.change(screen.getByLabelText("Brand colour (hex)"), { target: { value: "#ffff00" } });
    expect(screen.getByText(/fails, needs 3:1/)).toBeInTheDocument();
  });

  it("shows a pass message for a colour that clears the AA threshold", () => {
    render(<TakeoverColorPicker />);
    fireEvent.change(screen.getByLabelText("Brand colour (hex)"), { target: { value: "#000000" } });
    expect(screen.getByText(/passes WCAG AA/)).toBeInTheDocument();
  });

  it("shows no ratio while the hex is invalid or incomplete", () => {
    render(<TakeoverColorPicker />);
    fireEvent.change(screen.getByLabelText("Brand colour (hex)"), { target: { value: "#fff" } });
    expect(screen.queryByText(/:1 against white/)).not.toBeInTheDocument();
  });
});

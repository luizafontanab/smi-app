// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CountedInput } from "@/components/console/CountedInput";

describe("CountedInput", () => {
  it("counts characters against a soft maximum without blocking", () => {
    render(<CountedInput name="subject" label="Subject" softMax={10} defaultValue="Laser" />);
    const field = screen.getByLabelText("Subject");
    expect(screen.getByText("5/10")).toBeInTheDocument();

    fireEvent.change(field, { target: { value: "Laser cutting, five ways" } });

    expect(screen.getByText(/24\/10 — may be cut off/)).toHaveClass("text-danger");
    expect(field).not.toHaveAttribute("maxlength");
  });

  it("counts words against a range, saying when it is short, and leaves an empty field alone", () => {
    render(<CountedInput name="excerpt" label="Summary" unit="words" softMin={3} softMax={5} multiline defaultValue="" id="excerpt" />);
    const field = screen.getByLabelText("Summary");
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("id", "excerpt");
    expect(screen.getByText("0 words")).not.toHaveClass("text-danger");

    fireEvent.change(field, { target: { value: "Two words" } });
    expect(screen.getByText("2 words — aim for 3–5 words")).toHaveClass("text-danger");

    fireEvent.change(field, { target: { value: "one two three four" } });
    expect(screen.getByText("4 words")).not.toHaveClass("text-danger");
  });
});

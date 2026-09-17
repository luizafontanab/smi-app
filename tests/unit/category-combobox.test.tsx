// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { CategoryCombobox, type CategoryOption } from "@/components/CategoryCombobox";

const OPTIONS: CategoryOption[] = [
  { slug: "fabrication", name: "Fabrication", href: "/member?category=fabrication" },
  { slug: "welding", name: "Welding", href: "/member?category=welding" },
  { slug: "laser-cutting", name: "Laser Cutting", href: "/member?category=laser-cutting" },
];

beforeEach(() => {
  // Not implemented in jsdom; the active-option effect calls it on every open/navigate.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.mocked(useRouter).mockReset();
});

function setup(props: Partial<React.ComponentProps<typeof CategoryCombobox>> = {}) {
  const push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push, replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), bfcacheId: "test" });
  render(<CategoryCombobox options={OPTIONS} allHref="/member" {...props} />);
  return { push };
}

describe("CategoryCombobox", () => {
  it("shows the selected category's name, or the all-label when nothing is selected", () => {
    setup();
    expect(screen.getByRole("button", { name: /All categories/ })).toBeInTheDocument();
  });

  it("opens the list on trigger click, closed by default", () => {
    setup();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /All categories/ }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Fabrication" })).toBeInTheDocument();
  });

  it("filters options as you type", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /All categories/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter categories" }), { target: { value: "weld" } });
    expect(screen.getByRole("option", { name: "Welding" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Fabrication" })).not.toBeInTheDocument();
  });

  it("Enter on the highlighted option navigates and closes the list", () => {
    const { push } = setup();
    fireEvent.click(screen.getByRole("button", { name: /All categories/ }));
    const input = screen.getByRole("combobox", { name: "Filter categories" });
    fireEvent.keyDown(input, { key: "ArrowDown" }); // from "All categories" onto "Fabrication"
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/member?category=fabrication");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Escape closes the list and returns focus to the trigger", () => {
    setup();
    const trigger = screen.getByRole("button", { name: /All categories/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Filter categories" }), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("shows a clear button once a category is selected, which resets to All", () => {
    const { push } = setup({ selected: "welding" });
    expect(screen.getByRole("button", { name: /Welding/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear category filter" }));
    expect(push).toHaveBeenCalledWith("/member");
  });
});

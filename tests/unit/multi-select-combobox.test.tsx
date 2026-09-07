// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { MultiSelectCombobox, type MultiSelectOption } from "@/components/MultiSelectCombobox";

// hrefs are precomputed by the page (each is that option's own toggle) — the
// component just navigates to whatever it was handed.
const OPTIONS: MultiSelectOption[] = [
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

function setup(props: Partial<React.ComponentProps<typeof MultiSelectCombobox>> = {}) {
  const push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push, replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), bfcacheId: "test" });
  render(<MultiSelectCombobox label="Categories" options={OPTIONS} clearHref="/member" selectedSlugs={[]} {...props} />);
  return { push };
}

// a string name is an exact match in Testing Library, so this never picks up "Clear categories filter"
const trigger = () => screen.getByRole("button", { name: "Categories" });

describe("MultiSelectCombobox", () => {
  it("shows the plain label when nothing is selected", () => {
    setup();
    expect(trigger()).toBeInTheDocument();
  });

  it("shows the single selected name", () => {
    setup({ selectedSlugs: ["welding"] });
    expect(screen.getByRole("button", { name: "Welding" })).toBeInTheDocument();
  });

  it("shows a count when more than one is selected", () => {
    setup({ selectedSlugs: ["welding", "fabrication"] });
    expect(screen.getByRole("button", { name: "Categories (2)" })).toBeInTheDocument();
  });

  it("opens a multiselectable listbox on trigger click, closed by default", () => {
    setup();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.click(trigger());
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-multiselectable", "true");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("marks selected options and ticks their checkboxes", () => {
    setup({ selectedSlugs: ["welding"] });
    fireEvent.click(screen.getByRole("button", { name: "Welding" }));
    const welding = screen.getByRole("option", { name: "Welding" });
    expect(welding).toHaveAttribute("aria-selected", "true");
    expect(welding.querySelector("input[type=checkbox]")).toBeChecked();
    const fab = screen.getByRole("option", { name: "Fabrication" });
    expect(fab).toHaveAttribute("aria-selected", "false");
    expect(fab.querySelector("input[type=checkbox]")).not.toBeChecked();
  });

  it("filters options as you type", () => {
    setup();
    fireEvent.click(trigger());
    fireEvent.change(screen.getByRole("combobox", { name: "Filter categories" }), { target: { value: "weld" } });
    expect(screen.getByRole("option", { name: "Welding" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Fabrication" })).not.toBeInTheDocument();
  });

  it("clicking an option navigates to its toggle href and keeps the list open — picking several is the point", () => {
    const { push } = setup();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Welding" }));
    expect(push).toHaveBeenCalledWith("/member?category=welding");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("Enter toggles the highlighted option", () => {
    const { push } = setup();
    fireEvent.click(trigger());
    const input = screen.getByRole("combobox", { name: "Filter categories" });
    fireEvent.keyDown(input, { key: "ArrowDown" }); // from "Fabrication" onto "Welding"
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/member?category=welding");
  });

  it("Escape closes the list and returns focus to the trigger", () => {
    setup();
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Filter categories" }), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("shows a clear button only once something is selected, which navigates to clearHref", () => {
    const { push } = setup({ selectedSlugs: ["welding"] });
    fireEvent.click(screen.getByRole("button", { name: "Clear categories filter" }));
    expect(push).toHaveBeenCalledWith("/member");
  });

  it("has no clear button when nothing is selected", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Clear categories filter" })).not.toBeInTheDocument();
  });
});

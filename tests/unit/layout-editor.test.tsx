// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LayoutEditor } from "@/app/console/pages/LayoutEditor";
import type { PageLayout } from "@/lib/blocks/schema";

// @dnd-kit's drag reordering itself isn't covered here: both its pointer and
// keyboard sensors resolve collisions from real getBoundingClientRect boxes,
// which jsdom always reports as zero-sized — the same class of gap that made
// ProseMirror selection sync unreliable in the RichTextEditor tests. Add/
// remove/edit and the validation gate below don't depend on any of that.

function layout(...blocks: PageLayout["blocks"]): PageLayout {
  return { version: 1, blocks };
}

function currentLayout(container: HTMLElement): PageLayout {
  return JSON.parse(container.querySelector('input[name="layout"]')!.getAttribute("value")!);
}

describe("LayoutEditor", () => {
  it("pins the anchor block — no drag handle or remove button", () => {
    render(<LayoutEditor pageType="static_page" initial={layout({ id: "main", type: "page_main" })} />);
    expect(screen.getByText("Page content (fixed)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove block" })).not.toBeInTheDocument();
  });

  it("adding a decoration block appends it, with a drag handle and remove button", () => {
    const { container } = render(<LayoutEditor pageType="static_page" initial={layout({ id: "main", type: "page_main" })} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Back link" }));

    expect(screen.getByRole("button", { name: "Move Back link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove block" })).toBeInTheDocument();
    expect(currentLayout(container).blocks).toHaveLength(2);
  });

  it("removing a block drops it from the layout", () => {
    const { container } = render(
      <LayoutEditor pageType="static_page" initial={layout({ id: "main", type: "page_main" }, { id: "bl1", type: "back_link", props: { label: "Back to News", href: "/news" } })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove block" }));
    expect(currentLayout(container).blocks.map((b) => b.id)).toEqual(["main"]);
  });

  it("numbers advert slots by position, in rotation order", () => {
    render(
      <LayoutEditor
        pageType="static_page"
        initial={layout({ id: "main", type: "page_main" }, { id: "ad1", type: "ad_banner" }, { id: "ad2", type: "ad_banner" })}
      />,
    );
    expect(screen.getByText(/#1 — rotation decides what shows/)).toBeInTheDocument();
    expect(screen.getByText(/#2 — rotation decides what shows/)).toBeInTheDocument();
  });

  it("editing a back_link's label and href updates the serialized layout", () => {
    const { container } = render(
      <LayoutEditor pageType="static_page" initial={layout({ id: "main", type: "page_main" }, { id: "bl1", type: "back_link", props: { label: "Back to News", href: "/news" } })} />,
    );
    fireEvent.change(screen.getByPlaceholderText("Label"), { target: { value: "Back to Events" } });
    fireEvent.change(screen.getByPlaceholderText("/news"), { target: { value: "/event" } });
    const block = currentLayout(container).blocks.find((b) => b.id === "bl1")!;
    expect(block.props).toEqual({ label: "Back to Events", href: "/event" });
  });

  it("editing latest_news's card limit updates the serialized layout", () => {
    const { container } = render(
      <LayoutEditor pageType="static_page" initial={layout({ id: "main", type: "page_main" }, { id: "ln1", type: "latest_news", props: { limit: 4 } })} />,
    );
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "6" } });
    const block = currentLayout(container).blocks.find((b) => b.id === "ln1")!;
    expect(block.props).toEqual({ limit: 6 });
  });

  it("shows the validation error and disables Save for an invalid layout", () => {
    render(<LayoutEditor pageType="static_page" initial={layout()} />); // missing the required page_main anchor
    expect(screen.getByText(/main content blocks must each appear exactly once/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save layout" })).toBeDisabled();
  });

  it("enables Save once the layout is valid", () => {
    render(<LayoutEditor pageType="static_page" initial={layout({ id: "main", type: "page_main" })} />);
    expect(screen.getByRole("button", { name: "Save layout" })).not.toBeDisabled();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RichTextEditor } from "@/components/RichTextEditor";

afterEach(() => {
  vi.restoreAllMocks();
});

// Tiptap's `immediatelyRender: false` means the editor instance (and the
// component's toolbar/content DOM) only appears after a mount effect — every
// test waits for it rather than assuming the first render already has it.
async function ready(ariaLabel: string) {
  await waitFor(() => expect(screen.getByLabelText(ariaLabel)).toBeInTheDocument());
}

describe("RichTextEditor", () => {
  it("renders the given initial content inside the editing surface", async () => {
    render(<RichTextEditor name="body" initialHtml="<p>Hello world.</p>" ariaLabel="Article body" />);
    await ready("Article body");
    expect(screen.getByText("Hello world.")).toBeInTheDocument();
  });

  it("carries the current HTML in a hidden field for plain form submission", async () => {
    const { container } = render(<RichTextEditor name="body" initialHtml="<p>Hello world.</p>" ariaLabel="Article body" />);
    await ready("Article body");
    expect(container.querySelector('input[type="hidden"][name="body"]')).toHaveValue("<p>Hello world.</p>");
  });

  // A mark toggle on a collapsed cursor only sets a *stored* mark (for the
  // next typed character), which isn't a document change — and this
  // component's useEditor() doesn't set shouldRerenderOnTransaction, so
  // nothing re-renders the toolbar for it (the same is true in the real
  // browser: only onUpdate, fired on doc changes, drives a re-render here).
  // Marking a real selection would turn it into a doc change, but jsdom's
  // Selection/Range doesn't sync into ProseMirror's own model, so that path
  // isn't exercisable from a black-box test either. What IS reliably true,
  // and worth covering, is that the command runs without throwing.
  it("Bold can be toggled without the editor throwing", async () => {
    render(<RichTextEditor name="body" initialHtml="<p>Hello world.</p>" ariaLabel="Article body" />);
    await ready("Article body");
    const bold = screen.getByTitle("Bold");
    expect(() => fireEvent.click(bold)).not.toThrow();
    expect(() => fireEvent.click(bold)).not.toThrow();
  });

  it("the Heading button converts the current block and undo becomes available", async () => {
    const { container } = render(<RichTextEditor name="body" initialHtml="<p>Hello world.</p>" ariaLabel="Article body" />);
    await ready("Article body");
    expect(screen.getByTitle("Undo")).toBeDisabled();

    fireEvent.click(screen.getByTitle("Heading"));
    expect(container.querySelector("h2")).toHaveTextContent("Hello world.");
    expect(screen.getByTitle("Heading")).toHaveClass("bg-ink");
    expect(screen.getByTitle("Undo")).not.toBeDisabled();
  });

  it("omits the image and ad-break tools unless the caller opts in", async () => {
    render(<RichTextEditor name="body" ariaLabel="Article body" />);
    await ready("Article body");
    expect(screen.queryByTitle("Insert image")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Split the article here for a rotating advert")).not.toBeInTheDocument();
  });

  it("shows the ad-break tool only when allowAdBreak is set", async () => {
    render(<RichTextEditor name="body" ariaLabel="Article body" allowAdBreak />);
    await ready("Article body");
    expect(screen.getByTitle("Split the article here for a rotating advert")).toBeInTheDocument();
  });

  it("Link prompts for a URL and doesn't crash without a selection", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("https://example.com");
    render(<RichTextEditor name="body" initialHtml="<p>Hello world.</p>" ariaLabel="Article body" />);
    await ready("Article body");
    fireEvent.click(screen.getByTitle("Add link"));
    expect(window.prompt).toHaveBeenCalledWith("Link URL", "https://");
  });
});

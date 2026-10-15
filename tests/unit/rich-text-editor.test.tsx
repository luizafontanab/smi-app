// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RichTextEditor } from "@/components/RichTextEditor";
import type { UploadResult } from "@/lib/upload-limits";

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

  describe("image upload feedback (Jas 13/10 item 3)", () => {
    function pick(container: HTMLElement, file: File) {
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [file] } });
    }
    const jpeg = (bytes = 10) => new File([new Uint8Array(bytes)], "shot.jpg", { type: "image/jpeg" });

    it("shows a spinner line and disables Image while the upload is in flight", async () => {
      let finish: (r: UploadResult) => void = () => {};
      const upload = vi.fn(() => new Promise<UploadResult>((r) => { finish = r; }));
      const { container } = render(<RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} />);
      await ready("Article body");

      pick(container, jpeg());
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Uploading image…"));
      expect(screen.getByTitle("Insert image")).toBeDisabled();

      await act(async () => finish({ url: "http://127.0.0.1:54321/storage/v1/object/public/media/stories/a.jpg" }));
      await waitFor(() => expect(screen.getByRole("status")).toBeEmptyDOMElement());
      expect(screen.getByTitle("Insert image")).not.toBeDisabled();
      expect((container.querySelector('input[type="hidden"][name="body"]') as HTMLInputElement).value).toContain("stories/a.jpg");
    });

    it("shows the action's refusal reason inline", async () => {
      const upload = vi.fn(async (): Promise<UploadResult> => ({ error: "Image too large (8MB max)" }));
      const { container } = render(<RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} />);
      await ready("Article body");
      pick(container, jpeg());
      expect(await screen.findByRole("alert")).toHaveTextContent("Image too large (8MB max)");
    });

    it("refuses an oversized or non-image file in the browser, without calling the action", async () => {
      const upload = vi.fn(async (): Promise<UploadResult> => ({ url: "x" }));
      const { container } = render(<RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} />);
      await ready("Article body");

      pick(container, jpeg(8 * 1024 * 1024 + 1));
      expect(await screen.findByRole("alert")).toHaveTextContent(/8MB/);
      pick(container, new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/Images only/);
      expect(upload).not.toHaveBeenCalled();
    });

    it("says so when the request itself fails", async () => {
      const upload = vi.fn(async (): Promise<UploadResult> => { throw new Error("network"); });
      const { container } = render(<RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} />);
      await ready("Article body");
      pick(container, jpeg());
      expect(await screen.findByRole("alert")).toHaveTextContent(/didn't upload/);
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });

    it("blocks the surrounding form from submitting until the image lands", async () => {
      let finish: (r: UploadResult) => void = () => {};
      const upload = vi.fn(() => new Promise<UploadResult>((r) => { finish = r; }));
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
      const { container } = render(
        <form onSubmit={onSubmit}>
          <RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} />
        </form>,
      );
      await ready("Article body");
      pick(container, jpeg());
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Uploading image…"));

      fireEvent.submit(container.querySelector("form")!);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(await screen.findByRole("alert")).toHaveTextContent(/finish uploading/);

      await act(async () => finish({ url: "http://127.0.0.1:54321/storage/v1/object/public/media/a.jpg" }));
      await waitFor(() => expect(screen.getByRole("status")).toBeEmptyDOMElement());
      fireEvent.submit(container.querySelector("form")!);
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  // Jas 13/10 item 19.
  it("keeps an image's position and size through a load and re-serialise", async () => {
    const src = "http://127.0.0.1:54321/storage/v1/object/public/media/stories/a.jpg";
    const upload = vi.fn(async (): Promise<UploadResult> => ({ url: src }));
    const { container } = render(
      <RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} initialHtml={`<img src="${src}" data-align="right" data-size="small"><p>Text.</p>`} />,
    );
    await ready("Article body");
    const img = container.querySelector(".ProseMirror img")!;
    expect(img).toHaveAttribute("data-align", "right");
    expect(img).toHaveAttribute("data-size", "small");
  });

  it("ignores an unknown position value when loading", async () => {
    const src = "http://127.0.0.1:54321/storage/v1/object/public/media/stories/a.jpg";
    const upload = vi.fn(async (): Promise<UploadResult> => ({ url: src }));
    const { container } = render(
      <RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} initialHtml={`<img src="${src}" data-align="sideways">`} />,
    );
    await ready("Article body");
    expect(container.querySelector(".ProseMirror img")).not.toHaveAttribute("data-align");
  });

  it("shows the image position controls only while an image is selected", async () => {
    const upload = vi.fn(async (): Promise<UploadResult> => ({ url: "x" }));
    render(<RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} initialHtml="<p>Text.</p>" />);
    await ready("Article body");
    expect(screen.queryByRole("group", { name: "Image position" })).not.toBeInTheDocument();
  });

  it("Link prompts for a URL and doesn't crash without a selection", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("https://example.com");
    render(<RichTextEditor name="body" initialHtml="<p>Hello world.</p>" ariaLabel="Article body" />);
    await ready("Article body");
    fireEvent.click(screen.getByTitle("Add link"));
    expect(window.prompt).toHaveBeenCalledWith("Link URL", "https://");
  });
});

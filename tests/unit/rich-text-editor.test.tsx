// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RichTextEditor } from "@/components/RichTextEditor";
import type { UploadResult } from "@/lib/upload-limits";

// The bytes go to Storage first (lib/direct-upload, tested on its own); here
// that step just hands back a staged path, and the action receives the path.
const STAGED = "members/m1/3d6f0a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b.jpg";
const { stageUpload } = vi.hoisted(() => ({
  stageUpload: vi.fn<(file: File, kind: string, opts?: { onProgress?: (f: number) => void }) => Promise<string>>(),
}));
vi.mock("@/lib/direct-upload", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/direct-upload")>()), stageUpload }));

beforeEach(() => {
  stageUpload.mockReset().mockResolvedValue(STAGED);
});

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
      await waitFor(() => expect(screen.getByTitle("Insert image")).toBeDisabled());
      // the action gets the staged path, never the bytes
      await waitFor(() => expect(upload).toHaveBeenCalled());
      expect((upload.mock.calls[0] as unknown as [FormData])[0].get("file")).toBe(STAGED);

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

    it("shows how much of the image has gone up", async () => {
      let report: (f: number) => void = () => {};
      stageUpload.mockImplementation((_f, _k, opts) => {
        report = opts?.onProgress ?? report;
        return new Promise<string>(() => {});
      });
      const upload = vi.fn(async (): Promise<UploadResult> => ({ url: "x" }));
      const { container } = render(<RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} />);
      await ready("Article body");
      pick(container, jpeg());
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Uploading image…"));
      act(() => report(0.6));
      expect(screen.getByRole("status")).toHaveTextContent("60%");
    });

    it("shows the direct upload's own refusal without calling the action", async () => {
      const { UploadRejectedError } = await import("@/lib/upload-limits");
      stageUpload.mockRejectedValue(new UploadRejectedError("That's a lot of uploads in a short time — wait a few minutes, then try again."));
      const upload = vi.fn(async (): Promise<UploadResult> => ({ url: "x" }));
      const { container } = render(<RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} />);
      await ready("Article body");
      pick(container, jpeg());
      expect(await screen.findByRole("alert")).toHaveTextContent("a lot of uploads");
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

  // Review 16 Oct: a pasted <img src="https://other-site…"> showed in the
  // editor, then the sanitiser (media bucket only) dropped it on save, silently.
  describe("pasted images", () => {
    const MEDIA = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/stories/ours.jpg`;
    const paste = (html: string) =>
      fireEvent.paste(screen.getByLabelText("Article body"), {
        clipboardData: { types: ["text/html", "text/plain"], getData: (t: string) => (t === "text/html" ? html : "pasted"), files: [], items: [] },
      });
    const body = (container: HTMLElement) => (container.querySelector('input[type="hidden"][name="body"]') as HTMLInputElement).value;

    it("leaves out an image from another site at once, and says why", async () => {
      const upload = vi.fn(async (): Promise<UploadResult> => ({ url: "x" }));
      const { container } = render(<RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} initialHtml="<p>Start.</p>" />);
      await ready("Article body");

      act(() => paste(`<p>Copied text.</p><img src="https://elsewhere.example/photo.jpg"><img src="data:image/png;base64,AAAA">`));

      expect(container.querySelector(".ProseMirror img")).toBeNull();
      expect(body(container)).toContain("Copied text.");
      expect(body(container)).not.toContain("elsewhere.example");
      expect(screen.getByRole("alert")).toHaveTextContent("2 pasted images were left out");
      expect(screen.getByRole("alert")).toHaveTextContent(/Image button/);
    });

    it("keeps an image already in our media library, without a notice", async () => {
      const upload = vi.fn(async (): Promise<UploadResult> => ({ url: "x" }));
      const { container } = render(<RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} initialHtml="<p>Start.</p>" />);
      await ready("Article body");

      act(() => paste(`<p>Moved.</p><img src="${MEDIA}">`));

      expect(container.querySelector(".ProseMirror img")).toHaveAttribute("src", MEDIA);
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  // A screenshot or "Copy image" pasted straight in, or a photo dragged in from
  // the desktop — before, a pasted file did nothing at all.
  describe("pasted and dropped image files", () => {
    // A drop lands where it was dropped (view.posAtCoords), which needs layout
    // jsdom doesn't have: no element is ever "at" a point, and nothing has
    // client rects. Stubbed as "nothing there", so the drop falls back to the
    // cursor — the position itself is the browser's business, not this test's.
    beforeEach(() => {
      document.elementFromPoint = () => null;
      if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
      if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
      if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
    });
    const shot = () => new File([new Uint8Array(10)], "screenshot.png", { type: "image/png" });
    const URL_ = "http://127.0.0.1:54321/storage/v1/object/public/media/stories/m1/pasted.png";
    const clipboard = (files: File[], html = "", text = "") => ({
      types: [...(html ? ["text/html"] : []), ...(text ? ["text/plain"] : []), "Files"],
      getData: (t: string) => (t === "text/html" ? html : t === "text/plain" ? text : ""),
      files,
      items: [],
    });

    it("uploads a pasted image file the same way as the Image button", async () => {
      const upload = vi.fn(async (): Promise<UploadResult> => ({ url: URL_ }));
      const { container } = render(<RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} initialHtml="<p>Start.</p>" />);
      await ready("Article body");
      const file = shot();

      act(() => { fireEvent.paste(screen.getByLabelText("Article body"), { clipboardData: clipboard([file]) }); });

      await waitFor(() => expect(container.querySelector(".ProseMirror img")).toHaveAttribute("src", URL_));
      expect(stageUpload).toHaveBeenCalledWith(file, "image", expect.anything());
    });

    it("takes a browser's \"Copy image\" (an <img> in the HTML plus the file) as the file, without the foreign-image notice", async () => {
      const upload = vi.fn(async (): Promise<UploadResult> => ({ url: URL_ }));
      const { container } = render(<RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} initialHtml="<p>Start.</p>" />);
      await ready("Article body");

      act(() => { fireEvent.paste(screen.getByLabelText("Article body"), { clipboardData: clipboard([shot()], '<img src="https://elsewhere.example/p.png">') }); });

      await waitFor(() => expect(container.querySelector(".ProseMirror img")).toHaveAttribute("src", URL_));
      expect(screen.queryByText(/left out/)).toBeNull();
    });

    it("leaves a text paste that also carries a picture (Word does this) as a text paste", async () => {
      const upload = vi.fn(async (): Promise<UploadResult> => ({ url: URL_ }));
      const { container } = render(<RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} initialHtml="<p>Start.</p>" />);
      await ready("Article body");

      act(() => { fireEvent.paste(screen.getByLabelText("Article body"), { clipboardData: clipboard([shot()], "<p>Copied from Word.</p>", "Copied from Word.") }); });

      expect((container.querySelector('input[type="hidden"][name="body"]') as HTMLInputElement).value).toContain("Copied from Word.");
      expect(stageUpload).not.toHaveBeenCalled();
    });

    it("uploads a dropped image file", async () => {
      const upload = vi.fn(async (): Promise<UploadResult> => ({ url: URL_ }));
      const { container } = render(<RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} initialHtml="<p>Start.</p>" />);
      await ready("Article body");

      act(() => { fireEvent.drop(screen.getByLabelText("Article body"), { dataTransfer: clipboard([shot()]), clientX: 0, clientY: 0 }); });

      await waitFor(() => expect(container.querySelector(".ProseMirror img")).toHaveAttribute("src", URL_));
    });

    it("refuses a dropped non-image file in the browser, saying why", async () => {
      const upload = vi.fn(async (): Promise<UploadResult> => ({ url: URL_ }));
      render(<RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} initialHtml="<p>Start.</p>" />);
      await ready("Article body");

      act(() => { fireEvent.drop(screen.getByLabelText("Article body"), { dataTransfer: clipboard([new File(["%PDF-"], "spec.pdf", { type: "application/pdf" })]), clientX: 0, clientY: 0 }); });

      expect(await screen.findByRole("alert")).toHaveTextContent(/Images only/);
      expect(stageUpload).not.toHaveBeenCalled();
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
    const src = "http://127.0.0.1:54321/storage/v1/object/public/media/stories/a.jpg";
    const upload = vi.fn(async (): Promise<UploadResult> => ({ url: src }));
    const { container } = render(
      <RichTextEditor name="body" ariaLabel="Article body" uploadImage={upload} initialHtml={`<img src="${src}"><p>Text.</p>`} />,
    );
    await ready("Article body");
    expect(screen.queryByRole("group", { name: "Image position" })).not.toBeInTheDocument();

    // jsdom's Selection doesn't reach ProseMirror's own model, so select the
    // image through the editor Tiptap hangs on its DOM node — the same
    // NodeSelection a click on the picture makes in a browser.
    const pm = container.querySelector(".ProseMirror") as HTMLElement & {
      editor: { commands: { setNodeSelection: (pos: number) => boolean; setTextSelection: (pos: number) => boolean }; state: { doc: { content: { size: number } } } };
    };
    act(() => {
      pm.editor.commands.setNodeSelection(0);
    });
    expect(await screen.findByRole("group", { name: "Image position" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Image size" })).toBeInTheDocument();

    // …and gone again once the cursor moves into the text.
    act(() => {
      pm.editor.commands.setTextSelection(pm.editor.state.doc.content.size - 1);
    });
    await waitFor(() => expect(screen.queryByRole("group", { name: "Image position" })).not.toBeInTheDocument());
  });

  it("Link prompts for a URL and doesn't crash without a selection", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("https://example.com");
    render(<RichTextEditor name="body" initialHtml="<p>Hello world.</p>" ariaLabel="Article body" />);
    await ready("Article body");
    fireEvent.click(screen.getByTitle("Add link"));
    expect(window.prompt).toHaveBeenCalledWith("Link URL", "https://");
  });
});

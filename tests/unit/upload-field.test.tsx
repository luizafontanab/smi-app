// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { UploadField } from "@/components/UploadField";
import { DirectUploadError } from "@/lib/direct-upload";
import { useUploadsPending } from "@/lib/upload-pending";

const { stageUpload } = vi.hoisted(() => ({
  stageUpload: vi.fn<(file: File, kind: string, opts?: { onProgress?: (f: number) => void; signal?: AbortSignal }) => Promise<string>>(),
}));
vi.mock("@/lib/direct-upload", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/direct-upload")>()), stageUpload }));

afterEach(() => {
  stageUpload.mockReset();
  vi.restoreAllMocks();
});

const PATH = "members/m1/3d6f0a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b.jpg";
const photo = () => new File([new Uint8Array(10)], "phone.jpg", { type: "image/jpeg" });
const fileInput = (c: HTMLElement) => c.querySelector('input[type="file"]') as HTMLInputElement;
const hidden = (c: HTMLElement) => c.querySelector('input[type="hidden"][name="cover"]') as HTMLInputElement | null;
const pick = (c: HTMLElement, file = photo()) => fireEvent.change(fileInput(c), { target: { files: [file] } });

/** A promise the test resolves by hand, for an upload that is still in flight. */
function deferred() {
  let resolve: (path: string) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("UploadField", () => {
  // Progressive enhancement: what the server sends must work with no JavaScript.
  it("renders a plain named file input on the server — the no-JavaScript form posts the file itself", () => {
    const html = renderToString(<form><UploadField name="cover" accept="image/jpeg" required /></form>);
    expect(html).toMatch(/<input[^>]*type="file"[^>]*name="cover"/);
    expect(html).not.toContain('type="hidden"');
  });

  it("once running, the file input stops posting the bytes and a hidden field carries the staged path instead", async () => {
    stageUpload.mockResolvedValue(PATH);
    const { container } = render(<form><UploadField name="cover" accept="image/jpeg" /></form>);
    expect(fileInput(container)).not.toHaveAttribute("name");
    expect(hidden(container)).toHaveValue("");

    const file = photo();
    pick(container, file);
    await waitFor(() => expect(hidden(container)).toHaveValue(PATH));
    expect(stageUpload).toHaveBeenCalledWith(file, "image", expect.anything());
  });

  it("shows the spinner line with progress while sending, and the page counts it as pending", async () => {
    const upload = deferred();
    let report: (f: number) => void = () => {};
    stageUpload.mockImplementation((_f, _k, opts) => {
      report = opts?.onProgress ?? report;
      return upload.promise;
    });
    function Pending() {
      return <span data-testid="pending">{String(useUploadsPending())}</span>;
    }
    const { container } = render(<form><UploadField name="cover" /><Pending /></form>);
    pick(container);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Uploading image…"));
    expect(screen.getByTestId("pending")).toHaveTextContent("true");
    act(() => report(0.42));
    expect(screen.getByRole("status")).toHaveTextContent("42%");

    await act(async () => upload.resolve(PATH));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
  });

  it("shows a refusal inline and empties the input, so the person can choose again", async () => {
    stageUpload.mockRejectedValue(new DirectUploadError("The image didn't upload — check your connection and try again."));
    const { container } = render(<form><UploadField name="cover" /></form>);
    pick(container);
    expect(await screen.findByRole("alert")).toHaveTextContent("check your connection");
    expect(fileInput(container).value).toBe("");
    expect(hidden(container)).toHaveValue("");
  });

  it("holds the form while the file is on its way, and says why", async () => {
    const upload = deferred();
    stageUpload.mockReturnValue(upload.promise);
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const { container } = render(<form onSubmit={onSubmit}><UploadField name="cover" /></form>);
    pick(container);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Uploading image…"));

    fireEvent.submit(container.querySelector("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Wait for the image to finish uploading, then save.");

    await act(async () => upload.resolve(PATH));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.submit(container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  // The action removes a staged file once it has read it, so a second save
  // from the same page must not post that path again.
  it("posts the path with the form, then clears — the save owns the file now", async () => {
    stageUpload.mockResolvedValue(PATH);
    const posted: unknown[] = [];
    const action = vi.fn(async (fd: FormData) => { posted.push(fd.get("cover")); });
    const { container } = render(<form action={action}><UploadField name="cover" /><button>Save</button></form>);
    pick(container);
    await waitFor(() => expect(hidden(container)).toHaveValue(PATH));

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(posted).toEqual([PATH]);
    await waitFor(() => expect(hidden(container)).toHaveValue(""));
  });

  it("a document field asks for a file of its kind and words its status for a file", async () => {
    const upload = deferred();
    stageUpload.mockReturnValue(upload.promise);
    const { container } = render(<form><UploadField name="pack" kind="pdf" /></form>);
    pick(container, new File(["%PDF-"], "pack.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Uploading file…"));
    expect(stageUpload.mock.calls[0][1]).toBe("pdf");
    await act(async () => upload.resolve("console/x.pdf"));
  });

  it("choosing a different file mid-upload cancels the first, so only the second can land", async () => {
    const first = deferred();
    const signals: AbortSignal[] = [];
    stageUpload
      .mockImplementationOnce((_f, _k, opts) => { signals.push(opts!.signal!); return first.promise; })
      .mockResolvedValueOnce("members/m1/0b9e8d7c-aaaa-4bbb-8ccc-ddddeeeeffff.jpg");
    const { container } = render(<form><UploadField name="cover" /></form>);
    pick(container);
    await waitFor(() => expect(stageUpload).toHaveBeenCalledTimes(1));
    pick(container);
    await waitFor(() => expect(hidden(container)).toHaveValue("members/m1/0b9e8d7c-aaaa-4bbb-8ccc-ddddeeeeffff.jpg"));
    expect(signals[0].aborted).toBe(true);
    // the first one finishing late changes nothing
    await act(async () => first.resolve(PATH));
    expect(hidden(container)).toHaveValue("members/m1/0b9e8d7c-aaaa-4bbb-8ccc-ddddeeeeffff.jpg");
  });

  // On a slow connection the person can pick a file before the page's
  // JavaScript arrives; hydration then takes the input's name away, so that
  // file must be sent from where it sits or it would silently not be saved.
  it("sends a file that was chosen before the page hydrated", async () => {
    stageUpload.mockResolvedValue(PATH);
    const ui = <form><UploadField name="cover" /></form>;
    const container = document.createElement("div");
    container.innerHTML = renderToString(ui);
    document.body.appendChild(container);
    const early = photo();
    Object.defineProperty(fileInput(container), "files", { value: [early], configurable: true });

    const root = await act(async () => hydrateRoot(container, ui));
    await waitFor(() => expect(hidden(container)).toHaveValue(PATH));
    expect(stageUpload).toHaveBeenCalledWith(early, "image", expect.anything());
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the caller's own onChange (the forms' previews)", async () => {
    stageUpload.mockResolvedValue(PATH);
    const onChange = vi.fn();
    const { container } = render(<form><UploadField name="cover" onChange={onChange} /></form>);
    pick(container);
    expect(onChange).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(hidden(container)).toHaveValue(PATH));
  });
});

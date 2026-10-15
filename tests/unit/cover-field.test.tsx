// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CoverField } from "@/components/CoverField";
import { UploadRejectedError } from "@/lib/upload-limits";

// The direct upload itself is tested in direct-upload/upload-field; here it
// just hands back a staged path (or a refusal).
const STAGED = "members/m1/3d6f0a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b.webp";
const { stageUpload } = vi.hoisted(() => ({ stageUpload: vi.fn<(file: File, kind: string) => Promise<string>>() }));
vi.mock("@/lib/direct-upload", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/direct-upload")>()), stageUpload }));

beforeEach(() => {
  // jsdom doesn't implement createObjectURL, and has no createImageBitmap/canvas
  // support at all — compress() is written to degrade gracefully on the latter
  // (returns the original file), so only the former needs a stand-in here.
  URL.createObjectURL = vi.fn(() => "blob:mock-preview");
  URL.revokeObjectURL = vi.fn();
  stageUpload.mockReset().mockResolvedValue(STAGED);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function pickFile(input: HTMLElement, name = "photo.jpg", type = "image/jpeg") {
  const file = new File(["fake-bytes"], name, { type });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

describe("CoverField", () => {
  it("shows no crop picker until there is something to preview", () => {
    render(<CoverField />);
    expect(screen.queryByText(/Crop focus/)).not.toBeInTheDocument();
  });

  it("shows the crop picker immediately for an already-saved cover", () => {
    render(<CoverField cover="https://cdn.test/covers/existing.jpg" />);
    expect(screen.getByText(/Crop focus/)).toBeInTheDocument();
  });

  it("previews a newly chosen file via an object URL and notifies the parent", async () => {
    const onPreview = vi.fn();
    render(<CoverField onPreview={onPreview} />);
    await act(async () => {
      pickFile(screen.getByLabelText("Cover image"));
    });
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(onPreview).toHaveBeenCalledWith("blob:mock-preview");
    expect(screen.getByText(/Crop focus/)).toBeInTheDocument();
  });

  it("falls back to the original file and clears the note when the browser can't re-encode", async () => {
    render(<CoverField />);
    await act(async () => {
      pickFile(screen.getByLabelText("Cover image"));
    });
    // createImageBitmap isn't implemented in jsdom, so compress() hits its
    // catch-all and resolves with note: null — "Optimising…" must not stick.
    expect(screen.queryByText("Optimising…")).not.toBeInTheDocument();
  });

  it("sends the chosen file straight to Storage and carries the staged path as the cover", async () => {
    const { container } = render(<form><CoverField /></form>);
    const input = screen.getByLabelText("Cover image");
    expect(input).not.toHaveAttribute("name"); // the bytes never ride with the form
    let file: File | undefined;
    await act(async () => {
      file = pickFile(input);
    });
    // compress() can't re-encode in jsdom, so the original is what's sent
    expect(stageUpload).toHaveBeenCalledWith(file, "image", expect.anything());
    await waitFor(() => expect(container.querySelector('input[type="hidden"][name="cover"]')).toHaveValue(STAGED));
  });

  it("drops the preview when the upload is refused, and says why", async () => {
    stageUpload.mockRejectedValue(new UploadRejectedError("Image too large (8MB max)"));
    const onPreview = vi.fn();
    render(<form><CoverField onPreview={onPreview} /></form>);
    await act(async () => {
      pickFile(screen.getByLabelText("Cover image"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Image too large (8MB max)");
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText(/Crop focus/)).not.toBeInTheDocument();
  });

  it("clearing the file selection removes the preview", async () => {
    const onPreview = vi.fn();
    render(<CoverField onPreview={onPreview} />);
    const input = screen.getByLabelText("Cover image");
    await act(async () => {
      pickFile(input);
    });
    expect(screen.getByText(/Crop focus/)).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [] } });
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText(/Crop focus/)).not.toBeInTheDocument();
  });
});

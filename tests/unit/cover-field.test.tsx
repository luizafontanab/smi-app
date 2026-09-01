// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CoverField } from "@/components/CoverField";

beforeEach(() => {
  // jsdom doesn't implement createObjectURL, and has no createImageBitmap/canvas
  // support at all — compress() is written to degrade gracefully on the latter
  // (returns the original file), so only the former needs a stand-in here.
  URL.createObjectURL = vi.fn(() => "blob:mock-preview");
  URL.revokeObjectURL = vi.fn();
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

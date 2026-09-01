// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { YoutubePreview } from "@/components/YoutubePreview";

describe("YoutubePreview", () => {
  it("shows no preview or warning before anything is typed", () => {
    render(<YoutubePreview name="video_url" />);
    expect(screen.queryByTitle("Preview")).not.toBeInTheDocument();
    expect(screen.queryByText(/Doesn't look like/)).not.toBeInTheDocument();
  });

  it("embeds a nocookie preview for a matching watch URL", () => {
    render(<YoutubePreview name="video_url" />);
    fireEvent.change(screen.getByLabelText("YouTube URL"), { target: { value: "https://www.youtube.com/watch?v=abc123" } });
    expect(screen.getByTitle("Preview")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/abc123");
  });

  it("warns instead of embedding for a non-watch URL, but still lets it save", () => {
    render(<YoutubePreview name="video_url" />);
    const input = screen.getByLabelText("YouTube URL");
    fireEvent.change(input, { target: { value: "https://youtu.be/abc123" } });
    expect(screen.queryByTitle("Preview")).not.toBeInTheDocument();
    expect(screen.getByText(/Doesn't look like a YouTube watch URL/)).toBeInTheDocument();
    expect(input).not.toBeDisabled();
  });

  it("starts from defaultValue when editing an existing video", () => {
    render(<YoutubePreview name="video_url" defaultValue="https://www.youtube.com/watch?v=seeded" />);
    expect(screen.getByTitle("Preview")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/seeded");
  });
});

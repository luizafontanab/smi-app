// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { memberVideoList } from "@/lib/member-videos";
import { MemberVideos } from "@/components/MemberVideos";

describe("memberVideoList (GAPS A8.5)", () => {
  it("leads with the company video, then the member's published videos", () => {
    const list = memberVideoList("https://www.youtube.com/watch?v=company", [
      { slug: "a", title: "Open house", url: "https://youtu.be/first" },
      { slug: "b", title: "New laser", url: "https://www.youtube.com/watch?v=second" },
    ]);
    expect(list).toEqual([
      { id: "company", title: "Company video", href: null },
      { id: "first", title: "Open house", href: "/video/a" },
      { id: "second", title: "New laser", href: "/video/b" },
    ]);
  });

  it("shows the same YouTube video once, even if it is both the company video and an SMI video", () => {
    const list = memberVideoList("https://youtu.be/same", [{ slug: "a", title: "Same again", url: "https://www.youtube.com/watch?v=same" }]);
    expect(list.map((v) => v.id)).toEqual(["same"]);
  });

  it("drops links that aren't readable YouTube links rather than rendering an empty player", () => {
    expect(memberVideoList("https://vimeo.com/1", [{ slug: "a", title: "x", url: "https://www.loom.com/share/y" }])).toEqual([]);
    expect(memberVideoList(null, [])).toEqual([]);
  });
});

describe("MemberVideos", () => {
  const videos = [
    { id: "one", title: "Company video", href: null },
    { id: "two", title: "Open house", href: "/video/open-house" },
  ];

  it("with one video, shows just the player, titled by the video", () => {
    render(<MemberVideos videos={[videos[0]]} />);
    expect(screen.getByRole("heading", { name: "Company video" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /next video/i })).not.toBeInTheDocument();
  });

  it("loads one player at a time, and the reader picks which", () => {
    const { container } = render(<MemberVideos videos={videos} />);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(container.querySelector("iframe")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/one");

    fireEvent.click(screen.getByRole("button", { name: /Open house/ }));
    expect(container.querySelector("iframe")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/two");
    expect(screen.getByRole("button", { name: /Open house/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("previous/next wrap around", () => {
    const { container } = render(<MemberVideos videos={videos} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous video" }));
    expect(container.querySelector("iframe")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/two");
    fireEvent.click(screen.getByRole("button", { name: "Next video" }));
    expect(container.querySelector("iframe")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/one");
  });
});

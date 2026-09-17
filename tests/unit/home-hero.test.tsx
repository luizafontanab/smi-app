// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HomeHero } from "@/components/HomeHero";
import { DEFAULT_FOCUS } from "@/lib/focus";
import type { HeroItem } from "@/lib/hero";

function storyItem(overrides: Partial<HeroItem> = {}): HeroItem {
  return {
    key: "story-1", kind: "story", title: "Headline Story", image: null, focus: DEFAULT_FOCUS,
    eyebrow: "News", meta: "1 July 2026", href: "/news/headline", intro: "The opening line.",
    ...overrides,
  } as HeroItem;
}

function videoItem(overrides: Partial<HeroItem> = {}): HeroItem {
  return {
    key: "video-1", kind: "video", title: "A Video", image: null, focus: DEFAULT_FOCUS,
    eyebrow: "Videos", meta: null, href: "https://www.youtube.com/watch?v=abc",
    ...overrides,
  } as HeroItem;
}

describe("HomeHero", () => {
  it("renders nothing with no items", () => {
    const { container } = render(<HomeHero items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the headline story on the stage on load, with no rail for a single item", () => {
    render(<HomeHero items={[storyItem()]} />);
    expect(screen.getByTestId("hero-stage-title")).toHaveTextContent("Headline Story");
    expect(screen.queryByText("Up next")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("hero-card")).toHaveLength(0);
  });

  it("hovering a rail card promotes it to the stage, and never on its own", () => {
    const items = [storyItem(), videoItem({ key: "video-1", title: "Second Item" })];
    render(<HomeHero items={items} />);
    expect(screen.getByTestId("hero-stage-title")).toHaveTextContent("Headline Story");

    const [, secondCard] = screen.getAllByTestId("hero-card");
    fireEvent.pointerEnter(secondCard, { pointerType: "mouse" });
    expect(screen.getByTestId("hero-stage-title")).toHaveTextContent("Second Item");

    // Never auto-rotates: still on the promoted card without any interaction.
    expect(screen.getByTestId("hero-stage-title")).toHaveTextContent("Second Item");
  });

  it("touch pointers don't promote the stage (avoids a flash before the tap navigates)", () => {
    const items = [storyItem(), videoItem({ key: "video-1", title: "Second Item" })];
    render(<HomeHero items={items} />);
    const [, secondCard] = screen.getAllByTestId("hero-card");
    fireEvent.pointerEnter(secondCard, { pointerType: "touch" });
    expect(screen.getByTestId("hero-stage-title")).toHaveTextContent("Headline Story");
  });

  it("focusing a rail card promotes it (keyboard parity with hover)", () => {
    const items = [storyItem(), videoItem({ key: "video-1", title: "Second Item" })];
    render(<HomeHero items={items} />);
    const [, secondCard] = screen.getAllByTestId("hero-card");
    fireEvent.focus(secondCard);
    expect(screen.getByTestId("hero-stage-title")).toHaveTextContent("Second Item");
  });

  it("mouse leaving the section resets the stage to the headline", () => {
    const items = [storyItem(), videoItem({ key: "video-1", title: "Second Item" })];
    const { container } = render(<HomeHero items={items} />);
    const [, secondCard] = screen.getAllByTestId("hero-card");
    fireEvent.pointerEnter(secondCard, { pointerType: "mouse" });
    expect(screen.getByTestId("hero-stage-title")).toHaveTextContent("Second Item");

    fireEvent.pointerLeave(container.querySelector(".hero")!, { pointerType: "mouse" });
    expect(screen.getByTestId("hero-stage-title")).toHaveTextContent("Headline Story");
  });

  it("video cards open in a new tab; story cards navigate in-page", () => {
    const items = [storyItem(), videoItem({ key: "video-1", title: "Second Item" })];
    render(<HomeHero items={items} />);
    const [, secondCard] = screen.getAllByTestId("hero-card");
    expect(secondCard).toHaveAttribute("target", "_blank");
    expect(secondCard).toHaveAttribute("rel", "noopener");
  });
});

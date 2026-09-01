// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AdCreative } from "@/components/AdCreative";
import { reportAdSeen } from "@/lib/ad-impressions";

// reportAdSeen's own batching/network behaviour is covered by
// tests/unit/ad-impressions.test.ts — here it's just the boundary AdCreative
// is contractually obliged to call, once, under the right conditions.
vi.mock("@/lib/ad-impressions", () => ({ reportAdSeen: vi.fn() }));

/** Captures the callback+instance so a test can drive fake intersection entries. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }
}

// jsdom never computes layout, so offsetParent is always null and complete/
// naturalWidth never advance on their own — stub all three the component
// actually reads. next/image's own onLoad wrapper (image-component.js)
// defers to the user's onLoad via img.decode().then(...), a microtask, so
// firing the event alone isn't enough — flush that tick under act() too.
async function markLoaded(img: HTMLImageElement, naturalWidth = 100) {
  Object.defineProperty(img, "offsetParent", { value: document.body, configurable: true });
  Object.defineProperty(img, "complete", { value: true, configurable: true });
  Object.defineProperty(img, "naturalWidth", { value: naturalWidth, configurable: true });
  await act(async () => {
    fireEvent.load(img);
    await Promise.resolve();
  });
}

const PROPS = { advertId: "ad1", name: "Acme Fabrication", href: "/visit/ad1", desktop: "d.jpg", mobile: "m.jpg" } as const;

beforeEach(() => {
  vi.useFakeTimers();
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(reportAdSeen).mockReset();
});

describe("shape rendering", () => {
  it("banner shows two creatives, one per breakpoint", () => {
    render(<AdCreative {...PROPS} shape="banner" />);
    const imgs = screen.getAllByRole("img", { name: "Acme Fabrication" });
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute("src", "d.jpg");
    expect(imgs[1]).toHaveAttribute("src", "m.jpg");
  });

  it("mpu shows two creatives at the same box size", () => {
    render(<AdCreative {...PROPS} shape="mpu" />);
    expect(screen.getAllByRole("img", { name: "Acme Fabrication" })).toHaveLength(2);
  });

  it("skyscraper shows only the desktop creative", () => {
    render(<AdCreative {...PROPS} shape="skyscraper" />);
    expect(screen.getByRole("img", { name: "Acme Fabrication" })).toHaveAttribute("src", "d.jpg");
  });

  it("rail and in_feed show only the mobile creative", () => {
    const { rerender } = render(<AdCreative {...PROPS} shape="rail" />);
    expect(screen.getByRole("img", { name: "Acme Fabrication" })).toHaveAttribute("src", "m.jpg");
    rerender(<AdCreative {...PROPS} shape="in_feed" />);
    expect(screen.getByRole("img", { name: "Acme Fabrication" })).toHaveAttribute("src", "m.jpg");
  });

  it("links to the given href and labels itself for screen readers", () => {
    render(<AdCreative {...PROPS} shape="mpu" />);
    expect(screen.getByRole("link", { name: "Advert: Acme Fabrication" })).toHaveAttribute("href", "/visit/ad1");
  });
});

describe("impression counting", () => {
  it("counts once the artwork has been ≥50% visible for a full second", async () => {
    render(<AdCreative {...PROPS} shape="skyscraper" />);
    await markLoaded(screen.getByRole("img"));

    const io = FakeIntersectionObserver.instances[0];
    expect(io.observe).toHaveBeenCalled();
    io.callback([{ intersectionRatio: 0.6 } as IntersectionObserverEntry], io as unknown as IntersectionObserver);
    expect(reportAdSeen).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(reportAdSeen).toHaveBeenCalledExactlyOnceWith("ad1");
    expect(io.disconnect).toHaveBeenCalled();
  });

  it("resets the visibility timer if it scrolls away before earning the impression", async () => {
    render(<AdCreative {...PROPS} shape="skyscraper" />);
    await markLoaded(screen.getByRole("img"));
    const io = FakeIntersectionObserver.instances[0];

    io.callback([{ intersectionRatio: 0.6 } as IntersectionObserverEntry], io as unknown as IntersectionObserver);
    vi.advanceTimersByTime(400);
    io.callback([{ intersectionRatio: 0.1 } as IntersectionObserverEntry], io as unknown as IntersectionObserver); // scrolled away
    vi.advanceTimersByTime(1000);
    expect(reportAdSeen).not.toHaveBeenCalled();
  });

  it("never counts an image that failed to load (naturalWidth 0)", async () => {
    render(<AdCreative {...PROPS} shape="skyscraper" />);
    await markLoaded(screen.getByRole("img"), 0);
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it("counts on load instead, when IntersectionObserver isn't available at all", async () => {
    vi.unstubAllGlobals();
    // @ts-expect-error deliberately simulating an older browser
    delete window.IntersectionObserver;

    render(<AdCreative {...PROPS} shape="skyscraper" />);
    await markLoaded(screen.getByRole("img"));
    expect(reportAdSeen).toHaveBeenCalledExactlyOnceWith("ad1");
  });
});

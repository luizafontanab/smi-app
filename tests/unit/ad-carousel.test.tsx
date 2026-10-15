// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AD_CAROUSEL_INTERVAL_MS, AdCarousel, type CarouselAdvert } from "@/components/AdCarousel";
import { reportAdSeen } from "@/lib/ad-impressions";

// How an impression is earned is AdCreative's job (ad-creative.test.tsx);
// here, which frame is showing — and that only that frame counts one.
vi.mock("@/lib/ad-impressions", () => ({ reportAdSeen: vi.fn() }));

const ad = (id: string): CarouselAdvert => ({ advertId: id, name: `Advertiser ${id}`, href: `/visit/${id}`, desktop: `${id}-d.jpg`, mobile: `${id}-m.jpg` });
const THREE = [ad("a"), ad("b"), ad("c")];

let reducedMotion = false;

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion = false;
  vi.spyOn(globalThis, "setInterval");
  vi.spyOn(globalThis, "clearInterval");
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reducedMotion && query.includes("reduce"), media: query }));
});

afterEach(() => {
  vi.mocked(reportAdSeen).mockReset();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The advert link that is currently the visible frame. */
const showing = () =>
  [...document.querySelectorAll<HTMLAnchorElement>('a[data-active="true"]')].map((a) => a.getAttribute("href"));

/** Carousel intervals started — other timers (React, next/image) are not ours to count. */
const carouselIntervals = () =>
  vi.mocked(setInterval).mock.calls.filter(([, ms]) => ms === AD_CAROUSEL_INTERVAL_MS).length;
const carouselClears = () => vi.mocked(clearInterval).mock.calls.length;

/** The frames' grid — the swipe and hover surface. */
const track = (container: HTMLElement) => container.querySelector(".touch-pan-y") as HTMLElement;

const tick = (n = 1) => act(() => vi.advanceTimersByTime(AD_CAROUSEL_INTERVAL_MS * n));

describe("AdCarousel", () => {
  it("renders a single advert statically — no dots, no timer", () => {
    render(<AdCarousel adverts={[ad("a")]} shape="banner" path="/" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(carouselIntervals()).toBe(0);
    expect(showing()).toEqual(["/visit/a"]);
  });

  it("shows one frame at a time and cycles through all three in order, wrapping", () => {
    render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
    expect(showing()).toEqual(["/visit/a"]);
    tick();
    expect(showing()).toEqual(["/visit/b"]);
    tick();
    expect(showing()).toEqual(["/visit/c"]);
    tick();
    expect(showing()).toEqual(["/visit/a"]);
  });

  it("makes hidden frames inert and invisible to assistive tech", () => {
    const { container } = render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
    const frames = [...container.querySelectorAll("a[data-active]")].map((a) => a.parentElement!);
    expect(frames[0]).not.toHaveAttribute("inert");
    expect(frames[0]).not.toHaveAttribute("aria-hidden");
    for (const f of frames.slice(1)) {
      expect(f).toHaveAttribute("inert");
      expect(f).toHaveAttribute("aria-hidden", "true");
    }
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("pauses on hover and on keyboard focus (WCAG 2.2.2), and resumes after", () => {
    const { container } = render(<AdCarousel adverts={THREE} shape="banner" path="/" />);

    fireEvent.mouseEnter(track(container));
    tick(2);
    expect(showing()).toEqual(["/visit/a"]);
    fireEvent.mouseLeave(track(container));
    tick();
    expect(showing()).toEqual(["/visit/b"]);

    act(() => screen.getByRole("link").focus());
    tick(2);
    expect(showing()).toEqual(["/visit/b"]);
  });

  // Review 16 Oct: hover and focus shared one flag, so either ending resumed
  // the rotation while the other still held.
  it("keeps holding for keyboard focus after the mouse leaves", () => {
    const { container } = render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
    act(() => screen.getByRole("link").focus());
    fireEvent.mouseEnter(track(container));
    fireEvent.mouseLeave(track(container));
    tick(2);
    expect(showing()).toEqual(["/visit/a"]);

    act(() => screen.getByRole("link").blur());
    tick();
    expect(showing()).toEqual(["/visit/b"]);
  });

  it("keeps holding under the pointer after focus leaves", () => {
    const { container } = render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
    fireEvent.mouseEnter(track(container));
    act(() => screen.getByRole("link").focus());
    act(() => screen.getByRole("link").blur());
    tick(2);
    expect(showing()).toEqual(["/visit/a"]);
  });

  it("keeps holding for focus moving between the advert and the dots", () => {
    render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
    act(() => screen.getByRole("link").focus());
    act(() => screen.getByRole("button", { name: "Show advert 2 of 3" }).focus());
    tick(2);
    expect(showing()).toEqual(["/visit/a"]);
  });

  // WCAG 2.2.2: hover and focus are mouse and keyboard only — touch and
  // screen-reader users need a control that stays put.
  describe("Pause/Play button", () => {
    it("stops the rotation until Play is pressed", () => {
      render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
      fireEvent.click(screen.getByRole("button", { name: "Pause adverts" }));
      tick(3);
      expect(showing()).toEqual(["/visit/a"]);

      fireEvent.click(screen.getByRole("button", { name: "Play adverts" }));
      tick();
      expect(showing()).toEqual(["/visit/b"]);
      expect(screen.getByRole("button", { name: "Pause adverts" })).toBeInTheDocument();
    });

    it("isn't undone by a touch, a hover or a dot ending", () => {
      const { container } = render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
      fireEvent.click(screen.getByRole("button", { name: "Pause adverts" }));
      fireEvent.touchStart(track(container), { touches: [{ clientX: 100, clientY: 100 }] });
      fireEvent.touchEnd(track(container), { changedTouches: [{ clientX: 100, clientY: 100 }] });
      fireEvent.mouseEnter(track(container));
      fireEvent.mouseLeave(track(container));
      fireEvent.click(screen.getByRole("button", { name: "Show advert 2 of 3" }));
      tick(3);
      expect(showing()).toEqual(["/visit/b"]);
    });

    it("Play takes effect at once, though focus is still on the button", () => {
      render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
      const toggle = screen.getByRole("button", { name: "Pause adverts" });
      act(() => toggle.focus());
      fireEvent.click(toggle);
      fireEvent.click(toggle);
      tick();
      expect(showing()).toEqual(["/visit/b"]);
    });

    it("isn't offered when nothing rotates (reduced motion, or a single advert)", () => {
      reducedMotion = true;
      const { unmount } = render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
      expect(screen.queryByRole("button", { name: /Pause adverts|Play adverts/ })).toBeNull();
      unmount();
      reducedMotion = false;
      render(<AdCarousel adverts={[ad("a")]} shape="banner" path="/" />);
      expect(screen.queryByRole("button", { name: /Pause adverts|Play adverts/ })).toBeNull();
    });
  });

  // An inactive frame is visibility:hidden but still intersects the viewport,
  // so without AdCreative's `active` gate every hidden frame would count too.
  it("counts an impression for the frame on screen only", async () => {
    class FakeIntersectionObserver {
      static instances: FakeIntersectionObserver[] = [];
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      constructor(public callback: IntersectionObserverCallback) {
        FakeIntersectionObserver.instances.push(this);
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    const { container } = render(<AdCarousel adverts={THREE} shape="skyscraper" path="/news" />);
    // jsdom lays nothing out: make every frame's artwork look loaded and on screen
    for (const img of container.querySelectorAll("img")) {
      Object.defineProperty(img, "offsetParent", { value: document.body, configurable: true });
      Object.defineProperty(img, "complete", { value: true, configurable: true });
      Object.defineProperty(img, "naturalWidth", { value: 300, configurable: true });
      await act(async () => {
        fireEvent.load(img);
        await Promise.resolve();
      });
    }
    const seeAll = () =>
      act(() => {
        for (const io of FakeIntersectionObserver.instances) io.callback([{ intersectionRatio: 1 } as IntersectionObserverEntry], io as unknown as IntersectionObserver);
        vi.advanceTimersByTime(1000);
      });

    seeAll();
    expect(reportAdSeen).toHaveBeenCalledExactlyOnceWith("a", "/news");

    tick();
    seeAll();
    expect(vi.mocked(reportAdSeen).mock.calls).toEqual([["a", "/news"], ["b", "/news"]]);
  });

  it("never auto-advances under prefers-reduced-motion, but the dots still work", () => {
    reducedMotion = true;
    render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
    tick(3);
    expect(showing()).toEqual(["/visit/a"]);

    fireEvent.click(screen.getByRole("button", { name: "Show advert 3 of 3" }));
    expect(showing()).toEqual(["/visit/c"]);
    expect(screen.getByRole("button", { name: "Show advert 3 of 3" })).toHaveAttribute("aria-current", "true");
  });

  it("advances every carousel on the page together, off one shared timer", () => {
    render(
      <>
        <AdCarousel adverts={THREE} shape="banner" path="/" />
        <AdCarousel adverts={[ad("d"), ad("e"), ad("f")]} shape="banner" path="/" />
      </>,
    );
    expect(carouselIntervals()).toBe(1);
    tick();
    expect(showing()).toEqual(["/visit/b", "/visit/e"]);
  });

  // WCAG 1.4.4: touch-pan-y alone turned pinch-zoom off over every banner.
  it("lets the reader pinch-zoom over the adverts, not only scroll", () => {
    const { container } = render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
    expect(track(container)).toHaveClass("touch-pan-y", "touch-pinch-zoom");
  });

  describe("swipe (Jas 13/10 item 6)", () => {
    const swipe = (el: HTMLElement, from: [number, number], to: [number, number]) => {
      fireEvent.touchStart(el, { touches: [{ clientX: from[0], clientY: from[1] }] });
      fireEvent.touchEnd(el, { changedTouches: [{ clientX: to[0], clientY: to[1] }] });
    };

    it("a left swipe shows the next advert, a right swipe the previous, wrapping", () => {
      const { container } = render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
      swipe(track(container), [200, 100], [100, 105]);
      expect(showing()).toEqual(["/visit/b"]);
      swipe(track(container), [100, 100], [220, 100]);
      swipe(track(container), [100, 100], [220, 100]);
      expect(showing()).toEqual(["/visit/c"]);
    });

    it("ignores a mostly-vertical drag (the reader is scrolling) and a short wobble", () => {
      const { container } = render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
      swipe(track(container), [200, 100], [140, 300]);
      swipe(track(container), [200, 100], [180, 100]);
      expect(showing()).toEqual(["/visit/a"]);
    });

    it("doesn't follow the advert link on the click a swipe can leave behind", () => {
      const { container } = render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
      swipe(track(container), [200, 100], [100, 100]);
      const link = container.querySelector('a[data-active="true"]') as HTMLAnchorElement;
      const click = new MouseEvent("click", { bubbles: true, cancelable: true });
      link.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      // ...but only that one: the next tap is a real click
      const next = new MouseEvent("click", { bubbles: true, cancelable: true });
      link.dispatchEvent(next);
      expect(next.defaultPrevented).toBe(false);
    });

    it("keeps rotating from wherever the swipe left it", () => {
      const { container } = render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
      swipe(track(container), [200, 100], [100, 100]);
      tick();
      expect(showing()).toEqual(["/visit/c"]);
    });
  });

  it("stops the shared timer once nothing is listening", () => {
    const { unmount } = render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
    expect(carouselIntervals()).toBe(1);
    const before = carouselClears();
    unmount();
    expect(carouselClears()).toBe(before + 1);
    // and a fresh mount starts a new one rather than reusing a dead handle
    render(<AdCarousel adverts={THREE} shape="banner" path="/" />);
    expect(carouselIntervals()).toBe(2);
  });
});

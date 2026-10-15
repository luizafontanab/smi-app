// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AD_CAROUSEL_INTERVAL_MS, AdCarousel, type CarouselAdvert } from "@/components/AdCarousel";

// Impression counting is AdCreative's job (ad-creative.test.tsx); here only
// which frame is showing matters.
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
    const root = container.firstElementChild!;

    fireEvent.mouseEnter(root);
    tick(2);
    expect(showing()).toEqual(["/visit/a"]);
    fireEvent.mouseLeave(root);
    tick();
    expect(showing()).toEqual(["/visit/b"]);

    fireEvent.focus(screen.getByRole("link"));
    tick(2);
    expect(showing()).toEqual(["/visit/b"]);
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

  describe("swipe (Jas 13/10 item 6)", () => {
    const track = (container: HTMLElement) => container.querySelector(".touch-pan-y") as HTMLElement;
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

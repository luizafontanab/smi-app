/**
 * Taking one comparable photograph of one route.
 *
 * "Comparable" is the whole job: the same page, shot twice with no code change,
 * must produce identical bytes. What gets us there is cheap and mostly
 * declarative — fixed viewport, no device-pixel scaling, reduced motion, a fixed
 * locale and timezone, a settle sequence that waits for real signals rather than
 * sleeping, and the cursor parked off-canvas so nothing is in a hover state.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { collectElementBoxes, type ElementBox } from "./elements";
import type { Route } from "../manifest";

export const VIEWPORT = { width: 1280, height: 900 };

/**
 * A page taller than this is a bug (an infinite list, a broken layout), not a
 * screenshot — capturing it would write a ~200MB PNG into the baseline.
 */
const MAX_PAGE_HEIGHT = 20_000;

export type Capture = { png: Buffer; elements: ElementBox[]; height: number };

export async function launch(): Promise<Browser> {
  return chromium.launch({
    args: [
      // Font rasterisation is the main source of one-pixel jitter between runs.
      "--font-render-hinting=none",
      "--disable-lcd-text",
      "--force-color-profile=srgb",
      "--hide-scrollbars",
    ],
  });
}

export async function makeContext(browser: Browser, baseURL: string, storageState: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL,
    storageState,
    viewport: VIEWPORT,
    // 1, not 2: halves the bytes committed to git, and removes any retina drift.
    deviceScaleFactor: 1,
    // Triggers the existing @media (prefers-reduced-motion: reduce) block in
    // globals.css:556-580, which kills the infinite 26s hero ken-burns pan and
    // every entrance animation.
    reducedMotion: "reduce",
    colorScheme: "light",
    // Dates are formatted server-side (src/lib/hero.ts) but client components
    // format too; pin both so a machine's locale can't move a baseline.
    locale: "en-GB",
    timezoneId: "Europe/London",
  });

  /**
   * tsx compiles this project with esbuild, which wraps function declarations in
   * a `__name()` helper to preserve names. Playwright serialises
   * collectElementBoxes into the page, where that helper does not exist — so
   * every page.evaluate throws `__name is not defined`. Supplied as a string so
   * the shim itself is not put through the same transform.
   */
  await context.addInitScript({ content: "globalThis.__name = globalThis.__name || ((fn) => fn);" });

  /**
   * A production build of this app should talk to nothing but localhost. Blocking
   * everything else keeps a run off the public internet (Leaflet would otherwise
   * pull map tiles from the OSM CDN on every capture that shows a map) and makes
   * a stray third-party request visible instead of merely slow.
   */
  await context.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === "127.0.0.1" || host === "localhost") return route.continue();
    return route.abort();
  });

  return context;
}

/** Everything that has to be true before the shutter opens. */
async function settle(page: Page, route: Route): Promise<void> {
  // Streamed routes (there is a src/app/(public)/loading.tsx) need this or the
  // skeleton gets photographed.
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {
    // A page that never goes idle is still worth shooting; the diff will say so.
  });

  await page.evaluate(() => document.fonts.ready);

  /**
   * Force every lazy image to load before the shutter opens.
   *
   * A full-page screenshot is stitched by scrolling, and `loading="lazy"` images
   * only begin fetching as they near the viewport — so whether something far
   * down the page (the footer logo, on a long article) has painted by the time
   * its strip is captured is a race. This walks the page once to trigger them
   * all, returns to the top, and waits for every image to finish decoding.
   */
  await page.evaluate(async () => {
    for (const img of Array.from(document.images)) img.loading = "eager";
    const step = window.innerHeight;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    window.scrollTo(0, 0);
    await Promise.all(
      Array.from(document.images)
        .filter((i) => !i.complete)
        .map((i) => i.decode().catch(() => undefined)),
    );
  });

  // Belt and braces over reducedMotion: anything driven by JS rather than CSS,
  // and any transition mid-flight, stops here.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation: none !important;
      transition: none !important;
      caret-color: transparent !important;
    }`,
  });

  if (route.waitFor) {
    await page.waitForSelector(route.waitFor.selector, { timeout: 15_000 });
  }

  // HomeHero promotes a card on pointer-over and resets on pointer-leave, so a
  // cursor left at 0,0 from a previous action would photograph a hover state.
  await page.mouse.move(-10, -10);

  // Two frames: one for any layout the style tag forced, one to paint it.
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

export async function capture(context: BrowserContext, route: Route): Promise<Capture> {
  const page = await context.newPage();
  try {
    const response = await page.goto(route.path, { waitUntil: "domcontentloaded", timeout: 45_000 });

    const status = response?.status() ?? 0;
    if (status >= 400) throw new Error(`HTTP ${status}`);

    // An expired login state would otherwise quietly produce N baselines of the
    // login page. Compare paths, not full URLs — query strings are legitimate.
    const landed = new URL(page.url()).pathname;
    const wanted = new URL(route.path, "http://127.0.0.1").pathname;
    if (landed === "/login" && wanted !== "/login") {
      throw new Error(`redirected to /login — the ${route.role} session is not valid`);
    }

    await settle(page, route);

    /**
     * The HTTP status cannot be trusted for this. These routes stream, so the
     * headers are already sent with 200 by the time notFound() is reached and
     * the not-found UI renders inside a 200 response — a pinned slug that no
     * longer exists would otherwise be photographed as if it were the page, and
     * baselined as "correct". Both not-found components render a standalone
     * "404" marker (src/app/not-found.tsx:20, src/app/(public)/not-found.tsx:14).
     */
    const isNotFound = await page.evaluate(() => {
      const headings = ["We couldn't find that page", "That page doesn't exist"];
      const h1 = document.querySelector("h1")?.textContent?.trim() ?? "";
      if (headings.includes(h1)) return true;
      return Array.from(document.querySelectorAll("p")).some((p) => p.textContent?.trim() === "404");
    });
    if (isNotFound) {
      throw new Error("rendered the not-found page (status was 200 — the response had already streamed)");
    }

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height > MAX_PAGE_HEIGHT) {
      throw new Error(`page is ${height}px tall (limit ${MAX_PAGE_HEIGHT}) — refusing to capture`);
    }

    const png = await page.screenshot({
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      scale: "css",
      type: "png",
    });

    // Same page state as the shot — this must not move between the two.
    const elements = await page.evaluate(collectElementBoxes);

    return { png, elements, height };
  } finally {
    await page.close();
  }
}

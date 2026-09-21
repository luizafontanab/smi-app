import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// RTL's auto-cleanup only self-registers when `afterEach` is a global, which
// it isn't here (test.globals is off, same as every other suite) — wired
// explicitly instead. Inert for the existing node-environment .ts suites.
afterEach(cleanup);

/*
 * Two browser APIs jsdom doesn't implement, stubbed rather than guarded at
 * every call site — a `typeof ResizeObserver === "undefined"` check in a
 * component is dead code in every real browser and hides the dependency.
 *
 * Both are inert: the observer never fires (jsdom lays nothing out, so no
 * element ever resizes) and matchMedia reports "not reduced motion", which is
 * the default a component should behave correctly under. A test that cares
 * about either overrides it locally.
 */
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// The integration suites (stripe-webhook, resend-webhook, unsubscribe, …) are
// describe.skipIf(!SUPABASE_SECRET_KEY). Locally the key comes from .env.local
// via vitest.config.ts; in CI a missing key must be a hard failure, or the
// suites covering the two highest-risk unauthenticated routes silently no-op
// and a green run means nothing.
if (process.env.CI && !process.env.SUPABASE_SECRET_KEY) {
  throw new Error("CI run without SUPABASE_SECRET_KEY — integration suites would silently skip. Start the local Supabase stack and export its keys.");
}

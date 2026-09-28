import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { isLocalSupabaseUrl } from "../scripts/lib/target-guard";

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

/*
 * …and those same suites INSERT real rows, gated until now only on the key
 * existing — never on where it points. vitest.config.ts loads .env.local into
 * the test environment, so production credentials in that file turn an ordinary
 * `pnpm check` into a write against the live database.
 *
 * That is not hypothetical. On 25 Sep 2026 it put 53 test members, 12 contacts,
 * 11 inbox messages and a newsletter issue into production, plus ~22 auth
 * accounts, across a handful of routine `pnpm check` runs.
 *
 * Fail the run rather than skip the suites: a silent skip is exactly the
 * failure this file's CI check above exists to prevent, and skipping here would
 * hide the misconfiguration instead of naming it. Set
 * ALLOW_REMOTE_INTEGRATION_TESTS=1 to override deliberately — the same shape as
 * the seeds' `--remote` flag (scripts/lib/target-guard.ts).
 */
const integrationUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (
  process.env.SUPABASE_SECRET_KEY &&
  integrationUrl &&
  !isLocalSupabaseUrl(integrationUrl) &&
  process.env.ALLOW_REMOTE_INTEGRATION_TESTS !== "1"
) {
  throw new Error(
    `Refusing to run tests against a remote Supabase project.\n` +
      `  NEXT_PUBLIC_SUPABASE_URL: ${integrationUrl}\n` +
      `The integration suites under tests/unit/ insert real rows (members, adverts, contacts, ` +
      `inbox_messages, newsletter_issues). Point .env.local at the local stack — ` +
      `\`supabase status\` — or set ALLOW_REMOTE_INTEGRATION_TESTS=1 if you genuinely mean it.`,
  );
}

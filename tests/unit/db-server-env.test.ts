import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * lib/db/server.ts reads its env vars with a `!` assertion, which is a
 * compile-time claim and nothing more. Without the runtime guard, a missing
 * variable surfaces as "supabaseKey is required" thrown from inside
 * supabase-js — several frames from the cause, and identical whichever
 * variable is the missing one. These assert the guard names the variable.
 *
 * The module reads process.env at import time, so each case resets the module
 * registry and re-imports rather than sharing one instance.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function freshDbServer() {
  vi.resetModules();
  return import("@/lib/db/server");
}

describe("db client env guards", () => {
  it("names NEXT_PUBLIC_SUPABASE_URL when the public client has no URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    const { publicDb } = await freshDbServer();

    expect(() => publicDb()).toThrow(/NEXT_PUBLIC_SUPABASE_URL is not set/);
  });

  it("names NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY when only the key is missing", async () => {
    // Set the URL here rather than rely on .env.local, or a checkout without
    // one fails on the URL check first.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:56321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
    const { publicDb } = await freshDbServer();

    expect(() => publicDb()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set/);
  });

  it("treats an empty string as missing, not as a usable value", async () => {
    // Vercel hands through an unset project variable as "", which would
    // otherwise sail past a null check and fail deep inside supabase-js.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { publicDb } = await freshDbServer();

    expect(() => publicDb()).toThrow(/NEXT_PUBLIC_SUPABASE_URL is not set/);
  });

  it("builds a client when the variables are present", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:56321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const { publicDb } = await freshDbServer();

    expect(() => publicDb()).not.toThrow();
  });
});

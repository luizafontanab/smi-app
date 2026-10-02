import { describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

import { logDb } from "@/lib/db/log-client";

// The recursion guard (docs/logging.md): the error log must be written with
// plain fetch, never through db/server.ts's loggingFetch, or a failing
// database would report its own failure through itself.
describe("logDb", () => {
  it("uses the platform fetch, not the transport logger", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:56321";
    process.env.SUPABASE_SECRET_KEY ||= "test-key";
    logDb();
    const opts = (createClient.mock.calls.at(-1) as unknown as [string, string, { global: { fetch: typeof fetch } }])[2];
    expect(opts.global.fetch).toBe(fetch);
  });

  it("returns null instead of throwing when the env is missing", () => {
    const saved = process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
    expect(logDb()).toBeNull();
    process.env.SUPABASE_SECRET_KEY = saved;
  });
});

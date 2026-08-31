import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
    environment: "node",
    // Several suites here are integration tests against the local Supabase
    // stack in Docker, whose latency is spiky — measured between 0.05s and 8.3s
    // for the same single-row statement. Vitest's 5s default turned that into
    // intermittent timeouts that look like failures but are just the stack
    // catching its breath. The pure-unit files finish in milliseconds either
    // way, so this only ever costs time on a genuine hang.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // lib/db/server.ts imports "server-only" as a build-time guard; under
      // Vitest's resolution that module throws on import. See the stub.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});

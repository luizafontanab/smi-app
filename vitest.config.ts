import { defineConfig } from "vitest/config";
import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";

/**
 * Minimal .env.local reader (KEY=value lines, # comments, optional quotes).
 * Hand-rolled because neither vite nor dotenv is a direct dependency, and the
 * file is machine-written by `supabase start` in the simple format.
 * Real environment always wins over the file.
 */
function localEnv(): Record<string, string> {
  const file = path.resolve(__dirname, ".env.local");
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    out[m[1]] = process.env[m[1]] ?? m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    // Load .env.local (SUPABASE_SECRET_KEY etc.) so the integration suites run
    // instead of silently no-oping — several are `describe.skipIf(!KEY)`, and
    // the two webhook suites cover the highest-risk unauthenticated routes.
    // tests/setup.ts enforces the key's presence in CI so a skip can never
    // look like a pass there.
    env: localEnv(),
    // Several suites here are integration tests against the local Supabase
    // stack in Docker, whose latency is spiky — measured between 0.05s and 8.3s
    // for the same single-row statement. Vitest's 5s default turned that into
    // intermittent timeouts that look like failures but are just the stack
    // catching its breath. The pure-unit files finish in milliseconds either
    // way, so this only ever costs time on a genuine hang.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/app/**/page.tsx",
        "src/app/**/layout.tsx",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // lib/db/server.ts imports "server-only" as a build-time guard; under
      // Vitest's resolution that module throws on import. See the stub.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
      // Real next/navigation and next/headers only work inside Next's own
      // rendering machinery. Aliasing them globally (rather than per test
      // file) means any server module that imports redirect()/cookies()/
      // headers() unit-tests directly — see the stubs for how to use them.
      "next/navigation": path.resolve(__dirname, "tests/stubs/next-navigation.ts"),
      "next/headers": path.resolve(__dirname, "tests/stubs/next-headers.ts"),
      "next/cache": path.resolve(__dirname, "tests/stubs/next-cache.ts"),
    },
  },
});

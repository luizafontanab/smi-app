import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
    environment: "node",
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

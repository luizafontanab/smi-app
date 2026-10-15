import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * `next build`/`next dev` APPEND `<distDir>/types/**` and `<distDir>/dev/types/**`
 * to tsconfig's include for whatever distDir they ran with, and never take an
 * entry out again (next/dist/lib/typescript/writeConfigurationDefaults.js). A
 * one-off build with a custom VISUAL_DIST_DIR (`.next/crmcheck`) left two
 * entries pointing at a directory that no longer exists (review, 16 Oct).
 *
 * The dist dirs this repo actually uses are the two next.config.ts names:
 * `.next`, and `.next-visual` for the visual suite. If this fails after a side
 * build, delete the new entries rather than adding them here.
 */
const ROOT = path.resolve(__dirname, "../..");
const tsconfig = JSON.parse(readFileSync(path.join(ROOT, "tsconfig.json"), "utf8")) as { include: string[] };

describe("tsconfig include", () => {
  it("only names the dist dirs next.config.ts uses", () => {
    const distEntries = tsconfig.include.filter((p) => p.startsWith(".next"));
    expect(distEntries.length).toBeGreaterThan(0);
    for (const entry of distEntries) {
      expect(entry, `stray dist-dir include: ${entry}`).toMatch(/^\.next(?:-visual)?\/(?:dev\/)?types\/\*\*\/\*\.ts$/);
    }
  });
});

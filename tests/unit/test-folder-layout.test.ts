import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Unit tests sit flat in tests/unit, named by area (`classic-header.test.tsx`,
 * `console-actions-<domain>.test.ts`). Vitest's include glob would still run a
 * file in a subfolder, so nothing else stops one appearing; this does. Shared
 * stubs live in tests/stubs, beside this folder rather than inside it.
 */
describe("tests/unit layout", () => {
  it("has no subfolders", () => {
    const unit = path.resolve(__dirname);
    const folders = fs
      .readdirSync(unit, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(folders, "move these tests up into tests/unit with a prefix, e.g. tests/unit/<area>-<name>.test.ts").toEqual([]);
  });
});

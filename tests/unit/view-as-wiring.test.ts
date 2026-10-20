import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "View as member" (fix-list 94) is read-only because of a split in lib/auth:
 * pages render through requireMemberView, which lets an admin with a view-as
 * cookie in; actions go through requireMember, which never does. The split is
 * only as good as its wiring, so this reads the source — like upload-wiring —
 * and fails the moment an action reaches for the permissive one, or a page
 * keeps the strict one (which would bounce the admin out of that page).
 */
const SRC = path.resolve(__dirname, "../../src");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const sources = files(SRC).map((file) => ({ file: path.relative(SRC, file), text: readFileSync(file, "utf8") }));

/** Server actions allowed requireMemberView: they only read, and the view should match what the member gets. */
const READ_ONLY_ACTIONS = new Set(["app/dashboard/actions.ts#previewStoryBody"]);

describe("view-as wiring", () => {
  it("finds the sources it polices (the walk still works)", () => {
    expect(sources.map((s) => s.file)).toEqual(expect.arrayContaining(["app/dashboard/layout.tsx", "app/dashboard/actions.ts", "lib/auth.ts"]));
  });

  it("never lets a server action use requireMemberView, bar the read-only allowlist", () => {
    const actions = sources.filter((s) => /^["']use server["']/.test(s.text.trimStart()));
    expect(actions.length).toBeGreaterThan(2);
    const offenders = actions.flatMap((s) =>
      s.text
        .split(/^(?=export (?:async )?function )/m)
        .filter((chunk) => /\brequireMemberView\(/.test(chunk))
        .map((chunk) => `${s.file}#${chunk.match(/^export (?:async )?function (\w+)/)?.[1] ?? "(module scope)"}`)
        .filter((where) => !READ_ONLY_ACTIONS.has(where)));
    expect(offenders).toEqual([]);
  });

  it("renders every member-area page and layout through requireMemberView", () => {
    const dashboard = sources.filter((s) => s.file.startsWith("app/dashboard/") && /(^|\/)(page|layout)\.tsx$/.test(s.file));
    expect(dashboard.length).toBeGreaterThan(20);
    expect(dashboard.filter((s) => /\brequireMember\(/.test(s.text)).map((s) => s.file)).toEqual([]);
  });
});

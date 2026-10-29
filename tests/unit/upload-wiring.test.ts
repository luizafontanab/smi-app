import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every upload goes direct (lib/staged-upload): a raw <input type="file">
 * posts its bytes inside the server-action request, which Vercel caps at
 * 4.5MB — under the 8MB/20MB the forms promise. So the rule is structural:
 * file inputs are rendered only by the components that stage them, and an
 * action reads a file field only through submittedFile, which accepts the
 * staged path. Static, like migration-function-hygiene: it reads the source,
 * so a new form that forgets is caught before anyone uploads a phone photo.
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

/** The only places a real file input may be rendered: each one stages what it's given. */
const STAGING_INPUTS = new Set(["components/UploadField.tsx", "components/CoverField.tsx", "components/RichTextEditorImpl.tsx"]);

describe("upload wiring", () => {
  it("finds the sources it polices (the walk still works)", () => {
    expect(sources.map((s) => s.file)).toEqual(expect.arrayContaining(["app/dashboard/actions.ts", "app/console/actions.ts", "components/UploadField.tsx"]));
  });

  it("renders <input type=\"file\"> only inside the direct-upload components", () => {
    const raw = sources.filter((s) => /type=["']file["']/.test(s.text) && !STAGING_INPUTS.has(s.file)).map((s) => s.file);
    expect(raw).toEqual([]);
  });

  it("never reads a file field straight off the FormData in a server action", () => {
    const actions = sources.filter((s) => /^["']use server["']/.test(s.text.trimStart()));
    expect(actions.length).toBeGreaterThan(2);
    const offenders = actions.flatMap((s) =>
      [...s.text.matchAll(/formData\.get\([^)]*\)\s+as\s+File\b|editorImageUpload\(\s*formData\.get/g)].map((m) => `${s.file}: ${m[0]}`));
    expect(offenders).toEqual([]);
  });

  /**
   * Uploads whose bytes never pass through the action's request, so the 4.5MB
   * request cap this rule guards against can't apply. Each is named exactly.
   */
  const SERVER_FETCHED = new Set([
    // "Start story": the article's image, downloaded by the server (lib/sources/fetch.ts fetchImage).
    "app/console/sources/actions.ts: uploadImage(draft.cover",
  ]);

  it("hands uploadImage / uploadDocument only what submittedFile produced", () => {
    const actions = sources.filter((s) => s.file.startsWith("app/") && /^["']use server["']/.test(s.text.trimStart()));
    const offenders = actions.flatMap((s) =>
      [...s.text.matchAll(/\b(uploadImage|uploadDocument)\(\s*(?!await submittedFile\(|file\b)([^,)]*)/g)].map((m) => `${s.file}: ${m[1]}(${m[2]}`));
    expect(offenders.filter((o) => !SERVER_FETCHED.has(o))).toEqual([]);
  });
});

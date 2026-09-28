import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Admin-facing release notes, read from src/content/release-notes.md.
 *
 * The file uses a deliberately tiny subset of markdown — `## YYYY-MM-DD — Title`
 * headings and `- ` bullets — so it can be parsed here without a markdown
 * dependency and rendered as plain text nodes. Anything outside that subset
 * throws, and a unit test parses the real file, so a bad edit fails
 * `pnpm check` rather than rendering half a page.
 */
export type ReleaseNote = { date: string; title: string; items: string[] };

export const RELEASE_NOTES_FILE = "src/content/release-notes.md";

const HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\s+[—–-]\s+(\S.*)$/;
const BULLET = /^-\s+(\S.*)$/;

export function parseReleaseNotes(md: string): ReleaseNote[] {
  // HTML comments may span lines, so they go before the line split.
  const lines = md.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const notes: ReleaseNote[] = [];

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const where = `release notes line ${i + 1}`;

    const heading = HEADING.exec(line);
    if (heading) {
      const [, date, title] = heading;
      // A regex-shaped date can still be a non-date (2026-02-30).
      const d = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
        throw new Error(`${where}: "${date}" is not a real date`);
      }
      notes.push({ date, title: title.trim(), items: [] });
      return;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      const current = notes.at(-1);
      if (!current) throw new Error(`${where}: a bullet needs a "## YYYY-MM-DD — Title" heading above it`);
      current.items.push(bullet[1].trim());
      return;
    }

    throw new Error(`${where}: expected "## YYYY-MM-DD — Title" or "- item", got "${line}"`);
  });

  return notes;
}

/** Server-only: reads the file shipped with the deploy (see outputFileTracingIncludes). */
export function loadReleaseNotes(): ReleaseNote[] {
  return parseReleaseNotes(readFileSync(path.join(process.cwd(), RELEASE_NOTES_FILE), "utf8"));
}

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #48: every button that starts work must be disabled, and say so, from the
 * first click until the work finishes, so nobody clicks twice. SubmitButton
 * does that for any form, so this reads the source, like view-as-wiring, and
 * fails the moment someone writes a plain submit <button> instead.
 *
 * A <button> counts as a submit button unless it says type="button" (the HTML
 * default is submit). The exceptions below don't start any server work, or
 * handle their own pending state; each says why.
 */
const SRC = path.resolve(__dirname, "../../src");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** "file#label" → why it may stay a plain submit button. */
const ALLOWED: Record<string, string> = {
  // GET forms: a plain page load the browser shows itself; repeating it is harmless.
  "app/(public)/event/page.tsx#Search": "GET search",
  "app/(public)/member/page.tsx#Search": "GET search",
  "app/(public)/news/page.tsx#Apply dates": "GET filter",
  "app/(public)/search/page.tsx#Search": "GET search",
  "components/SearchForm.tsx#Search": "GET search",
  "app/console/analytics/page.tsx#Apply": "GET filter",
  "app/console/dev/page.tsx#Apply": "GET filter",
  "app/console/crm/page.tsx#Search": "GET search",
  "app/console/crm/CompaniesBox.tsx#Search": "GET search",
  "app/console/leads/page.tsx#Search": "GET search",
  // <noscript> fallbacks: only render with JavaScript off, where React (and so SubmitButton) never runs.
  "app/console/stories/StoryBoard.tsx#Move": "noscript fallback",
  "app/console/videos/VideoBoard.tsx#Move": "noscript fallback",
  "app/console/events/EventBoard.tsx#Move": "noscript fallback",
  "app/console/dev/DevBoard.tsx#Move": "noscript fallback",
  // Own useActionState pending: disabled with a working label already.
  "app/(public)/join/account/AccountForm.tsx#{pending ? \"Creating your account…\" : \"Create account & continue\"}": "own pending state",
  "app/dashboard/pay/PayForm.tsx#{pending ? \"Processing…\" : \"Pay £40/month\"}": "own pending state",
  "components/ContactForm.tsx#{pending ? \"Sending…\" : \"Send\"}": "own pending state",
  "components/NewsletterSignup.tsx#{pending ? \"…\" : \"Subscribe\"}": "own pending state",
  // Submits another form (form=), whose pending state SubmitButton can't see; it listens to FormPendingSignal.
  "components/console/SocialConfirmButton.tsx#{pending && pressed ? pendingLabel : children}": "own pending state",
};

const BUTTON = /<button\b([\s\S]*?)>([\s\S]*?)<\/button>/g;

function plainSubmitButtons() {
  const found: string[] = [];
  for (const full of files(SRC)) {
    const file = path.relative(SRC, full);
    if (file === "components/SubmitButton.tsx") continue;
    const text = readFileSync(full, "utf8");
    for (const m of text.matchAll(BUTTON)) {
      if (/\btype="button"/.test(m[1])) continue;
      found.push(`${file}#${m[2].replace(/\s+/g, " ").trim()}`);
    }
  }
  return found;
}

describe("submit buttons (#48)", () => {
  const found = plainSubmitButtons();

  it("finds the sources it polices (the walk still works)", () => {
    expect(found.length).toBeGreaterThan(0);
  });

  it("uses SubmitButton for every submit button that starts work", () => {
    expect(found.filter((key) => !(key in ALLOWED))).toEqual([]);
  });

  it("has no stale exceptions", () => {
    expect(Object.keys(ALLOWED).filter((key) => !found.includes(key))).toEqual([]);
  });
});

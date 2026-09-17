/**
 * The element map: where everything on the page was, in document coordinates,
 * with a human-readable name.
 *
 * This is what turns "1.4% of pixels differ" into "the 'Scheduled' heading and
 * the third story card moved". It is captured in the same page state as the
 * screenshot, saved next to it, and committed with the baseline — so a diff can
 * compare NAMES across versions too, and say "this heading used to read
 * 'Upcoming'".
 */

export type ElementBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** DOM depth. Ties in the box→element match are broken toward the deepest. */
  depth: number;
  /** e.g. `nav.console-nav → link 'Story Engine'` */
  name: string;
  selector: string;
};

/**
 * Runs INSIDE the browser via page.evaluate, so it must be entirely
 * self-contained: no imports, and no reference to anything declared outside this
 * function — including module-level constants, which are not serialised with it.
 */
export function collectElementBoxes(): ElementBox[] {
  /** Roughly how many boxes are useful before a page's map is mostly noise. */
  const MAX_BOXES = 4000;
  const LANDMARKS = new Set(["HEADER", "NAV", "MAIN", "FOOTER", "ASIDE", "FORM", "TABLE", "DIALOG", "SECTION"]);
  const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "TEMPLATE", "BR", "HEAD"]);

  const clip = (s: string, n: number): string => {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };

  /** What to call this element, most specific identifier first. */
  const label = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const testid = el.getAttribute("data-testid");
    if (testid) return `${tag}[${testid}]`;
    const aria = el.getAttribute("aria-label");
    if (aria) return `${tag} '${clip(aria, 40)}'`;
    // getAttribute, not .id: on a <form>, named controls shadow the element's
    // own properties, so form.id returns the <input name="id"> and stringifies
    // as "[object HTMLInputElement]".
    const id = el.getAttribute("id");
    if (id) return `${tag}#${id}`;
    if (/^H[1-6]$/.test(el.tagName)) return `${tag} '${clip(el.textContent ?? "", 40)}'`;
    if (el.tagName === "A" || el.tagName === "BUTTON") {
      const text = clip(el.textContent ?? "", 30);
      if (text) return `${tag === "a" ? "link" : "button"} '${text}'`;
    }
    if (el.tagName === "IMG") {
      const alt = el.getAttribute("alt");
      if (alt) return `img '${clip(alt, 30)}'`;
    }
    const cls = (el.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      // Tailwind utilities describe appearance, not identity — exactly the thing
      // that changes in a visual regression, so they make useless names.
      .filter((c) => !/[:[\]/]/.test(c) && !/^(flex|grid|block|hidden|mt-|mb-|px-|py-|p-|m-|w-|h-|gap-|text-|bg-|border|rounded|font-|items-|justify-|space-)/.test(c))
      .slice(0, 2)
      .join(".");
    return cls ? `${tag}.${cls}` : tag;
  };

  /** Best-effort unique path, for pasting into devtools. */
  const selectorFor = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.tagName !== "BODY" && parts.length < 6) {
      const tag = node.tagName.toLowerCase();
      const nodeId = node.getAttribute("id"); // see the note in label()
      if (nodeId) {
        parts.unshift(`#${nodeId}`);
        break;
      }
      const parent: Element | null = node.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
      node = parent;
    }
    return parts.join(" > ");
  };

  const out: ElementBox[] = [];
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  const walk = (el: Element, depth: number, landmark: string): void => {
    if (SKIP.has(el.tagName)) return;

    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return;

    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    let own = label(el);
    if (w > 0 && h > 0) {
      // A wrapper whose box matches its only element child adds a name but no
      // information — let the child own the region instead.
      const kids = Array.from(el.children).filter((c) => !SKIP.has(c.tagName));
      const onlyChild = kids.length === 1 ? kids[0].getBoundingClientRect() : null;
      const isPassThrough =
        onlyChild !== null &&
        Math.abs(onlyChild.top - rect.top) <= 2 &&
        Math.abs(onlyChild.left - rect.left) <= 2 &&
        Math.abs(onlyChild.width - rect.width) <= 2 &&
        Math.abs(onlyChild.height - rect.height) <= 2;

      if (!isPassThrough) {
        out.push({
          x: Math.round(rect.left + scrollX),
          y: Math.round(rect.top + scrollY),
          w,
          h,
          depth,
          name: landmark && !LANDMARKS.has(el.tagName) ? `${landmark} → ${own}` : own,
          selector: selectorFor(el),
        });
      }
    }

    if (LANDMARKS.has(el.tagName)) {
      landmark = own;
      own = "";
    }
    for (const child of Array.from(el.children)) walk(child, depth + 1, landmark);
  };

  walk(document.body, 0, "");

  // If a page is enormous, the deepest nodes are the least useful labels.
  if (out.length > MAX_BOXES) {
    out.sort((a, b) => a.depth - b.depth);
    out.length = MAX_BOXES;
  }
  return out;
}

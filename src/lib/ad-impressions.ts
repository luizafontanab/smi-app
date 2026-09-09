/**
 * Client-side impression queue. Adverts become visible at different moments as
 * the reader scrolls, so batch them briefly rather than firing one request per
 * advert, and flush on pagehide so a reader who leaves mid-scroll still counts.
 */

const BATCH_MS = 500;

const pending = new Map<string, string>(); // advertId -> path
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function send(items: { id: string; path: string }[]) {
  if (items.length === 0) return;
  const body = JSON.stringify({ items });
  // sendBeacon survives the page going away; keepalive fetch is the fallback
  // for browsers that lack it (and for a beacon the browser refuses to queue).
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    if (navigator.sendBeacon("/api/seen", new Blob([body], { type: "application/json" }))) return;
  }
  void fetch("/api/seen", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // analytics must never surface as a user-visible error
  });
}

function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const items = [...pending.entries()].map(([id, path]) => ({ id, path }));
  pending.clear();
  send(items);
}

/** Queue one advert as genuinely displayed. Callers must already have deduped. */
export function reportAdSeen(advertId: string, path: string) {
  pending.set(advertId, path);
  if (!listening && typeof window !== "undefined") {
    listening = true;
    window.addEventListener("pagehide", flush);
  }
  timer ??= setTimeout(flush, BATCH_MS);
}

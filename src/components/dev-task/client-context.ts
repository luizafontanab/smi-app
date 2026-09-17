import type { DevTaskContext } from "@/lib/dev-tasks";

/**
 * Browser-only error ring buffer + context collector for the dev-task widget.
 *
 * No useSearchParams() (would force a Suspense boundary around a root-layout
 * widget) and no usePathname() — location has everything, read once inside
 * the action wrapper, never during render.
 */

type CapturedError = {
  at: string;
  kind: "error" | "unhandledrejection";
  message: string;
  source?: string;
  line?: number;
  column?: number;
  stack?: string;
  count: number;
};

const MAX_ERRORS = 5;

// Module-level: must survive the dialog opening/closing and start filling on
// page load, before anyone decides to report anything.
const ringBuffer: CapturedError[] = [];

function record(entry: Omit<CapturedError, "count">) {
  const last = ringBuffer[ringBuffer.length - 1];
  if (last && last.kind === entry.kind && last.message === entry.message && last.source === entry.source) {
    last.count += 1;
    return;
  }
  ringBuffer.push({ ...entry, count: 1 });
  if (ringBuffer.length > MAX_ERRORS) ringBuffer.shift();
}

// Named at module level, not inline arrows: addEventListener de-dupes on
// (type, fn) identity, which is what neutralises React 19 StrictMode's
// double-invoked effect.
function onWindowError(e: ErrorEvent) {
  record({
    at: new Date().toISOString(),
    kind: "error",
    message: (e.message || String(e.error)).slice(0, 500),
    source: e.filename?.slice(0, 500),
    line: e.lineno,
    column: e.colno,
    stack: typeof e.error?.stack === "string" ? e.error.stack.slice(0, 1000) : undefined,
  });
}

function onUnhandledRejection(e: PromiseRejectionEvent) {
  const reason = e.reason;
  record({
    at: new Date().toISOString(),
    kind: "unhandledrejection",
    message: (reason instanceof Error ? reason.message : String(reason)).slice(0, 500),
    stack: reason instanceof Error && typeof reason.stack === "string" ? reason.stack.slice(0, 1000) : undefined,
  });
}

/** Call once from a `useEffect(() => installErrorCapture(), [])`. Returns its own cleanup. */
export function installErrorCapture(): () => void {
  // capture: true also catches resource load failures (img/script/link).
  window.addEventListener("error", onWindowError, true);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    window.removeEventListener("error", onWindowError, true);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

/** Read at submit time only — never during render. */
export function collectDevTaskContext(): DevTaskContext {
  return {
    page: {
      pathname: location.pathname,
      url: location.href,
      title: document.title,
      referrer: document.referrer,
    },
    env: {
      user_agent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      screen: `${screen.width}x${screen.height}`,
      dpr: window.devicePixelRatio || 1,
      theme: document.documentElement.getAttribute("data-theme") ?? "forge",
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    errors: ringBuffer.slice(),
    captured_at: new Date().toISOString(),
  };
}

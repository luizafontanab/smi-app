/**
 * Browser half of the error log (docs/logging.md). Browser-safe: no server
 * imports — it is loaded by src/instrumentation-client.ts on every page.
 *
 * Reports go to /api/client-errors, which records them as source "client".
 * Deliberately frugal, because every visitor runs this:
 *   · the same message is reported once per page load, and at most five
 *     reports leave a page, so a render loop can't hammer the endpoint;
 *   · noise nobody can fix is dropped here rather than stored: errors from
 *     browser extensions, ResizeObserver's benign loop warning, and the opaque
 *     "Script error." a cross-origin script produces with no stack.
 */

export type ClientErrorKind = "error" | "unhandledrejection" | "boundary";

export type ClientErrorReport = {
  message: string;
  stack?: string | null;
  digest?: string | null;
  kind: ClientErrorKind;
};

const MAX_PER_PAGE = 5;
const sent = new Set<string>();

export function isNoise(message: string, stack?: string | null): boolean {
  const text = `${message}\n${stack ?? ""}`;
  if (/chrome-extension:\/\/|moz-extension:\/\/|safari-(web-)?extension:\/\//.test(text)) return true;
  if (/ResizeObserver loop/.test(message)) return true;
  if (message.trim() === "Script error." && !stack) return true;
  return false;
}

/** For tests: forget what this page load has already sent. */
export function resetClientErrorReports(): void {
  sent.clear();
}

export function reportClientError(report: ClientErrorReport): void {
  try {
    const message = String(report.message ?? "").slice(0, 1000);
    if (!message || isNoise(message, report.stack)) return;
    if (sent.has(message) || sent.size >= MAX_PER_PAGE) return;
    sent.add(message);
    const body = JSON.stringify({
      message,
      stack: report.stack ? String(report.stack).slice(0, 4000) : null,
      digest: report.digest ?? null,
      kind: report.kind,
      path: window.location.pathname,
    });
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/client-errors", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/client-errors", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
  } catch {
    // reporting an error must never cause one
  }
}

import { reportClientError } from "./lib/client-error-report";

/**
 * Browser error capture for every visitor (docs/logging.md). Next runs this
 * before the app becomes interactive, on every page.
 *
 * Not in capture mode, unlike the admin Feedback widget's listener
 * (components/dev-task/client-context.ts): capture mode also fires for every
 * failed image or script load, which is the widget's business for a bug report
 * but would be a flood of noise here.
 */
try {
  window.addEventListener("error", (event) => {
    const err = event.error;
    reportClientError({
      message: err instanceof Error ? err.message : event.message,
      stack: err instanceof Error ? err.stack : null,
      kind: "error",
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportClientError({
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : null,
      kind: "unhandledrejection",
    });
  });
} catch {
  // instrumentation must never break the page
}

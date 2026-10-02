import type { Instrumentation } from "next";

/**
 * Server error capture (docs/logging.md). Next calls onRequestError for every
 * error it captures on the server — Server Component renders, Route Handlers,
 * Server Actions and the proxy — so this is the one place that sees all of
 * them, including the ones whose only trace used to be a digest on screen.
 *
 * Next's own control-flow throws are not errors: redirect() and notFound()
 * work by throwing. Their digests start with these prefixes (checked against
 * node_modules/next/dist/client/components on 1 Oct 2026).
 */
const CONTROL_FLOW = ["NEXT_REDIRECT", "NEXT_HTTP_ERROR_FALLBACK", "BAILOUT_TO_CLIENT_SIDE_RENDERING", "DYNAMIC_SERVER_USAGE"];

export function digestOf(err: unknown): string | null {
  return typeof err === "object" && err !== null && "digest" in err && typeof err.digest === "string" ? err.digest : null;
}

export function isControlFlow(err: unknown): boolean {
  const digest = digestOf(err);
  return digest != null && CONTROL_FLOW.some((prefix) => digest.startsWith(prefix));
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  try {
    if (isControlFlow(err)) return;
    const ua = request.headers["user-agent"];
    const input = {
      source: "server" as const,
      area: `${context.routeType}:${context.routePath}`,
      error: err,
      path: request.path,
      digest: digestOf(err),
      context: {
        method: request.method,
        renderSource: "renderSource" in context ? context.renderSource : undefined,
        revalidateReason: context.revalidateReason,
        ua: Array.isArray(ua) ? ua[0] : ua,
      },
    };
    // The logger needs node:crypto and the Supabase client — neither belongs
    // in an edge bundle, so the edge runtime keeps the console line only.
    if (process.env.NEXT_RUNTIME !== "nodejs") {
      console.error(`[error] ${JSON.stringify({ source: "server", area: input.area, path: input.path, digest: input.digest })}`);
      return;
    }
    const { recordError } = await import("./lib/log");
    // Awaited, unlike logError(): Next requires onRequestError's async work to finish here.
    await recordError(input);
  } catch {
    // never let error reporting become a second error
  }
};

"use client";
import { useEffect, useState, type CSSProperties } from "react";

/** Long enough for a slow page to come back; short enough not to strand anyone. */
const GIVE_UP_MS = 10_000;

/**
 * "Try again" on the error pages (#48). Next's retry() re-fetches the page but
 * returns nothing to wait on, so the button goes off and says so on the first
 * click. It comes back when the page fails again (a new `error` arrives), or
 * after GIVE_UP_MS if nothing happened.
 *
 * Disabled is shown with an inline opacity: global-error.tsx renders without
 * the site's CSS.
 */
export function RetryButton({ retry, error, className, style }: {
  retry: () => void;
  error: Error;
  className?: string;
  style?: CSSProperties;
}) {
  const [trying, setTrying] = useState(false);
  const [prevError, setPrevError] = useState(error);
  if (error !== prevError) {
    setPrevError(error);
    setTrying(false);
  }

  useEffect(() => {
    if (!trying) return;
    const t = setTimeout(() => setTrying(false), GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [trying]);

  return (
    <button
      type="button"
      onClick={() => {
        setTrying(true);
        retry();
      }}
      disabled={trying}
      aria-busy={trying || undefined}
      className={className}
      style={trying ? { ...style, opacity: 0.5, cursor: "wait" } : style}
    >
      {trying ? "Trying again…" : "Try again"}
    </button>
  );
}

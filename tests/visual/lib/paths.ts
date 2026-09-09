/**
 * Shared directory constants.
 *
 * Their own module so accept.ts can use them without importing runner.ts — which
 * executes a run on import.
 */
import path from "node:path";

export const VISUAL_DIR = path.resolve(__dirname, "..");
/** Committed. Written ONLY by accept.ts. */
export const BASELINE_DIR = path.join(VISUAL_DIR, "baseline");
/** Gitignored run output. */
export const RUNS_DIR = path.join(VISUAL_DIR, ".runs");

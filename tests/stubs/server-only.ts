/**
 * `server-only` ships two entry points via an exports map: an empty module
 * under the `react-server` condition, and one that throws everywhere else.
 * Vitest resolves with Node conditions, so it gets the throwing one and every
 * suite that reaches lib/db/server.ts fails to import.
 *
 * Aliased in vitest.config.ts. The guard still does its real job — the check
 * that matters happens in `next build`, which does apply the condition.
 */
export {};

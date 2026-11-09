/**
 * When the Command Centre should warn that background jobs aren't running.
 *
 * The signal is the oldest pending/running job's due time. Some job is almost
 * always a little overdue, because publish_scheduled re-queues itself every
 * 60s but cron only calls /api/cron on a schedule. So "overdue" alone means
 * nothing; it only means trouble once a job has waited longer than a whole
 * cron interval plus some slack, i.e. at least one expected run never came.
 *
 * Keep the schedules in step with their sources; tests/unit/job-health.test.ts
 * fails if either file changes without this one.
 */
export const CRON_SCHEDULES = {
  /** vercel.json — Vercel Cron, Production deployments only. */
  production: { cron: "0 3 * * *", everyMinutes: 24 * 60, label: "daily", graceMinutes: 60 },
  /** .github/workflows/staging-cron.yml — GitHub Actions, which can start scheduled runs late. */
  preview: { cron: "7 * * * *", everyMinutes: 60, label: "hourly", graceMinutes: 60 },
} as const;

export type DeployEnv = keyof typeof CRON_SCHEDULES | "development";

/** Vercel sets VERCEL_ENV; anything else (pnpm dev, a local build) is development. */
export function deployEnv(vercelEnv = process.env.VERCEL_ENV): DeployEnv {
  return vercelEnv === "production" || vercelEnv === "preview" ? vercelEnv : "development";
}

export type CronStall = { overdueMinutes: number; scheduleLabel: string };

/**
 * A stall to report, or null when everything is within the normal wait.
 * Development never reports: the local job runner is optional, and due jobs
 * already run inline there (runDueJobInlineInDev), so an unrun sweep is expected.
 */
export function cronStall(oldestDueAt: string | null | undefined, now: number, env: DeployEnv): CronStall | null {
  if (env === "development" || !oldestDueAt) return null;
  const due = Date.parse(oldestDueAt);
  if (Number.isNaN(due)) return null;
  const { everyMinutes, graceMinutes, label } = CRON_SCHEDULES[env];
  const overdueMinutes = Math.floor((now - due) / 60_000);
  if (overdueMinutes <= everyMinutes + graceMinutes) return null;
  return { overdueMinutes, scheduleLabel: label };
}

/** "45 minutes", "3 hours", "2 days" — rounded down, which is what "over" promises. */
export function formatOverdue(minutes: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (minutes < 120) return plural(minutes, "minute");
  if (minutes < 48 * 60) return plural(Math.floor(minutes / 60), "hour");
  return plural(Math.floor(minutes / (24 * 60)), "day");
}

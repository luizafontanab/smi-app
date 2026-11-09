import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CRON_SCHEDULES, cronStall, deployEnv, formatOverdue } from "@/lib/job-health";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const dueMinutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe("cronStall", () => {
  it("never warns in development, however old the job", () => {
    expect(cronStall(dueMinutesAgo(10 * 24 * 60), NOW, "development")).toBeNull();
  });

  it("stays quiet with nothing queued or an unreadable date", () => {
    expect(cronStall(undefined, NOW, "preview")).toBeNull();
    expect(cronStall("not a date", NOW, "preview")).toBeNull();
  });

  it("on staging (hourly), a job waiting under an interval plus grace is normal", () => {
    // The screenshot case: 34 minutes overdue between two hourly ticks.
    expect(cronStall(dueMinutesAgo(34), NOW, "preview")).toBeNull();
    expect(cronStall(dueMinutesAgo(120), NOW, "preview")).toBeNull();
  });

  it("on staging, warns once a whole tick has been missed", () => {
    expect(cronStall(dueMinutesAgo(121), NOW, "preview")).toEqual({ overdueMinutes: 121, scheduleLabel: "hourly" });
  });

  it("in production (daily), waits a day plus grace before warning", () => {
    expect(cronStall(dueMinutesAgo(23 * 60), NOW, "production")).toBeNull();
    expect(cronStall(dueMinutesAgo(25 * 60), NOW, "production")).toBeNull();
    expect(cronStall(dueMinutesAgo(25 * 60 + 1), NOW, "production")).toEqual({ overdueMinutes: 25 * 60 + 1, scheduleLabel: "daily" });
  });
});

describe("deployEnv", () => {
  it("maps VERCEL_ENV, treating anything else as development", () => {
    expect(deployEnv("production")).toBe("production");
    expect(deployEnv("preview")).toBe("preview");
    expect(deployEnv("development")).toBe("development");
    expect(deployEnv(undefined)).toBe("development");
  });
});

describe("formatOverdue", () => {
  it("rounds down into the largest sensible unit", () => {
    expect(formatOverdue(1)).toBe("1 minute");
    expect(formatOverdue(119)).toBe("119 minutes");
    expect(formatOverdue(121)).toBe("2 hours");
    expect(formatOverdue(25 * 60 + 30)).toBe("25 hours");
    expect(formatOverdue(3 * 24 * 60 + 5)).toBe("3 days");
  });
});

describe("CRON_SCHEDULES matches the real schedules", () => {
  // If one of these fails, the cron schedule changed: update CRON_SCHEDULES
  // (cron, everyMinutes, label) so the warning threshold follows it.
  const root = join(__dirname, "..", "..");

  it("production follows vercel.json", () => {
    const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons.find((c) => c.path === "/api/cron")?.schedule).toBe(CRON_SCHEDULES.production.cron);
  });

  it("staging follows the staging-cron workflow", () => {
    const workflow = readFileSync(join(root, ".github/workflows/staging-cron.yml"), "utf8");
    const schedules = [...workflow.matchAll(/-\s*cron:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(schedules).toEqual([CRON_SCHEDULES.preview.cron]);
  });
});

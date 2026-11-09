import { runDueJobs } from "@/lib/jobs";
import { logError } from "@/lib/log";

/**
 * One tick runs up to 20 jobs in a row, and the story-source check alone can
 * take about a minute. A tick stopped part-way leaves its current job
 * 'running'; runDueJobs hands it back once it is STUCK_AFTER_MS old, which
 * must stay well above this.
 */
export const maxDuration = 300;

/**
 * Vercel Cron entrypoint (schedule in vercel.json); the local runner hits it too.
 *
 * Fails CLOSED. This used to be `if (secret && ...)`, which skipped the check
 * entirely when CRON_SECRET was unset — leaving a public GET that anyone could
 * use to drive job execution (publishing, newsletter sends, social pushes).
 * An unset secret is a misconfiguration, so it must lock the door, not open it.
 *
 * Vercel injects `Authorization: Bearer $CRON_SECRET` on its own cron requests
 * once the variable is set in the project; scripts/job-runner.ts reads the same
 * variable locally.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logError({ source: "server", area: "cron:unconfigured", error: new Error("CRON_SECRET is not set — refusing to run jobs.") });
    return Response.json({ error: "cron is not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runDueJobs();
  return Response.json(result);
}

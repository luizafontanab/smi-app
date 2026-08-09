import { runDueJobs } from "@/lib/jobs";

/** Vercel Cron entrypoint (every minute in prod); local runner hits it too. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runDueJobs();
  return Response.json(result);
}

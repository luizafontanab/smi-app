import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/route";

const { runDueJobs } = vi.hoisted(() => ({ runDueJobs: vi.fn(async () => ({ ran: 0, failed: 0 })) }));
vi.mock("@/lib/jobs", () => ({ runDueJobs }));

afterEach(() => {
  vi.unstubAllEnvs();
  runDueJobs.mockReset().mockResolvedValue({ ran: 0, failed: 0 });
});

describe("GET /api/cron", () => {
  it("refuses to run when CRON_SECRET isn't configured — fails closed, not open", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const res = await GET(new Request("https://smi.local/api/cron"));

    expect(res.status).toBe(503);
    expect(runDueJobs).not.toHaveBeenCalled();
  });

  it("rejects a request without the matching bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");

    const res = await GET(new Request("https://smi.local/api/cron", { headers: { authorization: "Bearer wrong" } }));

    expect(res.status).toBe(401);
    expect(runDueJobs).not.toHaveBeenCalled();
  });

  it("runs due jobs and reports the outcome for a correctly authorised request", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    runDueJobs.mockResolvedValue({ ran: 3, failed: 1 });

    const res = await GET(new Request("https://smi.local/api/cron", { headers: { authorization: "Bearer s3cret" } }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ran: 3, failed: 1 });
  });
});

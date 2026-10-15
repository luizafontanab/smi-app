import { NextResponse } from "next/server";
import { guard } from "../../../../store";

/** Fake Bigin `POST|PATCH /bigin/v2/actions/watch` — accepts any channel; it never actually notifies. */
async function watch(request: Request) {
  const denied = guard(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { watch?: Array<{ channel_id?: number; channel_expiry?: string }> };
  return NextResponse.json({
    watch: (body.watch ?? []).map((w) => ({
      code: "SUCCESS",
      details: { events: [], channel_id: w.channel_id, channel_expiry: w.channel_expiry },
      message: "Successfully subscribed for actions-watch of the given module",
      status: "success",
    })),
  });
}

export { watch as POST, watch as PATCH };

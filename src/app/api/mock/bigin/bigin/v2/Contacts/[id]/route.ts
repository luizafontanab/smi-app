import { NextResponse } from "next/server";
import { applyWrite, guard, org, success } from "../../../../store";

/** Fake Bigin `GET /bigin/v2/Contacts/{id}`. */
export async function GET(request: Request, ctx: RouteContext<"/api/mock/bigin/bigin/v2/Contacts/[id]">) {
  const denied = guard(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  const contact = org().contacts.get(id);
  if (!contact) return new NextResponse(null, { status: 204 });
  return NextResponse.json({ data: [contact] });
}

/** Fake Bigin `PUT /bigin/v2/Contacts/{id}` — update. */
export async function PUT(request: Request, ctx: RouteContext<"/api/mock/bigin/bigin/v2/Contacts/[id]">) {
  const denied = guard(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  const contact = org().contacts.get(id);
  if (!contact) {
    return NextResponse.json(
      { data: [{ code: "INVALID_DATA", details: { id }, message: "the related id given seems to be invalid", status: "error" }] },
      { status: 202 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as { data?: Record<string, unknown>[] };
  applyWrite(contact, body.data?.[0] ?? {});
  return NextResponse.json({ data: [success(id, "record updated")] });
}

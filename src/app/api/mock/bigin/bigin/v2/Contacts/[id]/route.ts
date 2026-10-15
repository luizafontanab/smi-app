import { NextResponse } from "next/server";
import { applyWrite, guard, invalidAccount, invalidRecordId, org, success, unknownAccount } from "../../../../store";

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
  // A deleted record, as real Bigin answers it (store.ts invalidRecordId). It
  // used to answer with the *lookup* wording as a 202, which no real record-id
  // failure looks like.
  if (!contact) return invalidRecordId(id);
  const body = (await request.json().catch(() => ({}))) as { data?: Record<string, unknown>[] };
  const data = body.data?.[0] ?? {};
  const gone = unknownAccount(data);
  if (gone) return NextResponse.json({ data: [invalidAccount(gone)] }, { status: 400 });
  applyWrite(contact, data);
  return NextResponse.json({ data: [success(id, "record updated")] });
}

/** Fake Bigin `DELETE /bigin/v2/Contacts/{id}` — the adapter only ever deletes a duplicate it just created. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/mock/bigin/bigin/v2/Contacts/[id]">) {
  const denied = guard(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!org().contacts.delete(id)) return invalidRecordId(id);
  return NextResponse.json({ data: [{ code: "SUCCESS", details: { id }, message: "record deleted", status: "success" }] });
}

import { redirect } from "next/navigation";
import { serviceDb } from "@/lib/db/server";
import { record, requestContext, type EventKind } from "@/lib/analytics";
import { SOCIAL_CHANNELS, socialLinks } from "@/lib/social";

/**
 * Member contact-link click-through (A5.6 / A5.10): website, phone, email
 * and per-platform social clicks off the member directory / profile, mirrored
 * on /visit/[id]'s pattern — the target is always looked up server-side from
 * the member's own row, never trusted from a client-supplied URL, so a
 * tampered `kind`/`platform` can only pick among that member's own already-
 * public contact info.
 */

const KIND_TO_EVENT: Record<string, EventKind> = {
  website: "outbound_click",
  phone: "phone_click",
  email: "email_click",
  social: "social_click",
};

export async function GET(req: Request, ctx: RouteContext<"/go/[memberId]">) {
  const { memberId } = await ctx.params;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "";
  const platform = url.searchParams.get("platform") ?? "";
  const eventKind = KIND_TO_EVENT[kind];
  if (!eventKind) redirect("/");

  const db = serviceDb();
  const { data: member } = await db
    .from("members")
    .select("id, slug, website, phone, contact_email, social")
    .eq("id", memberId)
    .maybeSingle();
  if (!member) redirect("/");

  const fallback = `/member/${member.slug}`;
  let target: string | null = null;
  let socialPlatform: string | null = null;

  if (kind === "website") {
    target = member.website;
  } else if (kind === "phone") {
    target = member.phone ? `tel:${member.phone}` : null;
  } else if (kind === "email") {
    target = member.contact_email ? `mailto:${member.contact_email}` : null;
  } else if (kind === "social") {
    if (SOCIAL_CHANNELS.some((c) => c.key === platform)) {
      const link = socialLinks(member.social).find((s) => s.key === platform);
      target = link?.href ?? null;
      socialPlatform = platform;
    }
  }

  const reqCtx = await requestContext();
  record([{ kind: eventKind, member_id: member.id, platform: socialPlatform, ...reqCtx }]);
  redirect(target || fallback);
}

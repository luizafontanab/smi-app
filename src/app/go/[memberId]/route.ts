import { redirect } from "next/navigation";
import { serviceDb } from "@/lib/db/server";
import { record, requestContext, type EventKind } from "@/lib/analytics";
import { isObviousBot } from "@/lib/bots";
import { SOCIAL_CHANNELS, socialLinks } from "@/lib/social";
import { websiteUrl } from "@/lib/website-url";

/**
 * Member contact-link click-through (A5.6 / A5.10): website, phone, email
 * and per-platform social clicks off the member directory / profile, mirrored
 * on /visit/[id]'s pattern — the target is always looked up server-side from
 * the member's own row, never trusted from a client-supplied URL, so a
 * tampered `kind`/`platform` can only pick among that member's own already-
 * public contact info.
 *
 * KNOWN GAP (not fixed here): `status` is still not checked, so a lapsed
 * member — whose /member page 404s and who is absent from the directory — can
 * still be redirected to, and still accrues click events, from any old link or
 * cached page. Archiving is filtered below; the status question is a product
 * decision (does a lapsed member keep their outbound clicks?) rather than a
 * bug to quietly settle inside a click tracker.
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

  // serviceDb, so RLS does not apply here — `public_read_active_members` hides
  // an archived member from every anon read, but this route would happily keep
  // forwarding their contact clicks. Filtered explicitly instead (fix list 72).
  const db = serviceDb();
  const { data: member } = await db
    .from("members")
    .select("id, slug, website, phone, contact_email, social, archived_at")
    .eq("id", memberId)
    .maybeSingle();
  // Home, not the member page: an archived member's page 404s for the public,
  // and no event is recorded for a link that should no longer exist.
  if (!member || member.archived_at) redirect("/");

  const fallback = `/member/${member.slug}`;
  let target: string | null = null;
  let socialPlatform: string | null = null;

  if (kind === "website") {
    // Normalised here as well as on save: rows saved before lib/website-url
    // hold "www.foo.co.uk", which as a redirect target is RELATIVE — the
    // reader went to /go/www.foo.co.uk and from there to the homepage. A value
    // that can't be made a link falls back to the member page below.
    target = websiteUrl(member.website);
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

  // A crawler following a story's company line still gets the redirect, but
  // is not a click on the member's stats (lib/bots; robots.ts disallows /go/
  // for the ones that listen).
  if (!isObviousBot(req.headers)) {
    const reqCtx = await requestContext();
    record([{ kind: eventKind, member_id: member.id, platform: socialPlatform, ...reqCtx }]);
  }
  redirect(target || fallback);
}

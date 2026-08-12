import { redirect } from "next/navigation";
import { serviceDb } from "@/lib/db/server";
import { record, requestContext } from "@/lib/analytics";
import { resolveAdvertTarget } from "@/lib/adverts";

/**
 * Advert click-through: record the click, then send the reader on.
 *
 * DO NOT rename this back to something like /out/, /click/ or /ads/. Those
 * fragments sit in EasyList, so a reader with an ad blocker never reaches the
 * advertiser — the click is silently dropped and we undercount what we sold.
 * Same reason the artwork lives under media/panels/ and not media/adverts/.
 * The advert itself stays honestly labelled (aria-label="Advert: …" in AdSlot);
 * this is only about generic filename heuristics eating first-party creative.
 */
export async function GET(_req: Request, ctx: RouteContext<"/visit/[id]">) {
  const { id } = await ctx.params;
  const db = serviceDb();
  const { data: ad } = await db
    .from("adverts")
    .select("id, link_url, advertiser:advertisers(member:members(id, slug))")
    .eq("id", id)
    .maybeSingle();
  if (!ad) redirect("/");
  const reqCtx = await requestContext();
  record([{ kind: "ad_click", advert_id: ad.id, member_id: ad.advertiser?.member?.id ?? null, ...reqCtx }]);
  redirect(resolveAdvertTarget(ad.link_url, ad.advertiser?.member?.slug ?? null));
}

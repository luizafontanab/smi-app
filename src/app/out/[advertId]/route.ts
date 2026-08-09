import { redirect } from "next/navigation";
import { serviceDb } from "@/lib/db/server";
import { record, requestContext } from "@/lib/analytics";
import { resolveAdvertTarget } from "@/lib/adverts";

/** Advert click-through: record the click, then send the reader on. */
export async function GET(_req: Request, ctx: RouteContext<"/out/[advertId]">) {
  const { advertId } = await ctx.params;
  const db = serviceDb();
  const { data: ad } = await db
    .from("adverts")
    .select("id, link_url, advertiser:advertisers(member:members(id, slug))")
    .eq("id", advertId)
    .maybeSingle();
  if (!ad) redirect("/");
  const reqCtx = await requestContext();
  record([{ kind: "ad_click", advert_id: ad.id, member_id: ad.advertiser?.member?.id ?? null, ...reqCtx }]);
  redirect(resolveAdvertTarget(ad.link_url, ad.advertiser?.member?.slug ?? null));
}

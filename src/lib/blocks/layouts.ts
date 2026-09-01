import { serviceDb } from "@/lib/db/server";
import { UUID_RE } from "@/lib/validate";
import { DEFAULT_LAYOUTS } from "./defaults";
import { validateLayout, type PageLayout, type PageType } from "./schema";

/**
 * Layout resolution: per-page override → page-type default row → code default.
 * Invalid stored rows (e.g. written before a schema change) fall through.
 */
export async function getLayout(pageType: PageType, entityId?: string): Promise<PageLayout> {
  // entity_id is a uuid column and entityId reaches here from ?entity= —
  // validate before it is interpolated into the .or() filter string, where a
  // crafted value could inject PostgREST filter syntax.
  if (entityId && !UUID_RE.test(entityId)) entityId = undefined;
  const db = serviceDb();
  let q = db.from("page_layouts").select("entity_id, layout").eq("page_type", pageType);
  q = entityId ? q.or(`entity_id.eq.${entityId},entity_id.is.null`) : q.is("entity_id", null);
  const { data } = await q;
  const override = entityId ? data?.find((r) => r.entity_id === entityId) : undefined;
  const fallback = data?.find((r) => r.entity_id === null);
  for (const row of [override, fallback]) {
    if (row && validateLayout(pageType, row.layout) === null) return row.layout as unknown as PageLayout;
  }
  return DEFAULT_LAYOUTS[pageType];
}

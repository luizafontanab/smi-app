"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import type { Json } from "@/lib/db/types";
import { logError } from "@/lib/log";
import {
  REACH_PLATFORMS, SOCIAL_REACH_HOMEPAGE_KEY, SOCIAL_REACH_MANUAL_KEY, homepageReachFromForm, manualFromForm, parseManual,
} from "@/lib/social-reach";

/*
 * /console/social-reach (issue #4). Kept out of console/actions.ts like the
 * story sources: self-contained, and nothing else calls into it. Every export
 * is async — this is a "use server" module.
 *
 * Only saveSocialReachHomepage and clearSocialReachHomepage change what the
 * public sees. The platform figures are guidance for the admin and nothing
 * reads them outside the console.
 */

const PAGE = "/console/social-reach";
const back = (params: Record<string, string>, anchor: string) => `${PAGE}?${new URLSearchParams(params)}#${anchor}`;
const SAVE_FAILED = "That couldn't be saved — please try again. If it keeps happening, it's in the error log.";

export async function saveSocialReachHomepage(formData: FormData) {
  await requireConsole();
  const parsed = homepageReachFromForm(formData, new Date());
  if ("errors" in parsed) {
    const errors = Object.fromEntries(Object.entries(parsed.errors).map(([k, v]) => [`e_${k}`, v]));
    redirect(back({ ...errors, value: String(formData.get("value") ?? ""), label: String(formData.get("label") ?? "") }, "homepage"));
  }
  const { error } = await serviceDb().from("settings").upsert({ key: SOCIAL_REACH_HOMEPAGE_KEY, value: parsed.value });
  if (error) {
    logError({ source: "db", area: "action:saveSocialReachHomepage", error: error.message });
    redirect(back({ error: SAVE_FAILED }, "homepage"));
  }
  revalidatePath("/");
  revalidatePath(PAGE);
  redirect(back({ saved: "homepage" }, "homepage"));
}

/** Takes the figure off the homepage: the stats band goes back to its two counted stats. */
export async function clearSocialReachHomepage() {
  await requireConsole();
  const { error } = await serviceDb().from("settings").delete().eq("key", SOCIAL_REACH_HOMEPAGE_KEY);
  if (error) {
    logError({ source: "db", area: "action:clearSocialReachHomepage", error: error.message });
    redirect(back({ error: SAVE_FAILED }, "homepage"));
  }
  revalidatePath("/");
  revalidatePath(PAGE);
  redirect(back({ saved: "cleared" }, "homepage"));
}

/**
 * The guidance table's hand-entered followers and views. Reads the stored
 * values first so an unchanged figure keeps its "entered on" date — and refuses
 * to write if that read fails, rather than resetting every date.
 */
export async function saveSocialReachPlatforms(formData: FormData) {
  await requireConsole();
  const db = serviceDb();
  const { data, error: readError } = await db.from("settings").select("value").eq("key", SOCIAL_REACH_MANUAL_KEY).maybeSingle();
  if (readError) {
    logError({ source: "db", area: "action:saveSocialReachPlatforms", error: readError.message });
    redirect(back({ error: SAVE_FAILED }, "platforms"));
  }
  const parsed = manualFromForm(formData, parseManual(data?.value), new Date());
  if ("errors" in parsed) {
    const params: Record<string, string> = {};
    for (const [field, message] of Object.entries(parsed.errors)) params[`pe_${field}`] = message;
    for (const p of REACH_PLATFORMS) {
      for (const f of ["followers", "views", "period"]) params[`pv_${p}.${f}`] = String(formData.get(`${p}.${f}`) ?? "");
    }
    redirect(back(params, "platforms"));
  }
  const { error } = await db.from("settings").upsert({ key: SOCIAL_REACH_MANUAL_KEY, value: parsed.value as unknown as Json });
  if (error) {
    logError({ source: "db", area: "action:saveSocialReachPlatforms", error: error.message });
    redirect(back({ error: SAVE_FAILED }, "platforms"));
  }
  revalidatePath(PAGE);
  redirect(back({ saved: "platforms" }, "platforms"));
}

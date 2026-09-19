import "server-only";

import { cache } from "react";
import { serviceDb } from "../db/server";
import type { EmailTemplateMap } from "./templates";

/**
 * The one place `email_templates` is read.
 *
 * It lives apart from `./templates.ts` so the renderer can stay synchronous and
 * pure: two member surfaces call `notificationLabel` from inside sync JSX, and
 * the exhaustiveness suite renders every kind with no database in sight. Callers
 * fetch here and pass the result in.
 *
 * Request-scoped via React `cache`, exactly like `currentUser` in `lib/auth.ts`
 * and `siteVariant` in `lib/variant.ts`: it dedupes within one render or one
 * request, and does NOT cache across requests. That matters twice over. The job
 * runner processes a whole batch inside a single `/api/cron` request, so a tick
 * that emails thirty members reads this table once rather than thirty times. And
 * because nothing is held between requests, an edit in the console takes effect
 * on the very next tick with no staleness window and nothing to invalidate.
 *
 * Outside a request — `runJob` called directly in a test — `cache` degrades to
 * no deduplication rather than throwing. Harmless, and noted so nobody "fixes"
 * it into a module-level map later.
 */
export const loadEmailTemplates = cache(async (): Promise<EmailTemplateMap> => {
  const { data, error } = await serviceDb()
    .from("email_templates")
    .select("kind, subject, label, body_html, body_text, cta_label");

  // Falling back to the shipped copy is the right failure here. An email that
  // goes out on the default wording is a far better outcome than one that
  // doesn't go out at all, and the send sites treat a throw as a hard failure
  // worth retrying and dead-lettering.
  if (error) {
    console.error("[email] could not read email_templates, using shipped copy:", error.message);
    return {};
  }

  const map: EmailTemplateMap = {};
  for (const row of data ?? []) {
    const { kind, ...fields } = row;
    map[kind] = fields;
  }
  return map;
});

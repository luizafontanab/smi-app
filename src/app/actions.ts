"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser, isAdmin } from "@/lib/auth";
import { serviceDb, sessionDb } from "@/lib/db/server";
import type { Json } from "@/lib/db/types";
import { devTaskFromForm, renderDevTaskNotes } from "@/lib/dev-tasks";
import { allowRequest, MINUTE } from "@/lib/rate-limit";

/**
 * The floating "Report a bug" widget renders on every route (see
 * DevTaskLauncher in the root layout), so its action lives at the root
 * segment rather than in console/actions.ts — every export there opens with
 * requireConsole() and pulls lib/media, lib/sanitize, lib/jobs, lib/contacts
 * into the graph of anything referencing it. It can't live in src/lib either,
 * which is the Next-free layer by convention.
 */

/**
 * Sign-out lives here for the same reason: the public header's account menu
 * renders on every route, and the dashboard and console layouts share it.
 */
export async function signOut() {
  const db = await sessionDb();
  await db.auth.signOut();
  redirect("/login");
}

export type DevTaskState = { message: string; ok?: boolean };

export async function submitDevTask(_prev: DevTaskState, formData: FormData): Promise<DevTaskState> {
  // Re-checked here, never inferred: a server action is a POST endpoint, and
  // the widget only rendering for admins proves nothing about the caller.
  const user = await currentUser();
  if (!user || !isAdmin(user)) return { message: "You are not signed in as an admin." };
  if (!(await allowRequest(`dev-task:${user.userId}`, 30, MINUTE))) {
    return { message: "Too many reports just now — please try again shortly." };
  }

  const parsed = devTaskFromForm(formData);
  if ("error" in parsed) return { message: parsed.error };
  const { values, context } = parsed;

  // Server-known truth overwrites anything the client sent.
  const stamped = { ...context, reporter: { user_id: user.userId, email: user.email, role: user.role } };

  const db = serviceDb();
  // append to the end of Not started, same as createDevTask does for its column
  const { data: last } = await db
    .from("dev_tasks")
    .select("sort_order")
    .eq("status", "not_started")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await db.from("dev_tasks").insert({
    ...values, // title, description, kind, priority
    notes: renderDevTaskNotes(stamped),
    triage_notes: "",
    context: stamped as unknown as Json,
    page_path: context.page?.pathname || null,
    created_by: user.userId,
    reporter_email: user.email,
    // Jas files it, Luiza builds it — one developer today, so an unassigned
    // bug report in a five-name dropdown resolves no real ambiguity. This is
    // an explicit application-layer choice, not a column default, so it's
    // easy to revisit if the team grows.
    assignee: "Luiza",
    sort_order: (last?.sort_order ?? -1) + 1,
    // status comes from the column default (not_started) — do not write it
  });
  if (error) return { message: `Could not save that — ${error.message}` };

  revalidatePath("/console/dev");
  return { ok: true, message: "Logged — it'll show up on the Dev Board." };
}

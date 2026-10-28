import "server-only";
import { cache } from "react";
import { serviceDb } from "./db/server";

/**
 * Feature flags an admin switches on /console/features, with no redeploy.
 *
 * Each flag is its own `settings` row — key `feature:<name>`, value a jsonb
 * boolean — so saving one can never clobber another. A flag with no row, or a
 * row that isn't a boolean, gets its `default` here.
 *
 * To add a flag: add an entry below, gate the feature on isFeatureEnabled(),
 * and seed a value in scripts/seed.ts. The console page lists it automatically.
 */
export const FEATURE_FLAGS = {
  member_leads: {
    label: "Member Leads page",
    description:
      "The Leads page in the member area — prospects relevant to each member's business. Off hides it from the member nav and sends anyone opening the address straight to their dashboard. Your own Lead Gen tool in the console is unaffected.",
    default: false,
  },
  story_crawler: {
    label: "Story crawler",
    description:
      "Checks every story source once a day — the imported spreadsheet list plus each Bigin company's News Page URL — and lists new articles as suggestions on Story sources. Off stops all checks and the Bigin sync; existing sources and suggestions are kept, and stories can still be written by hand.",
    default: false,
  },
} as const satisfies Record<string, { label: string; description: string; default: boolean }>;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export const FEATURE_FLAG_NAMES = Object.keys(FEATURE_FLAGS) as FeatureFlag[];

export function isFeatureFlag(value: unknown): value is FeatureFlag {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, value);
}

/** The `settings` key a flag is stored under. */
export function featureFlagKey(flag: FeatureFlag): string {
  return `feature:${flag}`;
}

function defaults(): Record<FeatureFlag, boolean> {
  return Object.fromEntries(FEATURE_FLAG_NAMES.map((f) => [f, FEATURE_FLAGS[f].default])) as Record<FeatureFlag, boolean>;
}

/**
 * Every flag's current state, in one read. Request-scoped via cache(): the
 * dashboard layout and the page it wraps share the read, and a console change
 * applies to the very next request.
 *
 * serviceDb because `settings` has RLS with no policies. A failed read gives
 * every flag its default — for a feature that ships off, a settings hiccup
 * hides it rather than exposing it.
 */
export const featureFlags = cache(async (): Promise<Record<FeatureFlag, boolean>> => {
  const state = defaults();
  try {
    const { data, error } = await serviceDb()
      .from("settings")
      .select("key, value")
      .in("key", FEATURE_FLAG_NAMES.map(featureFlagKey));
    if (error) return state;
    for (const row of data ?? []) {
      const flag = row.key.startsWith("feature:") ? row.key.slice("feature:".length) : null;
      if (isFeatureFlag(flag) && typeof row.value === "boolean") state[flag] = row.value;
    }
  } catch {
    // fall through with defaults
  }
  return state;
});

export async function isFeatureEnabled(flag: FeatureFlag): Promise<boolean> {
  return (await featureFlags())[flag];
}

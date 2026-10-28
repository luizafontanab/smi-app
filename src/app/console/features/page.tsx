import { requireConsole } from "@/lib/auth";
import { FEATURE_FLAG_NAMES, FEATURE_FLAGS, featureFlags, isFeatureFlag } from "@/lib/feature-flags";
import { SubmitButton } from "@/components/SubmitButton";
import { saveFeatureFlag } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Features" };

/**
 * Feature flags: switch parts of the site on or off with no redeploy. Every
 * flag in lib/feature-flags.ts shows here; a change applies to the next page
 * anyone loads.
 */
export default async function FeaturesPage(props: PageProps<"/console/features">) {
  await requireConsole();
  const sp = await props.searchParams;
  const state = await featureFlags();
  const saved = isFeatureFlag(sp.saved) ? sp.saved : null;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold text-ink">Features</h1>
      <p className="mt-1 text-sm text-graphite">
        Switch parts of the site on or off. Changes apply to the next page anyone loads — no redeploy.
      </p>

      {saved && (
        <p role="status" className="mt-3 rounded bg-success/10 p-2 text-sm text-success">
          {FEATURE_FLAGS[saved].label} is now {state[saved] ? "on" : "off"}.
        </p>
      )}
      {typeof sp.error === "string" && <p role="alert" className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <ul className="mt-4 space-y-3">
        {FEATURE_FLAG_NAMES.map((flag) => {
          const on = state[flag];
          const { label, description } = FEATURE_FLAGS[flag];
          return (
            <li key={flag} className="rounded-xl bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="font-bold text-ink">
                    {label}{" "}
                    <span className={`ml-1 rounded px-2 py-0.5 text-xs font-semibold ${on ? "bg-success/10 text-success" : "bg-graphite/10 text-graphite"}`}>
                      {on ? "On" : "Off"}
                    </span>
                  </h2>
                  <p className="mt-1 text-sm text-graphite">{description}</p>
                </div>
                <form action={saveFeatureFlag}>
                  <input type="hidden" name="flag" value={flag} />
                  <input type="hidden" name="state" value={on ? "off" : "on"} />
                  <SubmitButton
                    pendingLabel="Saving…"
                    className="rounded bg-ink px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {on ? "Turn off" : "Turn on"}
                    <span className="sr-only"> {label}</span>
                  </SubmitButton>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

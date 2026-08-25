"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Switches between the two site designs. Persists via the smi-theme cookie,
// which the root layout reads to stamp data-theme on <html> during SSR. The two
// designs differ structurally, not just in colour, so router.refresh() below is
// what actually swaps the composition — it is not a nicety.
//
// This list is duplicated in lib/variant.ts, which is server-only and so cannot
// be imported here. Two string literals; keep them in step.
const THEMES = [
  { value: "forge", label: "Forge" },
  { value: "grid", label: "Grid" },
] as const;

type Theme = (typeof THEMES)[number]["value"];

function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "grid" ? "grid" : "forge";
}

function applyTheme(value: Theme) {
  // Set unconditionally, forge included — the server stamps both, so removing
  // the attribute here would disagree with the next SSR pass.
  document.documentElement.setAttribute("data-theme", value);
  document.cookie = `smi-theme=${value}; path=/; max-age=2592000`;
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setTheme(currentTheme()), 0);
    return () => clearTimeout(t);
  }, []);

  function apply(value: Theme) {
    applyTheme(value);
    setTheme(value);
    router.refresh();
  }

  const buttons = (
    <div className={`flex overflow-hidden rounded border border-white/20 text-xs ${compact ? "" : "mt-1.5"}`}>
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => apply(t.value)}
          className={`flex-1 whitespace-nowrap ${compact ? "px-2 py-1" : "px-1 py-1.5"} ${
            theme === t.value
              ? "bg-brand font-semibold text-ink"
              : "text-white/70 hover:bg-chrome-hover"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (compact) return buttons;

  return (
    <div className="px-4 py-2.5">
      <p className="text-xs text-white/60">Theme</p>
      {buttons}
    </div>
  );
}

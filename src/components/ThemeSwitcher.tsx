"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Temporary demo feature: swaps the CSS-variable theme (see globals.css) across
// public, member and console areas. Persists via the smi-theme cookie, which the
// root layout reads to stamp data-theme on <html> during SSR — and which the
// console layout reads to pick its shell (demo = top bar, others = sidebar),
// hence the router.refresh() below.
const THEMES = [
  { value: "forge", label: "Forge" },
  { value: "live", label: "Live" },
  { value: "demo", label: "Demo v1" },
] as const;

type Theme = (typeof THEMES)[number]["value"];

function currentTheme(): Theme {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "live" || t === "demo" ? t : "forge";
}

function applyTheme(value: Theme) {
  if (value === "forge") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", value);
  }
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
              ? "bg-amber font-semibold text-navy"
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

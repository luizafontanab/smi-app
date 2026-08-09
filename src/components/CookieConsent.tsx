"use client";
import { useEffect, useState } from "react";

export function CookieConsent() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(!document.cookie.includes("smi-consent="));
  }, []);
  if (!show) return null;
  const choose = (v: "all" | "essential") => {
    document.cookie = `smi-consent=${v}; path=/; max-age=${60 * 60 * 24 * 365}`;
    setShow(false);
  };
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-white p-4 shadow-lg">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-sm">
        <p>We use cookies for anonymous readership stats that help our members see who&apos;s engaging.</p>
        <div className="flex gap-2">
          <button onClick={() => choose("essential")} className="rounded border px-3 py-1.5">Essential only</button>
          <button onClick={() => choose("all")} className="rounded bg-navy px-3 py-1.5 text-white">Accept</button>
        </div>
      </div>
    </div>
  );
}

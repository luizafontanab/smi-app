"use client";

import { useMemo, useState } from "react";
import { contrastRatio, meetsWcagAA } from "@/lib/contrast";

const PAPER = "#ffffff";

/**
 * Live contrast preview as the admin types — the server re-checks on submit
 * (the authority), this just stops a doomed submission before it happens.
 */
export function TakeoverColorPicker({ initial = "#ff8200" }: { initial?: string }) {
  const [hex, setHex] = useState(initial);
  const valid = /^#[0-9a-f]{6}$/i.test(hex);
  const ratio = useMemo(() => (valid ? contrastRatio(hex, PAPER) : null), [hex, valid]);
  const passes = valid && meetsWcagAA(hex, PAPER, { largeText: true });

  return (
    <div>
      <label htmlFor="hex" className="text-sm font-medium">Brand colour (hex)</label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id="hex" name="hex" value={hex} onChange={(e) => setHex(e.target.value)}
          placeholder="#ff8200" pattern="#[0-9a-fA-F]{6}" required
          className="w-36 rounded border px-3 py-2 font-mono text-sm"
        />
        <span className="h-8 w-8 rounded border" style={valid ? { background: hex } : undefined} aria-hidden />
        {ratio !== null && (
          <span className={`text-xs ${passes ? "text-success" : "text-danger"}`}>
            {ratio.toFixed(1)}:1 against white — {passes ? "passes WCAG AA (large text/UI)" : "fails, needs 3:1"}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-graphite">Checked against the site&apos;s white background — the same pairing globals.css documents for the brand colour.</p>
    </div>
  );
}

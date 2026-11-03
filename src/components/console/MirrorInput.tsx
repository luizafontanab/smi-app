"use client";
import { useEffect, useState } from "react";

/**
 * A hidden input that carries another form's field, so a second form on the
 * page submits what the first one shows. The editors' Approve / Schedule forms
 * use it for the Industry box, which lives in the Save form: approving sends
 * the industry Jas can see, saved or not.
 *
 * `defaultValue` is what the source field rendered with, so the form still
 * sends that without JavaScript; after hydration it follows every change.
 */
export function MirrorInput({ source, name, defaultValue }: { source: string; name: string; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    const el = document.getElementById(source);
    if (!(el instanceof HTMLSelectElement || el instanceof HTMLInputElement)) return;
    const sync = () => setValue(el.value);
    sync();
    el.addEventListener("change", sync);
    el.addEventListener("input", sync);
    return () => {
      el.removeEventListener("change", sync);
      el.removeEventListener("input", sync);
    };
  }, [source]);

  return <input type="hidden" name={name} value={value} />;
}

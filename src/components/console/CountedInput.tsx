"use client";

import { useId, useState } from "react";
import { countWords } from "@/lib/newsletter-layout";

/**
 * A text field with a live count against a soft range: outside it the count
 * turns red and says why, but it never blocks the save. Counts characters
 * (the newsletter subject and preview text) or words (the story summary and a
 * sponsored story's text, per Jas's SOP) — gap review area 5.
 */
export function CountedInput({
  name,
  label,
  softMax,
  softMin,
  unit = "characters",
  multiline = false,
  rows = 3,
  defaultValue,
  hint,
  required = false,
  placeholder,
  overMessage = "may be cut off in the inbox",
  labelClassName = "text-xs font-medium",
  id: fixedId,
}: {
  name: string;
  label: React.ReactNode;
  softMax: number;
  softMin?: number;
  unit?: "characters" | "words";
  multiline?: boolean;
  rows?: number;
  defaultValue: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  overMessage?: string;
  labelClassName?: string;
  /** A stable id, where something links to the field; otherwise one is generated. */
  id?: string;
}) {
  const measure = (value: string) => (unit === "words" ? countWords(value) : value.length);
  const [count, setCount] = useState(measure(defaultValue));
  const generatedId = useId();
  const id = fixedId ?? generatedId;
  const over = count > softMax;
  // An empty field isn't "too short": it may be optional, and has its own fallback.
  const under = softMin !== undefined && count > 0 && count < softMin;
  const target = softMin !== undefined ? `${softMin}–${softMax} ${unit}` : `${softMax}`;
  const status = over ? ` — ${overMessage}` : under ? ` — aim for ${target}` : "";
  const field = {
    id,
    name,
    defaultValue,
    required,
    placeholder,
    "aria-describedby": `${id}-count${hint ? ` ${id}-hint` : ""}`,
    className: "mt-1 w-full rounded border px-3 py-2",
  };
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className={labelClassName}>{label}</label>
        <span id={`${id}-count`} className={`text-xs ${over || under ? "text-danger" : "text-graphite"}`} aria-live="polite">
          {unit === "words" ? `${count} ${count === 1 ? "word" : "words"}` : `${count}/${softMax}`}{status}
        </span>
      </div>
      {multiline ? (
        <textarea {...field} rows={rows} onChange={(e) => setCount(measure(e.target.value))} />
      ) : (
        <input {...field} onChange={(e) => setCount(measure(e.target.value))} />
      )}
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-graphite">{hint}</p>}
    </div>
  );
}

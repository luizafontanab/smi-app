"use client";

import { useId, useState } from "react";

/**
 * A text input with a live character count against a soft limit: going over
 * turns the count red and says so, but never blocks the save. Used for the
 * newsletter subject and preview text (gap review area 5).
 */
export function CountedInput({
  name,
  label,
  softMax,
  defaultValue,
  hint,
  required = false,
  placeholder,
}: {
  name: string;
  label: string;
  softMax: number;
  defaultValue: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const [length, setLength] = useState(defaultValue.length);
  const id = useId();
  const over = length > softMax;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-xs font-medium">{label}</label>
        <span id={`${id}-count`} className={`text-xs ${over ? "text-danger" : "text-graphite"}`} aria-live="polite">
          {length}/{softMax}{over ? " — may be cut off in the inbox" : ""}
        </span>
      </div>
      <input
        id={id}
        name={name}
        defaultValue={defaultValue}
        required={required}
        placeholder={placeholder}
        onChange={(e) => setLength(e.target.value.length)}
        aria-describedby={`${id}-count${hint ? ` ${id}-hint` : ""}`}
        className="mt-1 w-full rounded border px-3 py-2"
      />
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-graphite">{hint}</p>}
    </div>
  );
}

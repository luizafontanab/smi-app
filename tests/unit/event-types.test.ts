import { describe, expect, it } from "vitest";
import { EVENT_TYPE_LABELS, EVENT_TYPES, isEventType } from "@/lib/event-types";

describe("isEventType", () => {
  it("accepts every known type", () => {
    for (const type of EVENT_TYPES) expect(isEventType(type)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isEventType("webinars")).toBe(false);
    expect(isEventType("")).toBe(false);
  });
});

describe("EVENT_TYPE_LABELS", () => {
  it("has exactly one label per event type", () => {
    expect(Object.keys(EVENT_TYPE_LABELS).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it("gives every type a non-empty, human-readable label", () => {
    for (const type of EVENT_TYPES) {
      expect(EVENT_TYPE_LABELS[type].length).toBeGreaterThan(0);
    }
  });
});

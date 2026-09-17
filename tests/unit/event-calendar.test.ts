import { describe, expect, it } from "vitest";
import { bucketEventsByDay } from "@/lib/event-calendar";

const ev = (slug: string, starts_on: string, starts_time: string | null = null) => ({ slug, starts_on, starts_time });

describe("bucketEventsByDay", () => {
  it("returns an empty map for no events", () => {
    expect(bucketEventsByDay([]).size).toBe(0);
  });

  it("buckets events under their starts_on date string", () => {
    const byDay = bucketEventsByDay([ev("a", "2026-09-17"), ev("b", "2026-10-20"), ev("c", "2026-09-17")]);
    expect([...byDay.keys()].sort()).toEqual(["2026-09-17", "2026-10-20"]);
    expect(byDay.get("2026-09-17")!.map((e) => e.slug).sort()).toEqual(["a", "c"]);
    expect(byDay.get("2026-10-20")!.map((e) => e.slug)).toEqual(["b"]);
  });

  it("sorts a day's events by start time, untimed first", () => {
    const byDay = bucketEventsByDay([
      ev("late", "2026-09-17", "14:00:00"),
      ev("untimed", "2026-09-17", null),
      ev("early", "2026-09-17", "09:30:00"),
    ]);
    expect(byDay.get("2026-09-17")!.map((e) => e.slug)).toEqual(["untimed", "early", "late"]);
  });

  it("keys a multi-day event by its start day only", () => {
    const multi = { slug: "expo", starts_on: "2026-10-20", starts_time: null, ends_on: "2026-10-23" };
    const byDay = bucketEventsByDay([multi]);
    expect([...byDay.keys()]).toEqual(["2026-10-20"]);
  });
});

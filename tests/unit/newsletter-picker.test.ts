import { describe, expect, it } from "vitest";
import { pickerOptions } from "@/lib/newsletter-picker";

const item = (id: string, status = "published") => ({ id, title: `Item ${id}`, published_at: "2026-09-01T09:00:00Z", status });

describe("pickerOptions", () => {
  it("keeps a picked item that is older than the recent window, ticked", () => {
    const options = pickerOptions([item("old")], [item("r1"), item("r2")]);
    expect(options.map((o) => [o.id, o.picked])).toEqual([["old", true], ["r1", false], ["r2", false]]);
  });

  it("lists a picked item once when it is also recent, and keeps the issue's order", () => {
    const options = pickerOptions([item("r2"), item("r1")], [item("r1"), item("r2"), item("r3")]);
    expect(options.map((o) => [o.id, o.picked])).toEqual([["r2", true], ["r1", true], ["r3", false]]);
  });

  it("keeps a picked item that is no longer live, so it can be seen and unticked", () => {
    const options = pickerOptions([item("gone", "withdrawn")], []);
    expect(options).toEqual([{ ...item("gone", "withdrawn"), picked: true }]);
  });
});

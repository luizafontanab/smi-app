import { describe, expect, it } from "vitest";
import {
  applyMove,
  devTaskFromForm,
  devTaskValuesFromForm,
  filterDevTasks,
  parseDevFilters,
  renderDevTaskNotes,
  type DevTask,
} from "@/lib/dev-tasks";

/** A form with every required field filled, so each test varies one thing. */
function form(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = { title: "Fix the thing", description: "It is broken." };
  for (const [k, v] of Object.entries({ ...base, ...overrides })) fd.set(k, v);
  return fd;
}

function captureForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    title: "Something is broken",
    description: "Steps to reproduce…",
    kind: "bug",
    priority: "high",
    context: JSON.stringify({
      page: { pathname: "/member/acme", url: "https://smi.local/member/acme", title: "Acme | SMI", referrer: "https://smi.local/member" },
      env: { user_agent: "Mozilla/5.0", viewport: "1440x900", screen: "2560x1440", dpr: 2, theme: "forge", language: "en-GB", timezone: "Europe/London" },
      errors: [],
      captured_at: "2026-08-25T10:01:04.552Z",
    }),
  };
  for (const [k, v] of Object.entries({ ...base, ...overrides })) fd.set(k, v);
  return fd;
}

function task(overrides: Partial<DevTask> = {}): DevTask {
  return {
    id: "t1",
    title: "Fix the thing",
    description: "It is broken.",
    notes: "",
    triage_notes: "",
    context: {},
    kind: null,
    status: "not_started",
    assignee: null,
    priority: "medium",
    sort_order: 0,
    page_path: null,
    created_by: null,
    reporter_email: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseDevFilters", () => {
  it("defaults to an empty board view with nothing closed", () => {
    expect(parseDevFilters({})).toEqual({ view: "board", q: "", statuses: [], assignees: [], showClosed: false });
  });

  it("accepts a single value or an array for repeated checkbox params", () => {
    expect(parseDevFilters({ status: "done" }).statuses).toEqual(["done"]);
    expect(parseDevFilters({ status: ["done", "blocked"] }).statuses).toEqual(["done", "blocked"]);
    expect(parseDevFilters({ assignee: ["Luiza", "Jas"] }).assignees).toEqual(["Luiza", "Jas"]);
  });

  it("drops unknown status/assignee values rather than trusting the URL", () => {
    expect(parseDevFilters({ status: ["done", "bogus"] }).statuses).toEqual(["done"]);
    expect(parseDevFilters({ assignee: ["Luiza", "Nobody"] }).assignees).toEqual(["Luiza"]);
  });

  it("keeps the unassigned sentinel", () => {
    expect(parseDevFilters({ assignee: "unassigned" }).assignees).toEqual(["unassigned"]);
  });

  it("reads the list view and the closed toggle", () => {
    expect(parseDevFilters({ view: "list", show: "all" })).toMatchObject({ view: "list", showClosed: true });
  });
});

describe("filterDevTasks", () => {
  const tasks = [
    task({ id: "a", title: "Broken login button", description: "nothing", status: "not_started", assignee: "Jas" }),
    task({ id: "b", title: "Improve copy", description: "the login page reads oddly", status: "in_progress", assignee: "Luiza" }),
    task({ id: "c", title: "Old task", description: "n/a", status: "done", assignee: null }),
    task({ id: "d", title: "Cancelled work", description: "n/a", status: "canceled", assignee: "Rishi" }),
    task({ id: "e", title: "Has a login stack trace", description: "n/a", status: "not_started", triage_notes: "login failed here", notes: "login diagnostics" }),
  ];

  it("matches title and description case-insensitively", () => {
    const result = filterDevTasks(tasks, { view: "board", q: "LOGIN", statuses: [], assignees: [], showClosed: true });
    expect(result.map((t) => t.id).sort()).toEqual(["a", "b", "e"]);
  });

  it("does not match notes or triage_notes", () => {
    const result = filterDevTasks(tasks, { view: "board", q: "diagnostics", statuses: [], assignees: [], showClosed: true });
    expect(result).toEqual([]);
  });

  it("hides done and canceled unless showClosed", () => {
    const hidden = filterDevTasks(tasks, { view: "board", q: "", statuses: [], assignees: [], showClosed: false });
    expect(hidden.map((t) => t.id)).not.toContain("c");
    expect(hidden.map((t) => t.id)).not.toContain("d");

    const shown = filterDevTasks(tasks, { view: "board", q: "", statuses: [], assignees: [], showClosed: true });
    expect(shown.map((t) => t.id)).toEqual(expect.arrayContaining(["c", "d"]));
  });

  it("combines status and assignee filters as AND across dimensions", () => {
    const result = filterDevTasks(tasks, { view: "board", q: "", statuses: ["not_started"], assignees: ["Jas"], showClosed: true });
    expect(result.map((t) => t.id)).toEqual(["a"]);
  });

  it("treats multiple selected statuses/assignees as OR within one dimension", () => {
    const result = filterDevTasks(tasks, { view: "board", q: "", statuses: ["not_started", "in_progress"], assignees: [], showClosed: true });
    expect(result.map((t) => t.id).sort()).toEqual(["a", "b", "e"]);
  });

  it("resolves the unassigned sentinel", () => {
    const result = filterDevTasks(tasks, { view: "board", q: "", statuses: ["done"], assignees: ["unassigned"], showClosed: true });
    expect(result.map((t) => t.id)).toEqual(["c"]);
  });
});

describe("applyMove", () => {
  const col = (status: DevTask["status"], ids: string[]) => ids.map((id, i) => task({ id, status, sort_order: i }));

  it("reorders within the same column, inserting before the target card", () => {
    const tasks = col("in_progress", ["a", "b", "c"]);
    const { orderedIds } = applyMove(tasks, "a", "in_progress", "c");
    expect(orderedIds).toEqual(["b", "a", "c"]);
  });

  it("moves a card across columns, inserting before the target card", () => {
    const tasks = [...col("not_started", ["a"]), ...col("in_progress", ["b", "c"])];
    const { tasks: next, orderedIds } = applyMove(tasks, "a", "in_progress", "c");
    expect(orderedIds).toEqual(["b", "a", "c"]);
    expect(next.find((t) => t.id === "a")!.status).toBe("in_progress");
  });

  it("drops onto an empty column", () => {
    const tasks = col("not_started", ["a", "b"]);
    const { orderedIds } = applyMove(tasks, "a", "blocked", null);
    expect(orderedIds).toEqual(["a"]);
  });

  it("produces dense, duplicate-free ids in the destination column", () => {
    const tasks = [...col("not_started", ["a", "b"]), ...col("in_progress", ["c", "d", "e"])];
    const { orderedIds } = applyMove(tasks, "b", "in_progress", "d");
    expect(new Set(orderedIds).size).toBe(orderedIds.length);
    expect(orderedIds).toEqual(["c", "b", "d", "e"]);
  });
});

describe("devTaskValuesFromForm", () => {
  it("rejects a blank title", () => {
    expect(devTaskValuesFromForm(form({ title: "  " }))).toEqual({ error: "Give it a one-line title." });
  });

  it("rejects out-of-range enum values by falling back", () => {
    const result = devTaskValuesFromForm(form({ status: "bogus", priority: "bogus" }));
    if ("error" in result) throw new Error("expected values");
    expect(result.values.status).toBe("not_started");
    expect(result.values.priority).toBe("medium");
  });

  it("maps an empty assignee or kind to null, not a fallback value", () => {
    const result = devTaskValuesFromForm(form({ assignee: "", kind: "" }));
    if ("error" in result) throw new Error("expected values");
    expect(result.values.assignee).toBeNull();
    expect(result.values.kind).toBeNull();
  });

  it("caps triage_notes at 5000 chars", () => {
    const result = devTaskValuesFromForm(form({ triage_notes: "x".repeat(6000) }));
    if ("error" in result) throw new Error("expected values");
    expect(result.values.triage_notes!.length).toBe(5000);
  });

  it("never emits server-owned columns", () => {
    const result = devTaskValuesFromForm(form());
    if ("error" in result) throw new Error("expected values");
    for (const key of ["id", "created_at", "updated_at", "created_by", "reporter_email", "sort_order", "notes", "context", "page_path"]) {
      expect(Object.keys(result.values)).not.toContain(key);
    }
  });
});

describe("devTaskFromForm", () => {
  it("rejects a blank title", () => {
    expect(devTaskFromForm(captureForm({ title: "   " }))).toEqual({ error: "Give it a one-line title." });
  });

  it("truncates an overlong title and description", () => {
    const result = devTaskFromForm(captureForm({ title: "x".repeat(5000), description: "y".repeat(20000) }));
    if ("error" in result) throw new Error("expected values");
    expect(result.values.title.length).toBe(200);
    expect(result.values.description.length).toBe(5000);
  });

  it("falls back unknown kind/priority to bug/medium, and round-trips valid values", () => {
    const bad = devTaskFromForm(captureForm({ kind: "nonsense", priority: "urgent" }));
    if ("error" in bad) throw new Error("expected values");
    expect(bad.values.kind).toBe("bug");
    expect(bad.values.priority).toBe("medium");

    const good = devTaskFromForm(captureForm({ kind: "idea", priority: "low" }));
    if ("error" in good) throw new Error("expected values");
    expect(good.values.kind).toBe("idea");
    expect(good.values.priority).toBe("low");
  });

  it("drops malformed context JSON to {} rather than failing the report", () => {
    const result = devTaskFromForm(captureForm({ context: "{not json" }));
    if ("error" in result) throw new Error("expected values");
    expect(result.context.page.pathname).toBe("");
    expect(result.context.errors).toEqual([]);
  });

  it("rejects a context payload over 32KB", () => {
    const huge = JSON.stringify({ page: {}, env: {}, errors: [], captured_at: "", pad: "x".repeat(40_000) });
    expect(devTaskFromForm(captureForm({ context: huge }))).toEqual({
      error: "That page's diagnostics were too large to attach — try again.",
    });
  });

  it("caps errors to 5 entries and clips message/stack", () => {
    const errors = Array.from({ length: 8 }, (_, i) => ({
      at: "2026-08-25T10:00:00.000Z", kind: "error", message: "m".repeat(600), stack: "s".repeat(1500), count: i,
    }));
    const result = devTaskFromForm(captureForm({ context: JSON.stringify({ page: {}, env: {}, errors, captured_at: "" }) }));
    if ("error" in result) throw new Error("expected values");
    expect(result.context.errors.length).toBe(5);
    expect(result.context.errors[0].message.length).toBe(500);
    expect(result.context.errors[0].stack!.length).toBe(1000);
  });
});

describe("renderDevTaskNotes", () => {
  it("includes pathname, URL, viewport and theme", () => {
    const rendered = devTaskFromForm(captureForm());
    if ("error" in rendered) throw new Error("expected values");
    const text = renderDevTaskNotes(rendered.context);
    expect(text).toContain("/member/acme");
    expect(text).toContain("https://smi.local/member/acme");
    expect(text).toContain("1440x900");
    expect(text).toContain("forge");
  });

  it("prints a none-found line when there are no errors", () => {
    expect(renderDevTaskNotes({ page: {}, env: {}, errors: [], captured_at: "" })).toContain("Recent client errors: none.");
  });

  it("shows a dedup count for a repeated error", () => {
    const text = renderDevTaskNotes({ page: {}, env: {}, errors: [{ at: "t", kind: "error", message: "boom", count: 2 }], captured_at: "" });
    expect(text).toContain("x2");
  });

  it("never throws on {} or a non-array errors field", () => {
    expect(() => renderDevTaskNotes({})).not.toThrow();
    expect(() => renderDevTaskNotes({ errors: "not-an-array" })).not.toThrow();
    expect(() => renderDevTaskNotes(null)).not.toThrow();
  });
});

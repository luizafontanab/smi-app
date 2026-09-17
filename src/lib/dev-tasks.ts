import type { Database, Json } from "@/lib/db/types";

/**
 * Dev Board + "Report a bug" widget: shared, pure logic.
 *
 * Kept free of Next and Supabase imports so it unit-tests with a bare
 * FormData — every server action around it ends in redirect(), which throws
 * NEXT_REDIRECT and cannot be exercised from vitest.
 *
 * One table serves two origins. A row created via the floating widget
 * (kind set, notes/context populated, page_path/reporter_email present) is
 * worked on the same board as a row a teammate quick-adds directly — the
 * `kind` badge is the only thing that visually tells them apart.
 */

export const DEV_STATUSES = ["not_started", "coding", "testing", "in_staging", "done", "canceled"] as const;
export type DevStatus = (typeof DEV_STATUSES)[number];

export const DEV_STATUS_LABELS: Record<DevStatus, string> = {
  not_started: "Not started",
  coding: "Coding",
  testing: "Testing",
  in_staging: "In staging",
  done: "Done",
  canceled: "Canceled",
};

// canceled is a list-view-only state — it has no column on the board.
export const BOARD_STATUSES: readonly DevStatus[] = DEV_STATUSES.filter((s) => s !== "canceled");

export const DEV_ASSIGNEES = ["Jas", "Rishi", "Luiza"] as const;
export type DevAssignee = (typeof DEV_ASSIGNEES)[number];

export const DEV_PRIORITIES = ["low", "medium", "high"] as const;
export type DevPriority = (typeof DEV_PRIORITIES)[number];

export const DEV_TASK_KINDS = ["bug", "idea", "copy", "question"] as const;
export type DevTaskKind = (typeof DEV_TASK_KINDS)[number];

export const DEV_TASK_KIND_LABELS: Record<DevTaskKind, string> = {
  bug: "Bug",
  idea: "Idea",
  copy: "Copy",
  question: "Question",
};

// components/console/ui.tsx has no exported BadgeTone — Badge's `tone` prop
// is `keyof typeof BADGE_TONES`, an unexported const. Define the same four
// tones locally rather than pulling a JSX-bearing file into this module.
type BadgeTone = "neutral" | "brand" | "green" | "red";

export const STATUS_TONE: Record<DevStatus, BadgeTone> = {
  not_started: "neutral",
  coding: "brand",
  testing: "brand",
  in_staging: "brand",
  done: "green",
  canceled: "neutral",
};

export const PRIORITY_TONE: Record<DevPriority, BadgeTone> = {
  low: "neutral",
  medium: "brand",
  high: "red",
};

// Informational, not urgency — every kind gets the same neutral tone.
export const KIND_TONE: Record<DevTaskKind, BadgeTone> = {
  bug: "neutral",
  idea: "neutral",
  copy: "neutral",
  question: "neutral",
};

export type DevTask = {
  id: string;
  title: string;
  description: string;
  notes: string;
  triage_notes: string;
  context: Json;
  kind: DevTaskKind | null;
  status: DevStatus;
  assignee: DevAssignee | null;
  priority: DevPriority;
  sort_order: number;
  page_path: string | null;
  created_by: string | null;
  reporter_email: string | null;
  created_at: string;
  updated_at: string;
};

/* ---------- board filters ---------- */

export type DevFilters = {
  view: "board" | "list";
  q: string;
  statuses: DevStatus[];
  assignees: string[]; // includes the sentinel "unassigned"
  showClosed: boolean;
};

function asArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** Parse the URL searchParams bag into a validated filter set. Pure. */
export function parseDevFilters(sp: Record<string, string | string[] | undefined>): DevFilters {
  const view = sp.view === "list" ? "list" : "board";
  const q = typeof sp.q === "string" ? sp.q : "";
  const statuses = asArray(sp.status).filter((s): s is DevStatus => (DEV_STATUSES as readonly string[]).includes(s));
  const assignees = asArray(sp.assignee).filter((a) => a === "unassigned" || (DEV_ASSIGNEES as readonly string[]).includes(a));
  const showClosed = sp.show === "all";
  return { view, q, statuses, assignees, showClosed };
}

/** Serialise filters back to a query string, with overrides. */
export function devQs(f: DevFilters, over: Partial<Record<string, string | undefined>> = {}): string {
  const params = new URLSearchParams();
  params.set("view", f.view);
  if (f.q) params.set("q", f.q);
  for (const s of f.statuses) params.append("status", s);
  for (const a of f.assignees) params.append("assignee", a);
  if (f.showClosed) params.set("show", "all");
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) params.delete(k);
    else params.set(k, v);
  }
  return `?${params.toString()}`;
}

/**
 * Apply the filters in memory rather than as a PostgREST query: `.or(...)`
 * interpolates the raw search string into PostgREST's filter grammar, where
 * commas/parens/backslashes are syntax — escaping that correctly is a trap
 * for a plain search box, and the board is tens-to-low-hundreds of rows.
 *
 * Search matches title + description only — not notes (the frozen widget
 * snapshot) or triage_notes (the scratchpad); both can hold long stack
 * traces or half-formed thoughts nobody is searching for by substring.
 */
export function filterDevTasks(tasks: DevTask[], f: DevFilters): DevTask[] {
  let result = tasks;
  if (!f.showClosed) result = result.filter((t) => t.status !== "done" && t.status !== "canceled");
  if (f.statuses.length) result = result.filter((t) => f.statuses.includes(t.status));
  if (f.assignees.length) {
    result = result.filter((t) =>
      f.assignees.includes("unassigned") && !t.assignee ? true : t.assignee !== null && f.assignees.includes(t.assignee),
    );
  }
  if (f.q) {
    const q = f.q.toLowerCase();
    result = result.filter((t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
  }
  return result;
}

/* ---------- drag/drop reorder maths ---------- */

/**
 * Compute the result of dropping `activeId` onto `overId` (a card, or a
 * column id when the column is empty), landing it in `targetStatus`.
 * Returns the full task list with status/sort_order updated, plus the dense
 * ordered id list of the destination column (what moveDevTask upserts).
 */
export function applyMove(
  tasks: DevTask[],
  activeId: string,
  targetStatus: DevStatus,
  overId: string | null,
): { tasks: DevTask[]; orderedIds: string[] } {
  const active = tasks.find((t) => t.id === activeId);
  if (!active) return { tasks, orderedIds: [] };

  const columnOf = (status: DevStatus) =>
    tasks.filter((t) => t.status === status && t.id !== activeId).sort((a, b) => a.sort_order - b.sort_order);

  const destination = columnOf(targetStatus);
  const overIndex = overId ? destination.findIndex((t) => t.id === overId) : -1;
  const insertAt = overIndex === -1 ? destination.length : overIndex;
  destination.splice(insertAt, 0, active);

  const orderedIds = destination.map((t) => t.id);
  const updates = new Map(destination.map((t, i) => [t.id, i]));

  const nextTasks = tasks.map((t) => {
    if (t.id === activeId) return { ...t, status: targetStatus, sort_order: updates.get(t.id)! };
    if (updates.has(t.id)) return { ...t, sort_order: updates.get(t.id)! };
    return t;
  });

  return { tasks: nextTasks, orderedIds };
}

/* ---------- board / detail form parsing ---------- */

// Insert, not Update: title is required either way (devTaskValuesFromForm
// guarantees it), and an Insert-shaped object satisfies both db.insert() and
// db.update() — the reverse (Update, where title is optional) does not
// satisfy insert()'s stricter requirement.
type DevTaskWrite = Database["public"]["Tables"]["dev_tasks"]["Insert"];

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

/**
 * Board quick-add / detail-page form -> the payload to write. Empty
 * assignee/kind map to null (unassigned / uncategorised), never a fallback
 * value — those are meaningful states here, unlike status/priority which
 * always have a sensible default.
 */
export function devTaskValuesFromForm(formData: FormData): { error: string } | { values: DevTaskWrite } {
  const title = text(formData, "title").slice(0, 200);
  if (!title) return { error: "Give it a one-line title." };

  const statusRaw = text(formData, "status");
  const status = (DEV_STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as DevStatus) : "not_started";

  const priorityRaw = text(formData, "priority");
  const priority = (DEV_PRIORITIES as readonly string[]).includes(priorityRaw) ? (priorityRaw as DevPriority) : "medium";

  const assigneeRaw = text(formData, "assignee");
  const assignee = (DEV_ASSIGNEES as readonly string[]).includes(assigneeRaw) ? assigneeRaw : null;

  const kindRaw = text(formData, "kind");
  const kind = (DEV_TASK_KINDS as readonly string[]).includes(kindRaw) ? kindRaw : null;

  const values: DevTaskWrite = {
    title,
    description: text(formData, "description").slice(0, 5000),
    triage_notes: text(formData, "triage_notes").slice(0, 5000),
    status,
    priority,
    assignee,
    kind,
  };

  return { values };
}

/* ---------- widget capture parsing ---------- */

export type DevTaskContext = {
  page: { pathname: string; url: string; title: string; referrer: string };
  env: { user_agent: string; viewport: string; screen: string; dpr: number; theme: string; language: string; timezone: string };
  errors: Array<{
    at: string;
    kind: string;
    message: string;
    source?: string;
    line?: number;
    column?: number;
    stack?: string;
    count: number;
  }>;
  captured_at: string;
  reporter?: { user_id: string; email: string; role: string };
};

export type DevTaskCaptureResult =
  | { error: string }
  | {
      values: { title: string; description: string; kind: DevTaskKind; priority: DevPriority };
      context: DevTaskContext;
    };

const MAX_CONTEXT_BYTES = 32_768;
const MAX_ERRORS = 5;

function clip(s: unknown, max: number): string {
  return typeof s === "string" ? s.slice(0, max) : "";
}

/** FormData from the widget's dialog -> the payload to write, plus the parsed context. */
export function devTaskFromForm(formData: FormData): DevTaskCaptureResult {
  const title = text(formData, "title").slice(0, 200);
  if (!title) return { error: "Give it a one-line title." };

  const kindRaw = text(formData, "kind");
  const kind = (DEV_TASK_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as DevTaskKind) : "bug";

  const priorityRaw = text(formData, "priority");
  const priority = (DEV_PRIORITIES as readonly string[]).includes(priorityRaw) ? (priorityRaw as DevPriority) : "medium";

  const description = text(formData, "description").slice(0, 5000);

  const raw = String(formData.get("context") ?? "");
  if (new TextEncoder().encode(raw).length > MAX_CONTEXT_BYTES) {
    return { error: "That page's diagnostics were too large to attach — try again." };
  }

  let parsed: unknown = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  const p = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const pageRaw = (p.page && typeof p.page === "object" ? p.page : {}) as Record<string, unknown>;
  const env = (p.env && typeof p.env === "object" ? p.env : {}) as Record<string, unknown>;
  const rawErrors = Array.isArray(p.errors) ? p.errors : [];

  const context: DevTaskContext = {
    page: {
      pathname: clip(pageRaw.pathname, 500),
      url: clip(pageRaw.url, 500),
      title: clip(pageRaw.title, 500),
      referrer: clip(pageRaw.referrer, 500),
    },
    env: {
      user_agent: clip(env.user_agent, 500),
      viewport: clip(env.viewport, 100),
      screen: clip(env.screen, 100),
      dpr: typeof env.dpr === "number" ? env.dpr : 1,
      theme: clip(env.theme, 50),
      language: clip(env.language, 50),
      timezone: clip(env.timezone, 100),
    },
    errors: rawErrors.slice(0, MAX_ERRORS).map((e) => {
      const err = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
      return {
        at: clip(err.at, 50),
        kind: clip(err.kind, 50),
        message: clip(err.message, 500),
        source: clip(err.source, 500) || undefined,
        line: typeof err.line === "number" ? err.line : undefined,
        column: typeof err.column === "number" ? err.column : undefined,
        stack: clip(err.stack, 1000) || undefined,
        count: typeof err.count === "number" ? err.count : 1,
      };
    }),
    captured_at: clip(p.captured_at, 50) || new Date(0).toISOString(),
  };

  return { values: { title, description, kind, priority }, context };
}

/**
 * Renders a context blob -> the frozen `notes` snapshot, at insert time.
 * Runs against an arbitrary jsonb-shaped value (a malformed context is
 * dropped to `{}` upstream, but this must still never throw), so every
 * field is read defensively.
 */
export function renderDevTaskNotes(context: unknown): string {
  const c = (context && typeof context === "object" ? context : {}) as Record<string, unknown>;
  const page = (c.page && typeof c.page === "object" ? c.page : {}) as Record<string, unknown>;
  const env = (c.env && typeof c.env === "object" ? c.env : {}) as Record<string, unknown>;
  const reporter = (c.reporter && typeof c.reporter === "object" ? c.reporter : {}) as Record<string, unknown>;
  const errors = Array.isArray(c.errors) ? c.errors : [];

  const lines: string[] = [];
  lines.push(`Page: ${clip(page.pathname, 500) || "—"} — "${clip(page.title, 500)}"`);
  lines.push(`URL: ${clip(page.url, 500) || "—"}`);
  if (page.referrer) lines.push(`Referrer: ${clip(page.referrer, 500)}`);
  if (reporter.email) lines.push(`Reported by: ${clip(reporter.email, 200)} (${clip(reporter.role, 50)}) at ${clip(c.captured_at, 50)}`);
  lines.push("");
  lines.push("Environment");
  lines.push(`  Viewport ${clip(env.viewport, 100) || "—"} · screen ${clip(env.screen, 100) || "—"} · DPR ${typeof env.dpr === "number" ? env.dpr : "—"} · theme ${clip(env.theme, 50) || "—"}`);
  lines.push(`  Locale ${clip(env.language, 50) || "—"} · ${clip(env.timezone, 100) || "—"}`);
  lines.push(`  UA ${clip(env.user_agent, 500) || "—"}`);
  lines.push("");
  if (errors.length === 0) {
    lines.push("Recent client errors: none.");
  } else {
    lines.push(`Recent client errors (${errors.length})`);
    errors.forEach((e, i) => {
      const err = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
      const count = typeof err.count === "number" && err.count > 1 ? ` x${err.count}` : "";
      lines.push(`  ${i + 1}. [${clip(err.kind, 50) || "error"}${count}] ${clip(err.at, 50)} ${clip(err.message, 500)}`);
      if (err.source) lines.push(`     ${clip(err.source, 500)}:${typeof err.line === "number" ? err.line : "?"}:${typeof err.column === "number" ? err.column : "?"}`);
    });
  }
  return lines.join("\n");
}

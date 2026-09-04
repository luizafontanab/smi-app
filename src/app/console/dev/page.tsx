import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { Badge } from "@/components/console/ui";
import {
  DEV_ASSIGNEES,
  DEV_STATUS_LABELS,
  DEV_STATUSES,
  DEV_TASK_KIND_LABELS,
  PRIORITY_TONE,
  STATUS_TONE,
  devQs,
  filterDevTasks,
  parseDevFilters,
  type DevTask,
} from "@/lib/dev-tasks";
import { createDevTask } from "../actions";
import { DevBoard } from "./DevBoard";

export const dynamic = "force-dynamic";

const TABS = [
  { view: "board", label: "Board" },
  { view: "list", label: "List" },
] as const;

const SELECT =
  "id, title, description, notes, triage_notes, context, kind, status, assignee, priority, sort_order, page_path, created_by, reporter_email, created_at, updated_at";

// board order, canceled last — used to sort the list view the same way the
// board reads, since a plain alphabetical/status sort would scatter coding
// tasks away from testing.
const STATUS_RANK: Record<string, number> = Object.fromEntries(DEV_STATUSES.map((s, i) => [s, i]));

export default async function DevBoardPage(props: PageProps<"/console/dev">) {
  await requireConsole();
  const sp = await props.searchParams;
  const filters = parseDevFilters(sp);
  const db = serviceDb();

  const { data } = await db.from("dev_tasks").select(SELECT).order("status").order("sort_order").limit(500);
  const tasks = filterDevTasks((data ?? []) as DevTask[], filters);
  const returnTo = devQs(filters);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-ink">Dev Board</h1>
        <Link href="/console/dev/new" className="rounded bg-ink px-4 py-2 text-sm text-white">
          + New task
        </Link>
      </div>

      <div className="mt-4 flex gap-1 border-b text-sm">
        {TABS.map((t) => (
          <Link
            key={t.view}
            href={devQs(filters, { view: t.view })}
            className={`rounded-t px-4 py-2 ${t.view === filters.view ? "border border-b-0 bg-white font-semibold text-ink" : "text-graphite hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <form method="get" className="mt-4 flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 text-sm shadow-sm">
        <input type="hidden" name="view" value={filters.view} />
        <div>
          <label htmlFor="dev-q" className="block text-xs uppercase tracking-wide text-graphite">
            Search
          </label>
          <input
            id="dev-q"
            name="q"
            defaultValue={filters.q}
            placeholder="Search title and description…"
            className="mt-1 w-56 rounded border px-3 py-1.5"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DEV_STATUSES.map((s) => (
            <label key={s} className="cursor-pointer">
              <input type="checkbox" name="status" value={s} defaultChecked={filters.statuses.includes(s)} className="peer sr-only" />
              <span className="rounded-full border px-3 py-1 text-xs peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white">
                {DEV_STATUS_LABELS[s]}
              </span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[...DEV_ASSIGNEES, "unassigned"].map((a) => (
            <label key={a} className="cursor-pointer">
              <input type="checkbox" name="assignee" value={a} defaultChecked={filters.assignees.includes(a)} className="peer sr-only" />
              <span className="rounded-full border px-3 py-1 text-xs capitalize peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white">
                {a}
              </span>
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-graphite">
          <input type="checkbox" name="show" value="all" defaultChecked={filters.showClosed} />
          Show done &amp; canceled
        </label>
        <div className="flex gap-2">
          <button className="rounded bg-ink px-4 py-1.5 text-white">Apply</button>
          <Link href={`?view=${filters.view}`} className="rounded border px-4 py-1.5 text-graphite">
            Clear
          </Link>
        </div>
      </form>

      {typeof sp.deleted === "string" && <p role="status" className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Task deleted.</p>}
      {typeof sp.saved === "string" && <p role="status" className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      {filters.view === "board" ? (
        // The "show done & canceled" toggle is list-only — Done is a real
        // column on the board (capped, not hidden); canceled never appears
        // there regardless of the toggle.
        <DevBoard tasks={filterDevTasks((data ?? []) as DevTask[], { ...filters, showClosed: true }).filter((t) => t.status !== "canceled")} returnTo={returnTo} />
      ) : (
        <DevListView tasks={tasks} returnTo={returnTo} />
      )}
    </div>
  );
}

function DevListView({ tasks, returnTo }: { tasks: DevTask[]; returnTo: string }) {
  const sorted = [...tasks].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.sort_order - b.sort_order);

  return (
    <section className="mt-5 rounded-xl bg-white p-5 shadow-sm">
      <form action={createDevTask} className="flex flex-wrap gap-2 text-sm">
        <input name="title" placeholder="+ Add task" aria-label="New task title" required className="min-w-48 flex-1 rounded border px-3 py-1.5" />
        <select name="status" defaultValue="not_started" aria-label="Status" className="max-w-full rounded border px-3 py-1.5">
          {DEV_STATUSES.map((s) => (
            <option key={s} value={s}>
              {DEV_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select name="assignee" defaultValue="" aria-label="Assignee" className="max-w-full rounded border px-3 py-1.5">
          <option value="">— unassigned —</option>
          {DEV_ASSIGNEES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button className="rounded bg-ink px-4 py-1.5 text-white">+ Add</button>
      </form>

      {sorted.length === 0 ? (
        <p className="mt-4 text-sm text-graphite">No tasks match these filters.</p>
      ) : (
        <div className="overflow-x-auto mt-4">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-xs uppercase text-graphite">
              <th scope="col" className="py-1">Title</th>
              <th scope="col">Status</th>
              <th scope="col">Assignee</th>
              <th scope="col">Priority</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.id} className="border-t align-top">
                <td className="py-1.5">
                  <Link href={`/console/dev/${t.id}${returnTo}`} className="font-medium hover:text-graphite">
                    {t.title}
                  </Link>
                  {t.kind && <span className="ml-1.5 text-xs text-graphite">({DEV_TASK_KIND_LABELS[t.kind]})</span>}
                  {t.description && <p className="mt-0.5 truncate text-xs text-graphite">{t.description}</p>}
                </td>
                <td>
                  <Badge tone={STATUS_TONE[t.status]}>{DEV_STATUS_LABELS[t.status]}</Badge>
                </td>
                <td className="text-graphite">{t.assignee ?? "—"}</td>
                <td>
                  <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                </td>
                <td className="text-xs text-graphite">{new Date(t.updated_at).toLocaleDateString("en-GB")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}

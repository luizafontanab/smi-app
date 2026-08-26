import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { SubmitButton } from "@/components/SubmitButton";
import {
  DEV_ASSIGNEES,
  DEV_PRIORITIES,
  DEV_STATUS_LABELS,
  DEV_STATUSES,
  DEV_TASK_KIND_LABELS,
  DEV_TASK_KINDS,
  devQs,
  parseDevFilters,
} from "@/lib/dev-tasks";
import { deleteDevTask, saveDevTask } from "../../actions";

export const dynamic = "force-dynamic";

export default async function DevTaskEditor(props: PageProps<"/console/dev/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  const isNew = id === "new";

  // Round-trips through parseDevFilters/devQs so the board link that brought
  // us here and this page's own return_to hidden field agree byte-for-byte.
  const returnTo = `/console/dev${devQs(parseDevFilters(sp))}`;

  const { data: task } = isNew ? { data: null } : await serviceDb().from("dev_tasks").select("*").eq("id", id).single();
  if (!isNew && !task) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={returnTo} className="text-sm text-gray-400 hover:text-ink">
        ← Dev Board
      </Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{isNew ? "New task" : task!.title}</h1>
      {typeof sp.error === "string" && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-600">{sp.error}</p>}

      {!isNew && task!.notes && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Reported from the site</h2>
          {task!.page_path && <p className="mt-1 text-xs text-gray-500">Page: {task!.page_path}</p>}
          {task!.reporter_email && <p className="text-xs text-gray-500">Reported by: {task!.reporter_email}</p>}
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-paper p-3 text-xs">{task!.notes}</pre>
        </section>
      )}

      <form action={saveDevTask} className="mt-4 space-y-4 rounded-xl bg-white p-5 shadow-sm">
        {!isNew && <input type="hidden" name="id" value={id} />}
        <input type="hidden" name="return_to" value={returnTo} />

        <div>
          <label htmlFor="title" className="text-sm font-medium">
            Title
          </label>
          <input id="title" name="title" defaultValue={task?.title ?? ""} required className="mt-1 w-full rounded border px-3 py-2" />
        </div>

        <div>
          <label htmlFor="description" className="text-sm font-medium">
            Description
          </label>
          <textarea id="description" name="description" rows={5} defaultValue={task?.description ?? ""} className="mt-1 w-full whitespace-pre-wrap rounded border px-3 py-2" />
        </div>

        <div>
          <label htmlFor="triage_notes" className="text-sm font-medium">
            Notes (working scratchpad)
          </label>
          <textarea
            id="triage_notes"
            name="triage_notes"
            rows={6}
            defaultValue={task?.triage_notes ?? ""}
            className="mt-1 w-full whitespace-pre-wrap rounded border px-3 py-2"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <label htmlFor="status" className="text-sm font-medium">
              Status
            </label>
            <select id="status" name="status" defaultValue={task?.status ?? "not_started"} className="mt-1 w-full rounded border px-3 py-2">
              {DEV_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {DEV_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="assignee" className="text-sm font-medium">
              Assignee
            </label>
            <select id="assignee" name="assignee" defaultValue={task?.assignee ?? ""} className="mt-1 w-full rounded border px-3 py-2">
              <option value="">— unassigned —</option>
              {DEV_ASSIGNEES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="priority" className="text-sm font-medium">
              Priority
            </label>
            <select id="priority" name="priority" defaultValue={task?.priority ?? "medium"} className="mt-1 w-full rounded border px-3 py-2">
              {DEV_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="kind" className="text-sm font-medium">
              Kind
            </label>
            <select id="kind" name="kind" defaultValue={task?.kind ?? ""} className="mt-1 w-full rounded border px-3 py-2">
              <option value="">— none —</option>
              {DEV_TASK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DEV_TASK_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">
          Save
        </SubmitButton>

        {!isNew && (
          <p className="text-xs text-gray-400">
            Created {new Date(task!.created_at).toLocaleString("en-GB")} · Last updated {new Date(task!.updated_at).toLocaleString("en-GB")}
          </p>
        )}
      </form>

      {!isNew && (
        <form action={deleteDevTask} className="mt-4 rounded-xl border border-red-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Delete task</h2>
          <p className="mt-1 text-xs text-gray-500">Permanent. Use the &quot;Canceled&quot; status instead if you just want it off the board.</p>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" name="confirm" value="1" /> Yes, delete this task permanently
          </label>
          <button className="mt-3 rounded border border-red-300 px-3 py-1.5 text-sm text-red-600">Delete</button>
        </form>
      )}
    </div>
  );
}

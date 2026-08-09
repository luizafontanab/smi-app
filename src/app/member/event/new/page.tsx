import Link from "next/link";
import { submitEvent } from "../../actions";

export const metadata = { title: "Add an event" };

export default function NewMemberEvent() {
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/member" className="text-sm text-gray-400 hover:text-navy">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-navy">Add an event</h1>
      <p className="mt-1 text-sm text-gray-500">Open days, exhibitions, launches — approved events appear on the SMI events page.</p>
      <form action={submitEvent} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div>
          <label className="text-sm font-medium">Event name</label>
          <input name="title" required className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label className="text-sm font-medium">Description</label>
          <textarea name="description" rows={3} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium">Location</label>
            <input name="location" className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label className="text-sm font-medium">Link (optional)</label>
            <input name="link" type="url" className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label className="text-sm font-medium">Starts</label>
            <input name="starts_on" type="date" required className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label className="text-sm font-medium">Ends (optional)</label>
            <input name="ends_on" type="date" className="mt-1 w-full rounded border px-3 py-2" />
          </div>
        </div>
        <button className="rounded bg-navy px-5 py-2.5 text-white">Submit for approval</button>
      </form>
    </div>
  );
}

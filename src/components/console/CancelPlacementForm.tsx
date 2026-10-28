import { cancelPlacement } from "@/app/console/actions";

/**
 * "Cancel this booking" for a Featured Member or Featured Event slot, or a takeover, that hasn't
 * been paid for and hasn't run — the page decides whether to show it; the
 * action (cancelPlacement) checks the same things again. Same shape as the
 * console's other destructive forms: a bordered card, a required confirm box.
 */
export function CancelPlacementForm({ id, noun, held }: { id: string; noun: string; held: boolean }) {
  return (
    <form action={cancelPlacement} className="mt-4 rounded-xl border border-danger/30 bg-white p-5 text-sm shadow-sm">
      <input type="hidden" name="id" value={id} />
      <h2 className="font-bold text-ink">Cancel this {noun}</h2>
      <p className="mt-1 text-xs text-graphite">
        {held ? "Not paid for, so it isn't on the site. " : "It hasn't started yet. "}
        Cancelling deletes the booking and frees its dates, and cancels its invoice so the pay link stops working. The member isn&apos;t emailed — tell them yourself.
      </p>
      <label className="mt-3 flex items-center gap-2">
        <input type="checkbox" name="confirm" value="1" required />
        Yes, cancel this {noun}
      </label>
      <button className="mt-3 rounded border border-danger/30 px-4 py-2 text-danger">Cancel {noun}</button>
    </form>
  );
}

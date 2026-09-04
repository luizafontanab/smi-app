import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { consoleUploadImage, decideMachine, saveMachine, saveMachinePlacement } from "../../actions";
import { RichTextEditor } from "@/components/RichTextEditor";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";

export const dynamic = "force-dynamic";

export default async function MachineEditor(props: PageProps<"/console/machines/[id]">) {
  const { id } = await props.params;
  await requireConsole();
  const db = serviceDb();
  const isNew = id === "new";

  const [{ data: machine }, { data: members }] = await Promise.all([
    isNew ? Promise.resolve({ data: null }) : db.from("featured_machines").select("*").eq("id", id).single(),
    db.from("members").select("id, name").eq("status", "active").order("name"),
  ]);
  if (!isNew && !machine) notFound();
  const image = mediaUrl(machine?.image_path);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/console/machines" className="text-sm text-graphite hover:text-ink">← Featured Machine</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{isNew ? "New machine" : "Edit machine"}</h1>
      {machine?.status === "rejected" && (
        <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">Rejected: {machine.rejected_reason}</p>
      )}

      <form action={saveMachine} className="mt-4 space-y-4 rounded-xl bg-white p-5 shadow-sm">
        <UnsavedChangesGuard />
        {!isNew && <input type="hidden" name="id" value={id} />}
        <div>
          <label htmlFor="name" className="text-sm font-medium">Machine name</label>
          <input id="name" name="name" defaultValue={machine?.name ?? ""} required className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <span className="block text-sm font-medium">Description (specs, condition, pricing)</span>
          <RichTextEditor name="description" ariaLabel="Description" initialHtml={machine?.description ?? ""} uploadImage={consoleUploadImage} minHeightClass="min-h-56" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="member_id" className="text-sm font-medium">Seller (member page it links to)</label>
            <select id="member_id" name="member_id" defaultValue={machine?.member_id ?? ""} required className="mt-1 w-full rounded border px-3 py-2">
              <option value="">— choose —</option>
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="external_url" className="text-sm font-medium">Link to full details (seller&apos;s site)</label>
            <input id="external_url" name="external_url" type="url" defaultValue={machine?.external_url ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
        </div>
        <div>
          <label htmlFor="image" className="text-sm font-medium">Photo</label>
          {image && <Image src={image} alt="" width={240} height={140} className="mt-1 rounded object-cover" unoptimized />}
          <input id="image" type="file" name="image" accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm" />
        </div>
        <button className="rounded bg-ink px-5 py-2.5 text-white">Save</button>
      </form>

      {!isNew && machine && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {machine.status === "awaiting_approval" && (
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-bold text-ink">Approval</h2>
              <p className="mt-1 text-xs text-graphite">Member submission — publishing does not feature it; book a slot below once live.</p>
              <div className="mt-3 flex gap-2">
                <form action={decideMachine}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="decision" value="approve" />
                  <button className="rounded bg-success px-4 py-2 text-sm text-white">Approve & publish</button>
                </form>
              </div>
              <form action={decideMachine} className="mt-3 flex gap-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="decision" value="reject" />
                <input name="reason" placeholder="Reason (sent to the member)" required className="w-full rounded border px-3 py-1.5 text-sm" />
                <button className="rounded border border-danger/30 px-3 py-1.5 text-sm text-danger">Reject</button>
              </form>
            </div>
          )}
          {machine.status === "published" && (
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-bold text-ink">Feature this machine (A11)</h2>
              <p className="mt-1 text-xs text-graphite">Paid slot — shows on the Featured Machine page for the booked period, then auto-expires.</p>
              <form action={saveMachinePlacement} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <input type="hidden" name="machine_id" value={id} />
                <input type="date" name="starts_on" required className="rounded border px-3 py-1.5" />
                <span className="text-graphite">→</span>
                <input type="date" name="ends_on" required className="rounded border px-3 py-1.5" />
                <button className="rounded bg-ink px-4 py-2 text-white">Book slot</button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

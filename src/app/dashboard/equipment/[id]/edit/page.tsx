import { notFound } from "next/navigation";
import { requireMemberView } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { memberCanEdit } from "@/lib/member-content";
import { renderableHtml } from "@/lib/sanitize";
import { RequiredMark } from "@/components/RequiredMark";
import { RichTextEditor } from "@/components/RichTextEditor";
import { YoutubePreview } from "@/components/YoutubePreview";
import { editMachine, memberUploadImage, withdrawMachine } from "../../../actions";
import { UploadField } from "@/components/UploadField";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit your equipment listing" };

export default async function EditMemberMachine(props: PageProps<"/dashboard/equipment/[id]/edit">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const user = await requireMemberView();
  const db = serviceDb();
  const { data: machine } = await db.from("featured_machines")
    .select("id, name, description, external_url, image_path, video_url, status, member_id")
    .eq("id", id).single();
  if (!machine || !memberCanEdit("machine", machine, user.memberId)) notFound();

  return (
    <div className="max-w-2xl lg:mx-auto">
      <h1 className="mt-1 text-xl font-bold text-ink">Edit your equipment listing</h1>
      <p className="mt-1 text-sm text-graphite">
        Saving sends it back for approval{machine.status === "rejected" ? "." : " — this replaces your earlier submission."}
      </p>
      {typeof sp.error === "string" && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      <form action={editMachine} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <input type="hidden" name="id" value={machine.id} />
        <div>
          <label htmlFor="name" className="text-sm font-medium">Machine name<RequiredMark /></label>
          <input id="name" name="name" required defaultValue={machine.name} className="mt-1 w-full rounded border px-3 py-2" placeholder="e.g. 2024 Durma HD-F 3015 fibre laser" />
        </div>
        <div>
          <span className="block text-sm font-medium">Description (specs, condition, price guide)</span>
          <RichTextEditor name="description" ariaLabel="Description" uploadImage={memberUploadImage} initialHtml={renderableHtml(machine.description)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="external_url" className="text-sm font-medium">Link to full details on your site</label>
            <input id="external_url" name="external_url" type="url" defaultValue={machine.external_url ?? ""} className="mt-1 w-full rounded border px-3 py-2" placeholder="https://…" />
          </div>
          <div>
            <label htmlFor="image" className="text-sm font-medium">Photo</label>
            {machine.image_path && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaUrl(machine.image_path) ?? undefined} alt="" className="mt-1 h-16 rounded border" />
            )}
            <UploadField id="image" name="image" accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm" />
            <p className="mt-1 text-xs text-graphite">Landscape, JPG/PNG, max 8MB. Leave empty to keep the current photo.</p>
          </div>
        </div>
        <YoutubePreview name="video_url" required={false} label="Video of the machine running (YouTube link)" defaultValue={machine.video_url ?? ""} />
        <div className="flex items-center gap-3">
          <button className="rounded bg-ink px-5 py-2.5 text-white">Save & resubmit</button>
          <button type="submit" formAction={withdrawMachine} className="text-sm text-graphite underline hover:text-danger">
            Withdraw
          </button>
        </div>
      </form>
    </div>
  );
}

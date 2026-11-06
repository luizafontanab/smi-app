import { SubmitButton } from "@/components/SubmitButton";
import { requireMemberView } from "@/lib/auth";
import { memberUploadImage, submitMachine } from "../../actions";
import { RequiredMark } from "@/components/RequiredMark";
import { RichTextEditor } from "@/components/RichTextEditor";
import { YoutubePreview } from "@/components/YoutubePreview";
import { UploadField } from "@/components/UploadField";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add equipment" };

export default async function NewMemberMachine(props: PageProps<"/dashboard/equipment/new">) {
  await requireMemberView();
  const sp = await props.searchParams;
  return (
    <div className="max-w-2xl lg:mx-auto">
      <h1 className="mt-1 text-xl font-bold text-ink">Add equipment</h1>
      <p className="mt-1 text-sm text-graphite">
        List a machine for sale. The editor reviews every listing before it appears; buyers are sent to
        your own site for the full details — SMI never handles the sale.
      </p>
      {typeof sp.error === "string" && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      <form action={submitMachine} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div>
          <label htmlFor="name" className="text-sm font-medium">Machine name<RequiredMark /></label>
          <input id="name" name="name" required className="mt-1 w-full rounded border px-3 py-2" placeholder="e.g. 2024 Durma HD-F 3015 fibre laser" />
        </div>
        <div>
          <span className="block text-sm font-medium">Description (specs, condition, price guide)</span>
          <RichTextEditor name="description" ariaLabel="Description" uploadImage={memberUploadImage} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="external_url" className="text-sm font-medium">Link to full details on your site</label>
            <input id="external_url" name="external_url" type="url" className="mt-1 w-full rounded border px-3 py-2" placeholder="https://…" />
          </div>
          <div>
            <label htmlFor="image" className="text-sm font-medium">Photo</label>
            <UploadField id="image" name="image" accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm" />
            <p className="mt-1 text-xs text-graphite">Landscape, JPG/PNG, max 8MB.</p>
          </div>
        </div>
        <YoutubePreview name="video_url" required={false} label="Video of the machine running (YouTube link)" />
        <SubmitButton pendingLabel="Submitting…" className="rounded bg-ink px-5 py-2.5 text-white">Submit for approval</SubmitButton>
      </form>
    </div>
  );
}

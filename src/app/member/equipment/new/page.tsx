import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { memberUploadImage, submitMachine } from "../../actions";
import { RichTextEditor } from "@/components/RichTextEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add equipment" };

export default async function NewMemberMachine() {
  await requireMember();
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/member" className="text-sm text-gray-400 hover:text-navy">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-navy">Add equipment</h1>
      <p className="mt-1 text-sm text-gray-500">
        List a machine for sale. The editor reviews every listing before it appears; buyers are sent to
        your own site for the full details — SMI never handles the sale.
      </p>
      <form action={submitMachine} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div>
          <label className="text-sm font-medium">Machine name</label>
          <input name="name" required className="mt-1 w-full rounded border px-3 py-2" placeholder="e.g. 2024 Durma HD-F 3015 fibre laser" />
        </div>
        <div>
          <label className="text-sm font-medium">Description (specs, condition, price guide)</label>
          <RichTextEditor name="description" uploadImage={memberUploadImage} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium">Link to full details on your site</label>
            <input name="external_url" type="url" className="mt-1 w-full rounded border px-3 py-2" placeholder="https://…" />
          </div>
          <div>
            <label className="text-sm font-medium">Photo</label>
            <input type="file" name="image" accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm" />
            <p className="mt-1 text-xs text-gray-400">Landscape, JPG/PNG, max 8MB.</p>
          </div>
        </div>
        <button className="rounded bg-navy px-5 py-2.5 text-white">Submit for approval</button>
      </form>
    </div>
  );
}

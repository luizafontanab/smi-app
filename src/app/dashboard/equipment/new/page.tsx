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
      <Link href="/dashboard" className="text-sm text-gray-500 hover:text-ink">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">Add equipment</h1>
      <p className="mt-1 text-sm text-gray-500">
        List a machine for sale. The editor reviews every listing before it appears; buyers are sent to
        your own site for the full details — SMI never handles the sale.
      </p>
      <form action={submitMachine} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div>
          <label htmlFor="name" className="text-sm font-medium">Machine name</label>
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
            <input id="image" type="file" name="image" accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm" />
            <p className="mt-1 text-xs text-gray-500">Landscape, JPG/PNG, max 8MB.</p>
          </div>
        </div>
        <button className="rounded bg-ink px-5 py-2.5 text-white">Submit for approval</button>
      </form>
    </div>
  );
}

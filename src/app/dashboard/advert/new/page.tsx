import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { submitAdvert } from "../../actions";
import { AdvertForm } from "../AdvertForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Advertise with SMI" };

export default async function NewMemberAdvert(props: PageProps<"/dashboard/advert/new">) {
  const sp = await props.searchParams;
  await requireMember();
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard" className="text-sm text-gray-500 hover:text-ink">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">Advertise with SMI</h1>
      <p className="mt-1 text-sm text-gray-500">
        Upload your artwork and tell us when you would like it to run. We will confirm availability and invoice you — there is no online payment.
      </p>
      {typeof sp.error === "string" && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-600">{sp.error}</p>}
      <AdvertForm action={submitAdvert} />
    </div>
  );
}

import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { memberUploadVideoImage, submitVideo } from "../../actions";
import { VideoForm } from "./VideoForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a video" };

export default async function NewMemberVideo() {
  const user = await requireMember();
  const { data: member } = await serviceDb().from("members").select("name, slug, logo_path").eq("id", user.memberId).single();
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard" className="text-sm text-gray-400 hover:text-ink">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">Add a video</h1>
      <p className="mt-1 text-sm text-gray-500">
        The editor reviews every video before it goes live. Once approved it&apos;s published with a link back to
        your page and shared on SMI&apos;s social channels.
      </p>
      <VideoForm
        action={submitVideo}
        uploadImage={memberUploadVideoImage}
        member={{ name: member?.name ?? "", slug: member?.slug ?? "", logoUrl: mediaUrl(member?.logo_path) }}
      />
    </div>
  );
}

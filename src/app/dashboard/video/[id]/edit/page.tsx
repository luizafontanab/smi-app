import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { renderableHtml } from "@/lib/sanitize";
import { editVideo, memberUploadVideoImage, withdrawVideo } from "../../../actions";
import { VideoForm } from "../../new/VideoForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit your video" };

const EDITABLE_STATUSES = ["awaiting_approval", "rejected"];

export default async function EditMemberVideo(props: PageProps<"/dashboard/video/[id]/edit">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const user = await requireMember();
  const db = serviceDb();
  const [{ data: video }, { data: member }] = await Promise.all([
    db.from("videos").select("id, title, url, description, thumbnail_path, status, member_id").eq("id", id).single(),
    serviceDb().from("members").select("name, slug, logo_path").eq("id", user.memberId).single(),
  ]);
  if (!video || video.member_id !== user.memberId || !EDITABLE_STATUSES.includes(video.status)) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard" className="text-sm text-gray-500 hover:text-ink">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">Edit your video</h1>
      <p className="mt-1 text-sm text-gray-500">
        Saving sends it back for approval{video.status === "rejected" ? "." : " — this replaces your earlier submission."}
      </p>
      {typeof sp.error === "string" && <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-600">{sp.error}</p>}
      <VideoForm
        action={editVideo}
        withdrawAction={withdrawVideo}
        uploadImage={memberUploadVideoImage}
        member={{ name: member?.name ?? "", slug: member?.slug ?? "", logoUrl: mediaUrl(member?.logo_path) }}
        initial={{
          id: video.id,
          title: video.title,
          url: video.url,
          description: renderableHtml(video.description),
          thumbnailUrl: mediaUrl(video.thumbnail_path),
        }}
      />
    </div>
  );
}

import { notFound } from "next/navigation";
import { requireMemberView } from "@/lib/auth";
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
  const user = await requireMemberView();
  const db = serviceDb();
  const [{ data: video }, { data: member }, { data: inds }] = await Promise.all([
    db.from("videos").select("id, title, url, description, thumbnail_path, status, member_id, industry_id").eq("id", id).single(),
    db.from("members").select("name, slug, logo_path, industry_id").eq("id", user.memberId).single(),
    db.from("industries").select("id, name").order("sort_order"),
  ]);
  if (!video || video.member_id !== user.memberId || !EDITABLE_STATUSES.includes(video.status)) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mt-1 text-xl font-bold text-ink">Edit your video</h1>
      <p className="mt-1 text-sm text-graphite">
        Saving sends it back for approval{video.status === "rejected" ? "." : " — this replaces your earlier submission."}
      </p>
      {typeof sp.error === "string" && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      <VideoForm
        action={editVideo}
        withdrawAction={withdrawVideo}
        uploadImage={memberUploadVideoImage}
        industries={inds ?? []}
        defaultIndustryId={member?.industry_id ?? null}
        member={{ name: member?.name ?? "", slug: member?.slug ?? "", logoUrl: mediaUrl(member?.logo_path) }}
        initial={{
          id: video.id,
          title: video.title,
          url: video.url,
          description: renderableHtml(video.description),
          thumbnailUrl: mediaUrl(video.thumbnail_path),
          industryId: video.industry_id,
        }}
      />
    </div>
  );
}

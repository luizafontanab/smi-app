import { requireMember } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { AddContentTabs } from "@/components/dashboard/AddContentTabs";
import { memberUploadVideoImage, submitVideo } from "../../actions";
import { VideoForm } from "./VideoForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a video" };

export default async function NewMemberVideo() {
  const user = await requireMember();
  const db = serviceDb();
  const [{ data: member }, { data: inds }] = await Promise.all([
    db.from("members").select("name, slug, logo_path, industry_id").eq("id", user.memberId).single(),
    db.from("industries").select("id, name").order("sort_order"),
  ]);
  return (
    <div className="mx-auto max-w-2xl">
      <AddContentTabs active="video" />
      <h1 className="mt-4 text-xl font-bold text-ink">Add a video</h1>
      <p className="mt-1 text-sm text-graphite">
        The editor reviews every video before it goes live. Once approved it&apos;s published with a link back to
        your page and shared on SMI&apos;s social channels.
      </p>
      <VideoForm
        action={submitVideo}
        uploadImage={memberUploadVideoImage}
        industries={inds ?? []}
        defaultIndustryId={member?.industry_id ?? null}
        member={{ name: member?.name ?? "", slug: member?.slug ?? "", logoUrl: mediaUrl(member?.logo_path) }}
      />
    </div>
  );
}

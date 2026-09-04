import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { mediaUrl, publicDb, serviceDb } from "@/lib/db/server";
import { renderableHtml } from "@/lib/sanitize";
import { editStory, memberUploadImage, withdrawStory } from "../../../actions";
import { StoryForm } from "../../new/StoryForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit your story" };

const EDITABLE_STATUSES = ["awaiting_approval", "rejected"];

export default async function EditMemberStory(props: PageProps<"/dashboard/story/[id]/edit">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const user = await requireMember();
  const db = serviceDb();
  const [{ data: story }, { data: cats }, { data: member }, { data: link }] = await Promise.all([
    db.from("stories").select("id, title, excerpt, body, cover_path, cover_focus, status, member_id").eq("id", id).single(),
    publicDb().from("categories").select("id, name").eq("kind", "story").order("name"),
    serviceDb().from("members").select("name, slug, logo_path").eq("id", user.memberId).single(),
    db.from("story_categories").select("category_id").eq("story_id", id).maybeSingle(),
  ]);
  if (!story || story.member_id !== user.memberId || !EDITABLE_STATUSES.includes(story.status)) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mt-1 text-xl font-bold text-ink">Edit your story</h1>
      <p className="mt-1 text-sm text-graphite">
        Saving sends it back for approval{story.status === "rejected" ? "." : " — this replaces your earlier submission."}
      </p>
      {typeof sp.error === "string" && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      <StoryForm
        action={editStory}
        withdrawAction={withdrawStory}
        uploadImage={memberUploadImage}
        categories={cats ?? []}
        member={{ name: member?.name ?? "", slug: member?.slug ?? "", logoUrl: mediaUrl(member?.logo_path) }}
        initial={{
          id: story.id,
          title: story.title,
          excerpt: story.excerpt ?? "",
          body: renderableHtml(story.body),
          coverUrl: mediaUrl(story.cover_path),
          categoryId: link?.category_id ?? null,
        }}
      />
    </div>
  );
}

import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { mediaUrl, publicDb, serviceDb } from "@/lib/db/server";
import { renderableHtml } from "@/lib/sanitize";
import { memberCanEditStory } from "@/lib/member-story";
import { isMemberDraft } from "@/lib/story-board";
import { deleteStoryDraft, editStory, memberUploadImage, previewStoryBody, withdrawStory } from "../../../actions";
import { StoryForm } from "../../new/StoryForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit your story" };

export default async function EditMemberStory(props: PageProps<"/dashboard/story/[id]/edit">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const user = await requireMember();
  const db = serviceDb();
  const [{ data: story }, { data: cats }, { data: member }, { data: link }, { data: inds }] = await Promise.all([
    db.from("stories").select("id, title, excerpt, body, cover_path, cover_focus, status, member_id, member_draft, industry_id").eq("id", id).single(),
    publicDb().from("categories").select("id, name, slug").order("name"),
    serviceDb().from("members").select("name, slug, logo_path, industry_id").eq("id", user.memberId).single(),
    db.from("story_categories").select("category_id").eq("story_id", id).maybeSingle(),
    publicDb().from("industries").select("id, name").order("sort_order"),
  ]);
  if (!story || !memberCanEditStory(story, user.memberId)) notFound();
  const draft = isMemberDraft(story);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mt-1 text-xl font-bold text-ink">{draft ? "Your draft story" : "Edit your story"}</h1>
      <p className="mt-1 text-sm text-graphite">
        {draft
          ? "Only you can see this draft. Preview it as it will publish, then submit it for approval when it's ready."
          : `Saving sends it back for approval${story.status === "rejected" ? "." : " — this replaces your earlier submission."}`}
      </p>
      {sp.saved === "draft" && (
        <p role="status" className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Draft saved.</p>
      )}
      {typeof sp.error === "string" && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      <StoryForm
        action={editStory}
        withdrawAction={withdrawStory}
        deleteDraftAction={deleteStoryDraft}
        isDraft={draft}
        previewHref={`/preview/story/${story.id}`}
        uploadImage={memberUploadImage}
        previewBody={previewStoryBody}
        categories={cats ?? []}
        industries={inds ?? []}
        defaultIndustryId={member?.industry_id ?? null}
        member={{ name: member?.name ?? "", slug: member?.slug ?? "", logoUrl: mediaUrl(member?.logo_path) }}
        initial={{
          id: story.id,
          title: story.title,
          excerpt: story.excerpt ?? "",
          body: renderableHtml(story.body),
          coverUrl: mediaUrl(story.cover_path),
          categoryId: link?.category_id ?? null,
          industryId: story.industry_id,
        }}
      />
    </div>
  );
}

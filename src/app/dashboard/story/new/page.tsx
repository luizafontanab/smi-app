import { requireMember } from "@/lib/auth";
import { mediaUrl, publicDb, serviceDb } from "@/lib/db/server";
import { AddContentTabs } from "@/components/dashboard/AddContentTabs";
import { memberUploadImage, submitStory } from "../../actions";
import { StoryForm } from "./StoryForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a story" };

export default async function NewMemberStory(props: PageProps<"/dashboard/story/new">) {
  const user = await requireMember();
  const sp = await props.searchParams;
  const [{ data: cats }, { data: member }] = await Promise.all([
    publicDb().from("categories").select("id, name").eq("kind", "story").order("name"),
    serviceDb().from("members").select("name, slug, logo_path").eq("id", user.memberId).single(),
  ]);
  return (
    <div className="mx-auto max-w-2xl">
      <AddContentTabs active="story" />
      <h1 className="mt-4 text-xl font-bold text-ink">Add a story</h1>
      <p className="mt-1 text-sm text-graphite">
        The editor reviews every story before it goes live. Once approved it&apos;s published with a link back to
        your page and shared on SMI&apos;s social channels.
      </p>
      {typeof sp.error === "string" && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      <StoryForm
        action={submitStory}
        uploadImage={memberUploadImage}
        categories={cats ?? []}
        member={{ name: member?.name ?? "", slug: member?.slug ?? "", logoUrl: mediaUrl(member?.logo_path) }}
      />
    </div>
  );
}

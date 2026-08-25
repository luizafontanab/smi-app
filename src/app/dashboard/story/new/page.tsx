import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { mediaUrl, publicDb, serviceDb } from "@/lib/db/server";
import { memberUploadImage, submitStory } from "../../actions";
import { StoryForm } from "./StoryForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a story" };

export default async function NewMemberStory() {
  const user = await requireMember();
  const [{ data: cats }, { data: member }] = await Promise.all([
    publicDb().from("categories").select("id, name").eq("kind", "story").order("name"),
    serviceDb().from("members").select("name, slug, logo_path").eq("id", user.memberId).single(),
  ]);
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard" className="text-sm text-gray-400 hover:text-ink">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">Add a story</h1>
      <p className="mt-1 text-sm text-gray-500">
        The editor reviews every story before it goes live. Once approved it&apos;s published with a link back to
        your page and shared on SMI&apos;s social channels.
      </p>
      <StoryForm
        action={submitStory}
        uploadImage={memberUploadImage}
        categories={cats ?? []}
        member={{ name: member?.name ?? "", slug: member?.slug ?? "", logoUrl: mediaUrl(member?.logo_path) }}
      />
    </div>
  );
}

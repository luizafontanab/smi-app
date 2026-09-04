import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { AddContentTabs } from "@/components/dashboard/AddContentTabs";
import { memberUploadEventImage, submitEvent } from "../../actions";
import { EventForm } from "./EventForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add an event" };

export default async function NewMemberEvent() {
  const user = await requireMember();
  const { data: member } = await serviceDb().from("members").select("name, slug").eq("id", user.memberId).single();
  return (
    <div className="mx-auto max-w-2xl">
      <AddContentTabs active="event" />
      <h1 className="mt-4 text-xl font-bold text-ink">Add an event</h1>
      <p className="mt-1 text-sm text-graphite">Open days, exhibitions, launches — approved events appear on the SMI events page.</p>
      <EventForm
        action={submitEvent}
        uploadImage={memberUploadEventImage}
        member={{ name: member?.name ?? "", slug: member?.slug ?? "" }}
      />
    </div>
  );
}

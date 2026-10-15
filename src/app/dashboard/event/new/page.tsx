import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { AddContentTabs } from "@/components/dashboard/AddContentTabs";
import { memberUploadEventImage, submitEvent } from "../../actions";
import { EventForm } from "./EventForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add an event" };

export default async function NewMemberEvent(props: PageProps<"/dashboard/event/new">) {
  const user = await requireMember();
  const sp = await props.searchParams;
  const db = serviceDb();
  const [{ data: member }, { data: inds }] = await Promise.all([
    db.from("members").select("name, slug, industry_id").eq("id", user.memberId).single(),
    db.from("industries").select("id, name").order("sort_order"),
  ]);
  return (
    <div className="mx-auto max-w-2xl">
      <AddContentTabs active="event" />
      <h1 className="mt-4 text-xl font-bold text-ink">Add an event</h1>
      <p className="mt-1 text-sm text-graphite">Open days, exhibitions, launches — approved events appear on the SMI events page.</p>
      {typeof sp.error === "string" && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      <EventForm
        action={submitEvent}
        uploadImage={memberUploadEventImage}
        industries={inds ?? []}
        defaultIndustryId={member?.industry_id ?? null}
        member={{ name: member?.name ?? "", slug: member?.slug ?? "" }}
      />
    </div>
  );
}

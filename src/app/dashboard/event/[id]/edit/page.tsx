import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { renderableHtml } from "@/lib/sanitize";
import { editEvent, memberUploadEventImage, withdrawEvent } from "../../../actions";
import { EventForm } from "../../new/EventForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit your event" };

const EDITABLE_STATUSES = ["awaiting_approval", "rejected"];

export default async function EditMemberEvent(props: PageProps<"/dashboard/event/[id]/edit">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const user = await requireMember();
  const db = serviceDb();
  const [{ data: event }, { data: member }] = await Promise.all([
    db.from("events").select("id, title, description, starts_on, starts_time, ends_on, location, link, type, cover_path, status, member_id").eq("id", id).single(),
    serviceDb().from("members").select("name, slug").eq("id", user.memberId).single(),
  ]);
  if (!event || event.member_id !== user.memberId || !EDITABLE_STATUSES.includes(event.status)) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mt-1 text-xl font-bold text-ink">Edit your event</h1>
      <p className="mt-1 text-sm text-graphite">
        Saving sends it back for approval{event.status === "rejected" ? "." : " — this replaces your earlier submission."}
      </p>
      {typeof sp.error === "string" && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      <EventForm
        action={editEvent}
        withdrawAction={withdrawEvent}
        uploadImage={memberUploadEventImage}
        member={{ name: member?.name ?? "", slug: member?.slug ?? "" }}
        initial={{
          id: event.id,
          title: event.title,
          description: renderableHtml(event.description),
          startsOn: event.starts_on,
          startsTime: event.starts_time,
          endsOn: event.ends_on,
          location: event.location ?? "",
          link: event.link,
          type: event.type,
          coverUrl: mediaUrl(event.cover_path),
        }}
      />
    </div>
  );
}

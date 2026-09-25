import { permanentRedirect } from "next/navigation";

/** See ../page.tsx — the feed moved to /console/notifications (fix-list 71). */
export default async function MessageMoved(props: PageProps<"/console/messages/[id]">) {
  const { id } = await props.params;
  permanentRedirect(`/console/notifications/${id}`);
}

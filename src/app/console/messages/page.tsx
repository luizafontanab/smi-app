import { permanentRedirect } from "next/navigation";

/**
 * `/console/messages` was the whole console inbox: enquiries and machine-written
 * event notices in one undifferentiated list. It is now `/console/notifications`
 * with the two separated (fix-list 71).
 *
 * The redirect lives here rather than in `next.config.ts` on purpose: a config
 * redirect needs a dev-server restart to take effect, and the old path is
 * bookmarked in exactly one browser — Jas's.
 */
export default function MessagesMoved() {
  permanentRedirect("/console/notifications");
}

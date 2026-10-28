import { ADMIN_STATE, test } from "./fixtures";

/**
 * Console smoke, as jas. List pages only, navigation only.
 *
 * Deliberately absent:
 * - /console/notifications/[id] marks the message read on view.
 * - /console/dev — the dev board, whose client components drive actions.
 * - Every detail/edit page: they are one click from a save.
 */
test.use({ storageState: ADMIN_STATE });

const PAGES = [
  "/console",
  "/console/stories",
  "/console/members",
  "/console/adverts",
  "/console/adverts/featured-event",
  "/console/events",
  "/console/videos",
  "/console/messages",
  "/console/notifications",
  "/console/analytics",
  "/console/newsletter",
  "/console/leads",
  "/console/features",
  "/console/crm",
  "/console/releases",
];

for (const path of PAGES) {
  test(`${path} renders`, async ({ visit }) => {
    await visit(path);
  });
}

import { SectionTabs } from "@/components/dashboard/SectionTabs";

const TABS = [
  { key: "story", href: "/dashboard/story/new", label: "Story" },
  { key: "video", href: "/dashboard/video/new", label: "Video" },
  { key: "event", href: "/dashboard/event/new", label: "Event" },
] as const;

export type AddContentTab = (typeof TABS)[number]["key"];

/**
 * Story / Video / Event strip on the three add-content forms (fix list item
 * 20). It is the only way between content types now: the old /dashboard/content
 * card hub was removed (fix list item 30), so "Add content" in the nav and on
 * the dashboard both land straight on the Story form with this strip.
 */
export function AddContentTabs({ active }: { active: AddContentTab }) {
  return <SectionTabs items={TABS} active={active} ariaLabel="Content types" />;
}

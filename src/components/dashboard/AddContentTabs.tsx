import { SectionTabs } from "@/components/dashboard/SectionTabs";

const TABS = [
  { key: "story", href: "/dashboard/story/new", label: "Story" },
  { key: "video", href: "/dashboard/video/new", label: "Video" },
  { key: "event", href: "/dashboard/event/new", label: "Event" },
] as const;

export type AddContentTab = (typeof TABS)[number]["key"];

/**
 * Story / Video / Event strip on the three add-content forms (fix list item
 * 20) — lets a member hop between content types without going back through
 * the /dashboard/content hub. The hub itself keeps its three cards and no
 * strip: the same three links twice on one screen would be redundant.
 */
export function AddContentTabs({ active }: { active: AddContentTab }) {
  return <SectionTabs items={TABS} active={active} ariaLabel="Content types" />;
}

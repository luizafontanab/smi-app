import { SectionTabs } from "@/components/dashboard/SectionTabs";

const TABS = [
  { key: "information", href: "/dashboard/advertising", label: "Information" },
  { key: "buy", href: "/dashboard/advertising/buy", label: "Buy" },
  { key: "manage", href: "/dashboard/advertising/manage", label: "Manage" },
  // Every piece of artwork and listing in one place, with its status (GAPS A9.8).
  { key: "assets", href: "/dashboard/advertising/assets", label: "Assets" },
] as const;

export type AdvertisingTab = (typeof TABS)[number]["key"];

/** The hub's Information / Buy / Manage / Assets strip — server-rendered, no client JS. */
export function AdvertisingTabs({ active }: { active: AdvertisingTab }) {
  return <SectionTabs items={TABS} active={active} ariaLabel="Advertising sections" />;
}

import { SectionTabs } from "@/components/dashboard/SectionTabs";

const TABS = [
  { key: "information", href: "/dashboard/advertising", label: "Information" },
  { key: "buy", href: "/dashboard/advertising/buy", label: "Buy" },
  { key: "manage", href: "/dashboard/advertising/manage", label: "Manage" },
] as const;

export type AdvertisingTab = (typeof TABS)[number]["key"];

/** The hub's Information / Buy / Manage strip — server-rendered, no client JS. */
export function AdvertisingTabs({ active }: { active: AdvertisingTab }) {
  return <SectionTabs items={TABS} active={active} ariaLabel="Advertising sections" />;
}

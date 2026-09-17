import { SectionTabs } from "@/components/dashboard/SectionTabs";

const TABS = [
  { key: "notifications", href: "/dashboard/settings", label: "Notifications" },
  { key: "security", href: "/dashboard/settings/security", label: "Security" },
  { key: "billing", href: "/dashboard/settings/billing", label: "Billing" },
] as const;

export type SettingsTab = (typeof TABS)[number]["key"];

/** The settings area's Notifications / Security / Billing strip — same treatment as AdvertisingTabs. */
export function SettingsTabs({ active }: { active: SettingsTab }) {
  return <SectionTabs items={TABS} active={active} ariaLabel="Settings sections" />;
}

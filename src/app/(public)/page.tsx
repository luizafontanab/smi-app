import type { ComponentType } from "react";
import { pickView } from "@/lib/variant";
import { HomeView } from "@/components/design-option";
import { loadHome, type HomeData } from "./home.data";
import { ForgeHome } from "./home.forge";

export const dynamic = "force-dynamic"; // adverts re-roll on every page load

export default async function HomePage() {
  const [View, data] = await Promise.all([
    // The type is stated, not inferred: TypeScript otherwise picks one of the
    // two components' types, and which one depended on its cache, so Vercel's
    // cached build failed where a clean build passed (9 Nov 2026).
    pickView<ComponentType<HomeData>>({ forge: ForgeHome, grid: HomeView }),
    loadHome(),
  ]);
  return <View {...data} />;
}

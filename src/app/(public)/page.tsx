import { pickView } from "@/lib/variant";
import { HomeView } from "@/components/design-option";
import { loadHome } from "./home.data";
import { ForgeHome } from "./home.forge";

export const dynamic = "force-dynamic"; // adverts re-roll on every page load

export default async function HomePage() {
  const [View, data] = await Promise.all([
    pickView({ forge: ForgeHome, grid: HomeView }),
    loadHome(),
  ]);
  return <View {...data} />;
}

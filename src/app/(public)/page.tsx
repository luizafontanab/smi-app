import { pickView } from "@/lib/variant";
import { loadHome } from "./home.data";
import { ForgeHome } from "./home.forge";
import { GridHome } from "./home.grid";

export const dynamic = "force-dynamic"; // adverts re-roll on every page load

export default async function HomePage() {
  const [View, data] = await Promise.all([
    pickView({ forge: ForgeHome, grid: GridHome }),
    loadHome(),
  ]);
  return <View {...data} />;
}

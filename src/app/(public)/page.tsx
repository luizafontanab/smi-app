import { pickView } from "@/lib/variant";
import { loadHome } from "./home.data";
import { ForgeHome } from "./home.forge";
import { GridHome } from "./home.grid";
import { classicVariant } from "@/components/classic-prototype/variant";

export const dynamic = "force-dynamic"; // adverts re-roll on every page load

export default async function HomePage() {
  const [View, data, classic] = await Promise.all([
    pickView({ forge: ForgeHome, grid: GridHome }),
    loadHome(),
    classicVariant(), // PROTOTYPE (issue #59)
  ]);
  return <View {...data} classic={classic} />;
}

import { permanentRedirect } from "next/navigation";

// Renamed Inventory → Banners (fix-list 79). Kept so old links and bookmarks land.
export default function OldInventoryPage() {
  permanentRedirect("/console/adverts/banners");
}

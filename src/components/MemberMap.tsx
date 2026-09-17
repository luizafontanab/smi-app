import { PinMap } from "./PinMap";

// Thin adapter over the generalised PinMap (which owns the ssr:false dynamic
// import) — /member's API is unchanged: it still passes MapMember rows.
export type MapMember = { slug: string; name: string; lat: number; lng: number };

export function MemberMap({ members }: { members: MapMember[] }) {
  return (
    <PinMap
      ariaLabel="Map of member locations"
      pins={members.map((m) => ({ href: `/member/${m.slug}`, label: m.name, lat: m.lat, lng: m.lng }))}
    />
  );
}

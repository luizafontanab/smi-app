"use client";

import dynamic from "next/dynamic";
import type { MapMember } from "./MemberMapImpl";

// Leaflet touches `window`/`navigator` at import time (browser detection in
// its own core), which throws during SSR — `ssr: false` is only legal inside
// a Client Component, hence this thin wrapper around the real implementation.
const Map = dynamic(() => import("./MemberMapImpl").then((m) => m.MemberMap), {
  ssr: false,
  loading: () => <div className="h-[32rem] animate-pulse rounded-lg bg-graphite/10" />,
});

export type { MapMember };

export function MemberMap({ members }: { members: MapMember[] }) {
  return <Map members={members} />;
}

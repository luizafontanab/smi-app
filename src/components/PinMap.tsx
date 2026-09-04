"use client";

import dynamic from "next/dynamic";
import type { MapPin } from "./PinMapImpl";

// Leaflet touches `window`/`navigator` at import time (browser detection in
// its own core), which throws during SSR — `ssr: false` is only legal inside
// a Client Component, hence this thin wrapper around the real implementation.
const Map = dynamic(() => import("./PinMapImpl").then((m) => m.PinMap), {
  ssr: false,
  loading: () => <div className="h-[32rem] animate-pulse rounded-lg bg-graphite/10" />,
});

export type { MapPin };

export function PinMap({ pins, ariaLabel }: { pins: MapPin[]; ariaLabel: string }) {
  return <Map pins={pins} ariaLabel={ariaLabel} />;
}

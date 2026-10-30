"use client";

import dynamic from "next/dynamic";
import type { MapPin, PinMapOptions } from "./PinMapImpl";

// Google Maps only runs in the browser and is billed per map load, so the map
// is client-only and code-split — `ssr: false` is only legal inside a Client
// Component, hence this thin wrapper around the real implementation.
const Map = dynamic(() => import("./PinMapImpl").then((m) => m.PinMap), { ssr: false });

export type { MapPin, PinMapOptions };

export function PinMap(props: { pins: MapPin[]; ariaLabel: string } & PinMapOptions) {
  // The placeholder lives here rather than in dynamic()'s `loading`, which
  // can't see props: it holds the map's own height so nothing jumps when
  // Google Maps arrives, and the map paints over it.
  const { heightClass = "h-[32rem]", roundedClass = "rounded-lg shadow-sm" } = props;
  return (
    <div className={`${heightClass} ${roundedClass} bg-graphite/10`}>
      <Map {...props} />
    </div>
  );
}

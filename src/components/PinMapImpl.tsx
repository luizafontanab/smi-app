"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  useAdvancedMarkerRef,
} from "@vis.gl/react-google-maps";

/**
 * Generalised pin map (grown out of the member-directory map): anything with a
 * link, a label and coordinates. `MemberMap` and `EventMap` are thin adapters.
 *
 * Drawn by Google Maps (key: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY). Coordinates
 * still come from Nominatim at save time (lib/adapters/geocode.ts) — only the
 * display is Google's. No key → a quiet "Map unavailable" box instead of
 * Google's error overlay, so local setups without a key still render the page.
 */

export type MapPin = { href: string; label: string; lat: number; lng: number };

/**
 * Display options, defaulting to the directory/events map. A member profile's
 * sidebar map (one pin, the page you're already on) passes a street-level
 * zoom, a shorter box, no wheel zoom — so scrolling the page past it doesn't
 * get captured — and no popup linking back to the same page.
 */
export type PinMapOptions = { zoom?: number; heightClass?: string; scrollWheelZoom?: boolean; popups?: boolean; roundedClass?: string };

/** The site's orange pin. Its tip sits at the bottom centre, which is where AdvancedMarker anchors by default. */
function PinIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40" aria-hidden="true">
      <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.3 21.7 0 14 0z" fill="#f97316" stroke="#1a1a1a" strokeWidth="1.5" />
      <circle cx="14" cy="14" r="5.5" fill="#fff" />
    </svg>
  );
}

function PinMarker({ pin, popups, open, onOpen, onClose }: { pin: MapPin; popups: boolean; open: boolean; onOpen: () => void; onClose: () => void }) {
  const [ref, marker] = useAdvancedMarkerRef();
  return (
    <>
      {/* title names the marker for assistive tech; a click handler makes it keyboard-focusable */}
      <AdvancedMarker ref={ref} position={{ lat: pin.lat, lng: pin.lng }} title={pin.label} onClick={popups ? onOpen : undefined}>
        <PinIcon />
      </AdvancedMarker>
      {popups && open && (
        <InfoWindow anchor={marker} onCloseClick={onClose}>
          <Link href={pin.href} className="font-semibold hover:underline">{pin.label}</Link>
        </InfoWindow>
      )}
    </>
  );
}

export function PinMap({
  pins,
  ariaLabel,
  zoom = 6,
  heightClass = "h-[32rem]",
  scrollWheelZoom = true,
  popups = true,
  roundedClass = "rounded-lg shadow-sm",
}: { pins: MapPin[]; ariaLabel: string } & PinMapOptions) {
  // Read here, not at module scope, so tests can vary it. Next inlines it at build either way.
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  // AdvancedMarker needs a map id; Google's demo id works until SMI makes its own.
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";
  const [openHref, setOpenHref] = useState<string | null>(null);

  // Centres on the average of whatever is on screen, or the UK with nothing to show.
  const center = useMemo(() => {
    if (pins.length === 0) return { lat: 54.5, lng: -3 };
    const lat = pins.reduce((sum, p) => sum + p.lat, 0) / pins.length;
    const lng = pins.reduce((sum, p) => sum + p.lng, 0) / pins.length;
    return { lat, lng };
  }, [pins]);

  if (!apiKey) {
    return (
      <div role="region" aria-label={ariaLabel} className={`${heightClass} ${roundedClass} flex items-center justify-center text-sm text-graphite/70`}>
        Map unavailable
      </div>
    );
  }

  return (
    <div role="region" aria-label={ariaLabel} className={`${heightClass} overflow-hidden ${roundedClass}`}>
      <APIProvider apiKey={apiKey}>
        <GoogleMap
          className="h-full w-full"
          mapId={mapId}
          defaultCenter={center}
          defaultZoom={zoom}
          // "cooperative" = ctrl/two-finger to zoom, so page scroll passes over the map
          gestureHandling={scrollWheelZoom ? "greedy" : "cooperative"}
          streetViewControl={false}
          mapTypeControl={false}
        >
          {pins.map((p) => (
            <PinMarker
              key={p.href}
              pin={p}
              popups={popups}
              open={openHref === p.href}
              onOpen={() => setOpenHref(p.href)}
              onClose={() => setOpenHref(null)}
            />
          ))}
        </GoogleMap>
      </APIProvider>
    </div>
  );
}

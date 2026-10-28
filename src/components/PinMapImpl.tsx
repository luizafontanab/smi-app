"use client";

import { useMemo } from "react";
import Link from "next/link";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Generalised pin map (grown out of the member-directory map): anything with a
 * link, a label and coordinates. `MemberMap` and `EventMap` are thin adapters.
 *
 * A plain SVG pin via divIcon, not Leaflet's default raster marker — the
 * default's icon URLs are relative to Leaflet's own CSS, which doesn't
 * resolve once bundled by Next (import 'leaflet/dist/images/*.png' produced
 * a StaticImageData object whose .src Leaflet couldn't use, throwing "iconUrl
 * not set"). An inline SVG sidesteps asset bundling entirely.
 */
const icon = L.divIcon({
  className: "",
  html:
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">' +
    '<path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.3 21.7 0 14 0z" fill="#f97316" stroke="#1a1a1a" stroke-width="1.5"/>' +
    '<circle cx="14" cy="14" r="5.5" fill="#fff"/>' +
    "</svg>",
  iconSize: [28, 40],
  iconAnchor: [14, 40],
  popupAnchor: [0, -36],
});

export type MapPin = { href: string; label: string; lat: number; lng: number };

/**
 * Display options, defaulting to the directory/events map. A member profile's
 * sidebar map (one pin, the page you're already on) passes a street-level
 * zoom, a shorter box, no wheel zoom — so scrolling the page past it doesn't
 * get captured — and no popup linking back to the same page.
 */
export type PinMapOptions = { zoom?: number; heightClass?: string; scrollWheelZoom?: boolean; popups?: boolean; roundedClass?: string };

export function PinMap({
  pins,
  ariaLabel,
  zoom = 6,
  heightClass = "h-[32rem]",
  scrollWheelZoom = true,
  popups = true,
  roundedClass = "rounded-lg shadow-sm",
}: { pins: MapPin[]; ariaLabel: string } & PinMapOptions) {
  // Centres on the average of whatever is on screen — filters change what's
  // plotted, so the view should follow rather than stay pinned to the UK.
  const center = useMemo<[number, number]>(() => {
    if (pins.length === 0) return [54.5, -3];
    const lat = pins.reduce((sum, p) => sum + p.lat, 0) / pins.length;
    const lng = pins.reduce((sum, p) => sum + p.lng, 0) / pins.length;
    return [lat, lng];
  }, [pins]);

  return (
    <div role="region" aria-label={ariaLabel} className={`${heightClass} overflow-hidden ${roundedClass}`}>
      <MapContainer center={center} zoom={zoom} scrollWheelZoom={scrollWheelZoom} className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {/* title gives each keyboard-focusable divIcon an accessible name */}
        {pins.map((p) => (
          <Marker key={p.href} position={[p.lat, p.lng]} icon={icon} title={p.label} alt={p.label}>
            {popups && (
              <Popup>
                <Link href={p.href} className="font-semibold hover:underline">{p.label}</Link>
              </Popup>
            )}
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

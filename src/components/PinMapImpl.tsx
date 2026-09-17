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

export function PinMap({ pins, ariaLabel }: { pins: MapPin[]; ariaLabel: string }) {
  // Centres on the average of whatever is on screen — filters change what's
  // plotted, so the view should follow rather than stay pinned to the UK.
  const center = useMemo<[number, number]>(() => {
    if (pins.length === 0) return [54.5, -3];
    const lat = pins.reduce((sum, p) => sum + p.lat, 0) / pins.length;
    const lng = pins.reduce((sum, p) => sum + p.lng, 0) / pins.length;
    return [lat, lng];
  }, [pins]);

  return (
    <div role="region" aria-label={ariaLabel} className="h-[32rem] overflow-hidden rounded-lg shadow-sm">
      <MapContainer center={center} zoom={6} scrollWheelZoom className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {/* title gives each keyboard-focusable divIcon an accessible name */}
        {pins.map((p) => (
          <Marker key={p.href} position={[p.lat, p.lng]} icon={icon} title={p.label} alt={p.label}>
            <Popup>
              <Link href={p.href} className="font-semibold hover:underline">{p.label}</Link>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

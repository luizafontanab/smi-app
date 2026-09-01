"use client";

import { useMemo } from "react";
import Link from "next/link";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

/**
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

export type MapMember = { slug: string; name: string; lat: number; lng: number };

export function MemberMap({ members }: { members: MapMember[] }) {
  // Centres on the average of whatever is on screen — filters change what's
  // plotted, so the view should follow rather than stay pinned to the UK.
  const center = useMemo<[number, number]>(() => {
    if (members.length === 0) return [54.5, -3];
    const lat = members.reduce((sum, m) => sum + m.lat, 0) / members.length;
    const lng = members.reduce((sum, m) => sum + m.lng, 0) / members.length;
    return [lat, lng];
  }, [members]);

  return (
    <div className="h-[32rem] overflow-hidden rounded-lg shadow-sm">
      <MapContainer center={center} zoom={6} scrollWheelZoom className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {members.map((m) => (
          <Marker key={m.slug} position={[m.lat, m.lng]} icon={icon}>
            <Popup>
              <Link href={`/member/${m.slug}`} className="font-semibold hover:underline">{m.name}</Link>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

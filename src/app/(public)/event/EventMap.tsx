import { PinMap } from "@/components/PinMap";

export type EventPin = { slug: string; title: string; lat: number | null; lng: number | null };

/**
 * Map of upcoming events, mirroring /member's map view: coordinates only
 * exist once an event's location has been (re)saved and geocoded, so coverage
 * can be sparse — say so rather than silently dropping events. When nothing
 * at all has coordinates (e.g. seeded rows that were never saved through the
 * console) the map renders nothing rather than an empty UK.
 */
export function EventMap({ events }: { events: EventPin[] }) {
  const withCoords = events.filter((e): e is EventPin & { lat: number; lng: number } => e.lat != null && e.lng != null);
  if (withCoords.length === 0) return null;

  return (
    <section data-part="event-map" className="mt-8">
      <h2 data-part="section-title" className="text-lg font-bold text-ink">Event map</h2>
      {withCoords.length < events.length && (
        <p data-part="form-notice" className="mt-2 text-sm text-graphite">
          Showing {withCoords.length} of {events.length} events with a known location.
        </p>
      )}
      <div data-part="map" className="mt-3">
        <PinMap
          ariaLabel="Map of upcoming event locations"
          pins={withCoords.map((e) => ({ href: `/event/${e.slug}`, label: e.title, lat: e.lat, lng: e.lng }))}
        />
      </div>
    </section>
  );
}

export const EVENT_TYPES = ["webinar", "live_event", "open_house", "exhibition", "golf_challenge"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  webinar: "Webinar",
  live_event: "Live event",
  open_house: "Open house",
  exhibition: "Exhibition",
  golf_challenge: "Golf challenge",
};

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

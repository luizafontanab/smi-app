export type SocialCaps = { per_day: number; delay_minutes: number };

/** Falls back to this when the "social_caps" settings row hasn't been edited yet. */
export const DEFAULT_SOCIAL_CAPS: SocialCaps = { per_day: 3, delay_minutes: 30 };

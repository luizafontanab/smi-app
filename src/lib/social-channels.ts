/** GAPS B4.1: Buffer requires an explicit profile_ids[] per post — there is no "post to everything connected" default. */
export type SocialChannels = { profileIds: string[] };

/** Falls back to this when the "social_channels" settings row hasn't been edited yet. */
export const DEFAULT_SOCIAL_CHANNELS: SocialChannels = { profileIds: [] };

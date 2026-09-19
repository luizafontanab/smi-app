/**
 * GAPS B4.4: Buffer's GraphQL API takes one `channelId` per `createPost` mutation —
 * there is no "post to everything connected" default, and the v1 `profile_ids[]`
 * array is gone. One mutation per channel, so this is the list we fan out over.
 */
export type SocialChannels = {
  channelIds: string[];
  /** Not needed to post; needed for any future `channels(input: { organizationId })` lookup. */
  organizationId?: string;
};

/** Falls back to this when the "social_channels" settings row hasn't been edited yet. */
export const DEFAULT_SOCIAL_CHANNELS: SocialChannels = { channelIds: [] };

/**
 * Reads the stored "social_channels" settings row, which predates the GraphQL
 * migration and may still hold v1 `profileIds`.
 *
 * Those are deliberately NOT coerced into `channelIds`: a v1 profile id and a
 * GraphQL channel id are different identifiers in different APIs, and treating
 * one as the other would either post to the wrong account or produce a
 * `MutationError` nobody can explain. They come back separately so the console
 * can say so out loud (/console/stories).
 */
export function readSocialChannels(value: unknown): SocialChannels & { legacyProfileIds: string[] } {
  const row = (value ?? {}) as { channelIds?: unknown; organizationId?: unknown; profileIds?: unknown };
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

  return {
    channelIds: strings(row.channelIds),
    organizationId: typeof row.organizationId === "string" && row.organizationId ? row.organizationId : undefined,
    legacyProfileIds: strings(row.profileIds),
  };
}

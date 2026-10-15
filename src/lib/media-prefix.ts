/**
 * Where every stored media file is served from: the public `media` bucket's
 * URL prefix. One copy for the three places that need it — mediaUrl()
 * (lib/db/server) builds URLs on it, the sanitiser (lib/sanitize) drops any
 * <img> not under it, and the rich-text editor (RichTextEditorImpl) takes a
 * pasted foreign image out at the paste for the same reason. Client-safe:
 * NEXT_PUBLIC_SUPABASE_URL is inlined into the browser bundle at build time.
 */
export const MEDIA_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/`;

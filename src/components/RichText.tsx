import { renderableHtml } from "@/lib/sanitize";

/**
 * The single sanctioned way to render stored rich text. Sanitises on every
 * render (defence in depth — covers rows written before the sanitiser existed).
 */
export function RichText({ html, className }: { html: string | null | undefined; className?: string }) {
  const safe = renderableHtml(html);
  if (!safe) return null;
  return <div className={`story-body ${className ?? ""}`.trim()} dangerouslySetInnerHTML={{ __html: safe }} />;
}

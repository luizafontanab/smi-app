"use client";

import dynamic from "next/dynamic";

/**
 * Lazy wrapper: TipTap (+ prosemirror) is the heaviest client dependency in
 * the app and was statically bundled into every console and dashboard editor
 * route. Same pattern as MemberMap — the real editor lives in
 * RichTextEditorImpl and its chunk loads only when a form actually renders
 * one. ssr:false is fine here: every use is behind auth on noindexed pages,
 * and the editor is interactive-only.
 */
export const RichTextEditor = dynamic(
  () => import("./RichTextEditorImpl").then((m) => m.RichTextEditor),
  {
    ssr: false,
    loading: () => <div className="min-h-48 animate-pulse rounded border bg-graphite/5" />,
  }
);

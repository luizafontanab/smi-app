"use client";

/** Social share links for the current page (live-site parity on story pages). */
export function ShareButtons() {
  const share = (base: string) => {
    const url = encodeURIComponent(window.location.href);
    window.open(`${base}${url}`, "_blank", "noopener,width=600,height=440");
  };
  const BTN = "rounded border px-3 py-1.5 text-xs text-graphite hover:bg-shade";
  return (
    <div className="mt-6 flex items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-graphite">Share</span>
      <button type="button" className={BTN} onClick={() => share("https://www.facebook.com/sharer/sharer.php?u=")}>Facebook</button>
      <button type="button" className={BTN} onClick={() => share("https://twitter.com/intent/tweet?url=")}>X</button>
      <button type="button" className={BTN} onClick={() => share("https://www.linkedin.com/sharing/share-offsite/?url=")}>LinkedIn</button>
    </div>
  );
}

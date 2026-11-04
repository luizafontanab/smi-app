"use client";

/** Social share links for the current page (live-site parity on story pages). */
export function ShareButtons() {
  const share = (base: string) => {
    const url = encodeURIComponent(window.location.href);
    window.open(`${base}${url}`, "_blank", "noopener,width=600,height=440");
  };
  // tap + text-sm below sm: these were ~30px pills of 12px text on a phone (#33 C16)
  const BTN = "tap rounded border px-3 py-1.5 text-sm text-graphite hover:bg-shade sm:text-xs";
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-graphite">Share</span>
      <button type="button" className={BTN} onClick={() => share("https://www.facebook.com/sharer/sharer.php?u=")}>Facebook</button>
      <button type="button" className={BTN} onClick={() => share("https://twitter.com/intent/tweet?url=")}>X</button>
      <button type="button" className={BTN} onClick={() => share("https://www.linkedin.com/sharing/share-offsite/?url=")}>LinkedIn</button>
    </div>
  );
}

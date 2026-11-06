import Image from "next/image";
import Link from "next/link";
import { mediaUrl } from "@/lib/db/server";
import { focusStyle } from "@/lib/focus";

/*
 * PROTOTYPE (issue #63). Live-site pieces the no-counterpart pages are built
 * from, taken from the research on #58: the orange-disc section title, the
 * white 5px panel, the live news card (image with a blue chevron square,
 * uppercase title, grey meta) and the photo banner with a white title.
 * Accessibility departures as on #59: ink on orange, #666 meta grey.
 */
export const BLUE = "#3100ff";

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) : "";

export function DiscHeading({ icon, children, as: Tag = "h2", size = "text-[2rem]" }: { icon: string; children: React.ReactNode; as?: "h1" | "h2"; size?: string }) {
  return (
    <Tag className={`inline-flex items-center gap-4 font-normal text-black ${size}`}>
      <span aria-hidden="true" className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand text-2xl">{icon}</span>
      {children}
    </Tag>
  );
}

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[5px] bg-white p-5 shadow-[0_5px_25px_rgb(0_0_0/0.05)] sm:p-8 ${className}`}>{children}</div>;
}

export function BlueButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-block rounded-[5px] bg-[#3100ff] px-6 py-3 text-white hover:bg-brand hover:text-ink">
      {children}
    </Link>
  );
}

export function LiveCard({ href, title, image, focus, meta, kicker }: {
  href: string; title: string; image: string | null; focus?: unknown; meta: (string | null | undefined)[]; kicker?: string | null;
}) {
  return (
    <Link href={href} className="group block">
      <div className="relative aspect-[3/2] overflow-hidden rounded-[5px] bg-graphite/15">
        {image && <Image src={image} alt="" fill sizes="(max-width: 768px) 100vw, 25vw" style={focusStyle(focus)} className="object-cover" unoptimized />}
        {kicker && <span className="absolute left-0 top-0 rounded-br-[5px] bg-ink px-2 py-1 text-xs uppercase text-white">{kicker}</span>}
        <span aria-hidden="true" className="absolute bottom-0 right-0 grid h-10 w-10 place-items-center rounded-tl-[5px] bg-[#3100ff] text-white group-hover:bg-brand group-hover:text-ink">›</span>
      </div>
      <h3 className="mt-4 line-clamp-4 text-lg uppercase leading-snug text-black group-hover:underline">{title}</h3>
      {meta.filter(Boolean).map((m) => (
        <p key={m} className="mt-1 text-sm uppercase text-[#666]">{m}</p>
      ))}
    </Link>
  );
}

/** The live site's page banner: full-width photo, white title bottom-left over a dark wash. */
export function Banner({ image, focus, eyebrow, title, children }: { image: string | null; focus?: unknown; eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="relative h-[280px] w-full overflow-hidden bg-ink">
      {image && <Image src={image} alt="" fill sizes="100vw" style={focusStyle(focus)} className="object-cover opacity-70" unoptimized priority />}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
      <div className="relative mx-auto flex h-full max-w-6xl flex-col justify-end px-4 pb-10">
        {eyebrow && <p className="text-sm uppercase tracking-wide text-brand">{eyebrow}</p>}
        <h1 className="text-[2.5rem] font-normal leading-tight text-white sm:text-[3.25rem]">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export const cover = (path: string | null | undefined) => mediaUrl(path ?? null);

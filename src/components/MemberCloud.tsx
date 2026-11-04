import Image from "next/image";
import Link from "next/link";
import { buildCloud, CARD_H, cloudSample, TOUCH_CAP, type CloudItem, type CloudPlacement } from "@/lib/cloud-layout";
import { seededRand } from "@/lib/seeded-rand";
import { CloudRefine } from "./CloudRefine";

/**
 * The member directory's `?view=cloud` — every matching member's name packed
 * into a word map, featured names large and orange, the rest small and black,
 * each revealing its logo on hover.
 *
 * A Server Component on purpose. The packing is pure (lib/cloud-layout) so it
 * runs during the server render, which means the cloud is real HTML: it works
 * with JS off, axe sees the finished page, and there is no layout shift on
 * hydration. The only client code is CloudTouch, which adds the two-tap
 * behaviour touch devices need and nothing else.
 *
 * Positions are container-query units written as CSS custom properties, so the
 * browser rescales the whole cloud with its container. A uniform scale cannot
 * introduce an overlap, which is why there is no resize handler here.
 */

export type CloudMember = CloudItem & { logoUrl: string | null };

const CLOUD_ID = "member-cloud";
/** Entrance stagger caps here, so 300 members still finish in half a second. */
const STAGGER_CAP = 40;

/**
 * A capped packing: lays out only `cloudSample`'s subset, and maps each
 * member's index to its placement, or nothing when it is not drawn there.
 */
function sampled(members: CloudMember[], seed: string, bucket: "narrow" | "touch") {
  const picked = cloudSample(members, TOUCH_CAP[bucket]);
  const cloud = buildCloud(picked.map((i) => members[i]), { seed, bucket });
  const byMember = new Map<number, { k: number; p: CloudPlacement }>(picked.map((i, k) => [i, { k, p: cloud.placements[k] }]));
  return { height: cloud.height, byMember, capped: picked.length < members.length };
}

const cardY = (p: CloudPlacement) => (p.cardBelow ? p.s * 1.2 + 0.8 : -(CARD_H + 0.8));

export function MemberCloud({ members, seed, listHref = "/member" }: {
  members: CloudMember[];
  seed: string;
  /** Where the "see everyone" note on touch screens points — the list view with the same filters. */
  listHref?: string;
}) {
  if (members.length === 0) return null;

  // Three independent packings. Narrow (phones) and touch (tablets) are not the
  // wide one scaled down: the CSS font-size floor stops the smallest names
  // shrinking past 13px, which would close the gaps a scaled layout depends on.
  // Both touch packings draw a capped sample, not the whole directory (#33).
  const wide = buildCloud(members, { seed, bucket: "wide" });
  const narrow = sampled(members, seed, "narrow");
  const touch = sampled(members, seed, "touch");
  const drift = seededRand(`${seed}|drift`);

  // Alphabetical tab order over a seeded visual order — the two are fully
  // decoupled, so screen-reader and keyboard traversal stays predictable even
  // though the picture is deliberately scattered.
  const order = members.map((_, i) => i).sort((a, b) => members[a].name.localeCompare(members[b].name));

  const cloud = (
    <div
      id={CLOUD_ID}
      className="member-cloud mt-6"
      style={{ "--cloud-h": wide.height, "--cloud-hn": narrow.height, "--cloud-ht": touch.height } as React.CSSProperties}
    >
      <ul>
        {order.map((i, tabIndex) => {
          const m = members[i];
          const w = wide.placements[i];
          const n = narrow.byMember.get(i);
          const t = touch.byMember.get(i);
          return (
            <li
              key={m.slug}
              className="cloud-item"
              // The visual order is seeded and the DOM order is alphabetical;
              // this is what lets the refine pass map one back to the other.
              data-i={i}
              data-featured={m.featured ? "true" : undefined}
              data-drift={w.drift ? "true" : undefined}
              // Index into each capped packing; absent = not drawn at that
              // size, which the CSS turns into display:none (#33).
              data-n={n?.k}
              data-t={t?.k}
              style={
                {
                  // Card sits above the name unless it would leave the container.
                  "--x": w.x, "--y": w.y, "--s": w.s, "--cx": w.cardDx, "--cy": cardY(w),
                  ...(n && { "--xn": n.p.x, "--yn": n.p.y, "--sn": n.p.s, "--cxn": n.p.cardDx, "--cyn": cardY(n.p) }),
                  ...(t && { "--xt": t.p.x, "--yt": t.p.y, "--st": t.p.s, "--cxt": t.p.cardDx, "--cyt": cardY(t.p) }),
                  "--i": Math.min(tabIndex, STAGGER_CAP),
                  // Seeded so the drift is out of phase from the first frame
                  // rather than pulsing in unison.
                  "--dx": `${(drift() * 2 - 1).toFixed(2)}px`,
                  "--dy": `${(drift() * 2 - 1).toFixed(2)}px`,
                  "--dur": `${(18 + drift() * 16).toFixed(1)}s`,
                  "--delay": `-${(drift() * 20).toFixed(1)}s`,
                } as React.CSSProperties
              }
            >
              {/* No trailing slash: e2e selects a[href^='/member/']. */}
              {/* Deliberately not `.tap`: it forces a 44px min-height, which a
                  hundred-plus names cannot each spend. The narrow packing
                  reserves the touch target in its line height instead. */}
              <Link href={`/member/${m.slug}`} prefetch={false} className="cloud-name">
                {m.name}
              </Link>
              {/* aria-hidden and text-free: the link already carries the
                  accessible name, and a decorative logo must not repeat it.
                  pointer-events:none in CSS so a card overlapping a neighbour
                  can never swallow its click. */}
              <span className="cloud-card" aria-hidden="true">
                {m.logoUrl ? (
                  // `fill` against the card, which is already sized in cqw —
                  // fixed width/height would fight the container-relative box
                  // and next/image warns when only one of them is overridden.
                  <Image src={m.logoUrl} alt="" fill sizes="120px" loading="lazy" unoptimized className="object-contain" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-graphite/10 text-2xl text-graphite/30">⚙</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <CloudRefine containerId={CLOUD_ID} seed={seed} />
    </div>
  );
  // The note only shows where a capped packing is in force (CSS, same media
  // queries as the packings), so desktop never sees it.
  const sample = (bucket: "narrow" | "touch", shown: number) => (
    <p data-cloud-note={bucket} className="cloud-note mt-4 text-center text-sm text-graphite">
      Showing {shown} of {members.length} members.{" "}
      <Link href={listHref} className="tap font-semibold text-ink underline">See them all in the list</Link>
    </p>
  );
  return (
    <>
      {cloud}
      {narrow.capped && sample("narrow", narrow.byMember.size)}
      {touch.capped && sample("touch", touch.byMember.size)}
    </>
  );
}

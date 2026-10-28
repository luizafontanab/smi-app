import { IconExternal, IconGlobe, IconLink, IconPhone } from "@/components/icons";
import { SOCIAL_BRAND_COLOURS, SocialIcon } from "@/components/social-icons";
import { memberLinks, type MemberLink } from "@/lib/member-links";

/**
 * The member profile's "Links" box: website, phone and socials as one list of
 * full-width rows, each with the platform's logo on its brand colour, so it
 * reads as a set of buttons rather than a list of text. Replaces the header's
 * Website/Call buttons and the old text-only "Follow" box. No client JS.
 */
export function MemberLinks({ member }: { member: Parameters<typeof memberLinks>[0] }) {
  const links = memberLinks(member);
  if (!links.length) return null;
  return (
    <section aria-labelledby="member-links" className="rounded-lg bg-white p-4 shadow-sm">
      <h3 id="member-links" className="font-bold text-ink">Links</h3>
      <ul className="mt-3 space-y-2">
        {links.map((l) => (
          <li key={l.key}>
            <LinkRow link={l} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function LinkTile({ link }: { link: MemberLink }) {
  // Social glyphs sit white on their own brand colour; website/phone/unknown
  // take SMI's brand orange on ink (7.4:1).
  if (link.channel) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white" style={{ backgroundColor: SOCIAL_BRAND_COLOURS[link.channel] }}>
        <SocialIcon channel={link.channel} className="h-[18px] w-[18px]" />
      </span>
    );
  }
  const Icon = link.kind === "website" ? IconGlobe : link.kind === "phone" ? IconPhone : IconLink;
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink text-brand">
      <Icon width={20} height={20} />
    </span>
  );
}

function LinkRow({ link }: { link: MemberLink }) {
  const text = (
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold text-ink">{link.label}</span>
      {link.detail && <span className="block truncate text-xs text-graphite">{link.detail}</span>}
    </span>
  );

  // A stored value that resolves to nothing linkable: shown so the info isn't
  // lost, but with no border, hover or arrow — it must not look like a button.
  if (!link.href) {
    return (
      <div className="flex min-h-11 items-center gap-3 px-3 py-2 opacity-70">
        <LinkTile link={link} />
        {text}
      </div>
    );
  }

  const name = [link.label, link.detail].filter(Boolean).join(": ");
  return (
    <a
      href={link.href}
      {...(link.external ? { target: "_blank", rel: "noopener", "aria-label": `${name} (opens in a new tab)` } : { "aria-label": name })}
      className="group flex min-h-11 items-center gap-3 rounded-lg border border-line bg-white px-3 py-2 transition-colors hover:border-ink hover:bg-shade focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <LinkTile link={link} />
      {text}
      {link.external && (
        <IconExternal width={16} height={16} className="shrink-0 text-graphite transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink motion-reduce:transition-none" />
      )}
    </a>
  );
}

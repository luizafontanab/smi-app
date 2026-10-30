import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Whether a URL points at the public internet — for fetches whose URL comes
 * from a third-party page (an article's og:image), which could otherwise aim
 * our server at its own network: localhost, a cloud metadata address, a
 * private range. Every address the host resolves to must be public.
 *
 * Not proof against DNS rebinding (the name re-resolving between this check
 * and the fetch); it closes the plain cases: literal IPs and names that
 * resolve to private addresses.
 */

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(net, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  // "::ffff:10.0.0.1" is IPv4 in IPv6 clothing: judge the IPv4 part.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped ? mapped[1] : address;
  const family = isIP(ip);
  if (!family) return false;
  return !blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}

export async function isPublicUrl(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return false;
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address));
  } catch {
    return false;
  }
}

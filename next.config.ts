import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Supabase serves both the REST/auth API and the public `media` bucket, so its
 * origin has to be reachable for images and XHR. Derived from the same variable
 * the clients use, so it follows the project without a second place to edit.
 */
const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return "";
  }
})();

/**
 * Content Security Policy.
 *
 * `script-src` deliberately keeps 'unsafe-inline': Next's hydration bootstrap
 * is inline, and moving to a nonce means threading one through proxy.ts and
 * every inline script. That is the right next step, but it is a change with
 * real breakage risk and it is not what the header is here for today. The
 * directives that ARE doing work — and that cost nothing to enable — are:
 *
 *   frame-ancestors 'none'  clickjacking (the console and member area are the
 *                           targets worth framing)
 *   object-src 'none'       no Flash/PDF plugin embedding
 *   base-uri 'self'         an injected <base> can't repoint every relative URL
 *   form-action 'self'      an injected form can't post credentials off-site
 *
 * style-src needs 'unsafe-inline' for Tailwind's injected styles and the
 * per-element styles in global-error.tsx.
 */
// Dev-only allowance so impeccable live mode can load. Guarded by NODE_ENV.
const __impeccableLiveDev = isDev ? " http://localhost:8400" : "";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${__impeccableLiveDev}`,
  "style-src 'self' 'unsafe-inline'",
  // tile.openstreetmap.org: the raster tiles behind MemberMap's Leaflet view (A6.4).
  `img-src 'self' data: blob: https://*.tile.openstreetmap.org${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  "font-src 'self' data:",
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""}${isDev ? " ws: wss:" : ""}${__impeccableLiveDev}`,
  "media-src 'self' https:",
  // nocookie is what /video/[slug] embeds — same player, no ad cookies before consent
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  // Vercel sets HSTS itself, but the app should not depend on the host for it.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

/**
 * WordPress URLs that map to a new home by pattern alone.
 *
 * Anything resolvable without a database lookup belongs here rather than in the
 * root-slug catch-all: these are matched before routing and before proxy.ts, so
 * they never touch Supabase and never hit the auth gate. The one shape that
 * CANNOT live here is the old site's root-level article (`/{slug}/`) — no
 * pattern matches it without swallowing every other page — so that one is
 * resolved by src/app/(public)/[slug]/page.tsx instead.
 *
 * `permanent: true` emits 308. Vercel caps this list at 1,024 entries; we are
 * two orders of magnitude under, and it must stay that way — a per-article map
 * would blow the cap, which is exactly why the catch-all exists.
 */
const legacyRedirects = [
  // sections we renamed to match the old site's singular paths
  { source: "/find-a-member", destination: "/member", permanent: true },
  { source: "/members", destination: "/member", permanent: true },
  { source: "/members/:slug", destination: "/member/:slug", permanent: true },
  { source: "/videos", destination: "/video", permanent: true },
  { source: "/videos/:slug", destination: "/video/:slug", permanent: true },
  { source: "/events", destination: "/event", permanent: true },
  { source: "/events/:slug", destination: "/event/:slug", permanent: true },

  // entry points that changed name
  { source: "/become-a-member", destination: "/join", permanent: true },
  { source: "/members-login", destination: "/login", permanent: true },

  // standalone pages now served from the static_pages CMS. Slugs there are flat,
  // so the old nesting under /contact and /advertising is flattened too.
  { source: "/about", destination: "/pages/about", permanent: true },
  { source: "/policies", destination: "/pages/policies", permanent: true },
  { source: "/mach-publication", destination: "/pages/mach-publication", permanent: true },
  { source: "/what-is-a-member-microsite", destination: "/pages/what-is-a-member-microsite", permanent: true },
  {
    source: "/contact/press-release-submissions-guide",
    destination: "/pages/press-release-submissions-guide",
    permanent: true,
  },
  {
    source: "/advertising/require-banner-design-help",
    destination: "/pages/require-banner-design-help",
    permanent: true,
  },

  // the year archives were WordPress pages; issues now hang off /newsletters itself
  { source: "/newsletters/2022-newsletters", destination: "/newsletters", permanent: true },
  { source: "/newsletters/2023-2", destination: "/newsletters", permanent: true },
  { source: "/newsletters/2024-newsletters", destination: "/newsletters", permanent: true },

  // Taxonomy archives we have not rebuilt (54 services, 4 levels, 58 tags, …).
  // Pointing them at the nearest section keeps their inbound links alive; when
  // the member taxonomy lands, the first four of these become real pages and
  // these rules come out.
  { source: "/best-service/:slug", destination: "/member", permanent: true },
  { source: "/best-level/:slug", destination: "/member", permanent: true },
  { source: "/event-type/:slug", destination: "/event", permanent: true },
  { source: "/tag/:slug", destination: "/news", permanent: true },
  { source: "/category/:slug", destination: "/news", permanent: true },
  { source: "/author/:slug", destination: "/news", permanent: true },
  { source: "/team-member/:slug", destination: "/pages/about", permanent: true },
];

const nextConfig: NextConfig = {
  /**
   * Normally `.next`. The visual-regression suite (tests/visual) sets this to
   * `.next-visual` so its production build does not clean out the `.next` the
   * long-lived dev server is using — `next build` wipes the dist dir, which
   * would kill a running `pnpm dev` (and any parallel session sharing this
   * tree). Unset everywhere else, so dev/build/start/CI/Vercel are unaffected.
   */
  distDir: process.env.VISUAL_DIST_DIR || ".next",
  /**
   * The visual suite builds only in order to photograph the result, and this is
   * a shared working tree — a half-finished edit in some unrelated file should
   * not stop a screenshot run. Type errors remain a hard failure for `pnpm build`
   * and `pnpm check`, which is where they belong. Scoped to the visual env var,
   * so a normal build is unaffected.
   */
  typescript: { ignoreBuildErrors: !!process.env.VISUAL_DIST_DIR },
  // Playwright drives the app via 127.0.0.1; without this the dev server 403s
  // client chunks/HMR for that origin (only `localhost` is allowed by default)
  allowedDevOrigins: ["127.0.0.1"],
  /**
   * Every upload in this app goes through a server action, and the default
   * body limit is 1MB — so `uploadImage`'s 8MB cap and `uploadDocument`'s 20MB
   * cap could never actually be reached: a larger file 500'd with "Body
   * exceeded 1 MB limit" into the error boundary instead of the readable
   * message the form is written to show. 22mb covers the document cap plus the
   * multipart overhead the docs warn about.
   */
  experimental: {
    serverActions: { bodySizeLimit: "22mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      // join flow became multi-step; the old single-form checkout URL retires
      { source: "/join/checkout", destination: "/join/account", permanent: true },
      // advertise + buy-visibility merged into the advertising hub (fix list item 10);
      // non-permanent — member-area IA, not SEO
      { source: "/dashboard/buy", destination: "/dashboard/advertising/buy", permanent: false },
      { source: "/dashboard/advert/new", destination: "/dashboard/advertising/buy", permanent: false },
      ...legacyRedirects,
    ];
  },
};

export default nextConfig;

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
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  "font-src 'self' data:",
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""}${isDev ? " ws: wss:" : ""}`,
  "media-src 'self' https:",
  "frame-src 'self' https://www.youtube.com https://player.vimeo.com",
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

const nextConfig: NextConfig = {
  // Playwright drives the app via 127.0.0.1; without this the dev server 403s
  // client chunks/HMR for that origin (only `localhost` is allowed by default)
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      // join flow became multi-step; the old single-form checkout URL retires
      { source: "/join/checkout", destination: "/join/account", permanent: true },
    ];
  },
};

export default nextConfig;

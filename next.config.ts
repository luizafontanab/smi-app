import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright drives the app via 127.0.0.1; without this the dev server 403s
  // client chunks/HMR for that origin (only `localhost` is allowed by default)
  allowedDevOrigins: ["127.0.0.1"],
  async redirects() {
    return [
      // join flow became multi-step; the old single-form checkout URL retires
      { source: "/join/checkout", destination: "/join/account", permanent: true },
    ];
  },
};

export default nextConfig;

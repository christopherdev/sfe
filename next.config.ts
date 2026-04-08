import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactCompiler: false,
  // CRITICAL: there's a stray package-lock.json in /home/xburz/Development/
  // that makes Next infer the wrong workspace root, which silently breaks
  // Turbopack module resolution and React hydration in dev mode. Pinning the
  // root here forces Next to use this project as the workspace root.
  turbopack: {
    root: path.resolve(__dirname),
  },
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS
    ? process.env.ALLOWED_DEV_ORIGINS.split(",")
    : [],
  async headers() {
    // Skip restrictive security headers in dev — Next.js HMR, React DevTools,
    // inline RSC streaming scripts, and browser Permissions-Policy all need
    // looser rules than prod. Production still gets the full lockdown.
    if (process.env.NODE_ENV !== "production") {
      return [];
    }
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // NO Strict-Transport-Security header. This app is currently served
          // over plain HTTP on a LAN IP without TLS. Sending HSTS pins the
          // browser to HTTPS on this host for up to 2 years, silently breaking
          // all subsequent HTTP access. Only re-add HSTS once we're serving
          // real HTTPS behind a valid certificate.
          {
            key: "Content-Security-Policy",
            // Google Maps JS API surface covered below:
            //   - scripts from maps.googleapis.com + maps.gstatic.com
            //   - Web Workers via blob: URLs (tile rendering, geometry)
            //   - style metadata (CompactLegendSdk, FetchableStyleSet) from
            //     www.gstatic.com (both script AND connect)
            //   - tiles + sprites from *.gstatic.com and maps.googleapis.com
            // Cloudflare Web Analytics injects its beacon at
            // static.cloudflareinsights.com.
            // Google Fonts CSS comes from fonts.googleapis.com, files from
            // fonts.gstatic.com.
            value:
              "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://maps.googleapis.com https://maps.gstatic.com https://static.cloudflareinsights.com; " +
              "worker-src 'self' blob:; " +
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
              "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://maps.gstatic.com https://maps.googleapis.com; " +
              "font-src 'self' https://fonts.gstatic.com; " +
              "connect-src 'self' https://maps.googleapis.com https://*.googleapis.com https://*.gstatic.com https://static.cloudflareinsights.com https://cloudflareinsights.com; " +
              "frame-ancestors 'none'",
          },
          {
            key: "Permissions-Policy",
            // Note: geolocation=(self) so the browser permission prompt can
            // still be shown when the user searches for nearby restaurants.
            value: "camera=(), microphone=(), geolocation=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

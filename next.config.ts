import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// Static export for GitHub Pages is opt-in; the default build targets a Node host such as Vercel.
const pages = process.env.DEPLOY_TARGET === "pages";

// Same-origin proxy for analytics (lib/analytics.ts): tracking blockers filter by domain, and a
// same-origin path survives them. Static and array must precede the catch-all. A static export
// cannot rewrite, so the Pages deploy names the vendor host instead. No traffic until a key is set.
const analyticsRewrites = [
  { source: "/ingest/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
  { source: "/ingest/array/:path*", destination: "https://us-assets.i.posthog.com/array/:path*" },
  { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
];

const nextConfig: NextConfig = {
  // Pinned at build time so a build without a key resolves to "" and the analytics import is dead code.
  // Left to the bundler, an unset variable stays a runtime lookup and the SDK chunk is still emitted.
  env: {
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "",
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "",
  },
  ...(pages
    ? { output: "export", trailingSlash: true, images: { unoptimized: true }, basePath: process.env.PAGES_BASE_PATH ?? "" }
    : {
        async headers() { return [{ source: "/:path*", headers: securityHeaders }]; },
        async rewrites() { return analyticsRewrites; },
        // Analytics endpoints end in "/" (such as /e/); the trailing-slash redirect would drop events.
        skipTrailingSlashRedirect: true,
      }),
};

export default nextConfig;

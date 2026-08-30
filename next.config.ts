import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Menu photos live in Supabase Storage, so next/image must be told that host is
// allowed — without a matching remotePattern every image returns 400. Derived
// from the env var rather than hardcoding the project ref, so a staging project
// or a restored database works without a code change.
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

// New uploads go to Cloudinary — Supabase's remotePattern stays too, since
// existing images (uploaded before this change) still point at supabase.co
// URLs until the migration script moves them.
const cloudinaryEnabled = Boolean(process.env.CLOUDINARY_CLOUD_NAME);

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      ...(supabaseHost
        ? [{ protocol: "https" as const, hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
        : []),
      ...(cloudinaryEnabled
        ? [{ protocol: "https" as const, hostname: "res.cloudinary.com", pathname: "/**" }]
        : []),
    ],
    // Required from Next 16 onward: only these quality values may be requested.
    // 65 for grid thumbnails (the bulk of the payload on a 300-item menu over
    // Indian mobile data), 85 for the detail sheet's large hero image.
    qualities: [65, 85],
    // Uploads are written as `<uuid>.webp` and never overwritten, so an
    // optimized variant can be cached indefinitely — the URL changes whenever
    // the image does.
    minimumCacheTTL: 31536000,
  },

  // Security headers (audit F-04). A strict Content-Security-Policy is
  // deliberately NOT set here: it needs a nonce pass over the app's inline
  // styles first, and a broken CSP fails closed on a live café's till. These
  // are the headers that are safe to apply unconditionally.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};

// org/project/authToken are all optional — without SENTRY_AUTH_TOKEN the
// plugin just skips the source-map upload step and the build proceeds
// normally, so this is safe to deploy before a Sentry project exists.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
});

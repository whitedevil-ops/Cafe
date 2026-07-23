import type { NextConfig } from "next";

// Menu photos live in Supabase Storage, so next/image must be told that host is
// allowed — without a matching remotePattern every image returns 400. Derived
// from the env var rather than hardcoding the project ref, so a staging project
// or a restored database works without a code change.
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseHost
      ? [
          {
            protocol: "https",
            hostname: supabaseHost,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
    // Required from Next 16 onward: only these quality values may be requested.
    // 65 for grid thumbnails (the bulk of the payload on a 300-item menu over
    // Indian mobile data), 85 for the detail sheet's large hero image.
    qualities: [65, 85],
    // Uploads are written as `<uuid>.webp` and never overwritten, so an
    // optimized variant can be cached indefinitely — the URL changes whenever
    // the image does.
    minimumCacheTTL: 31536000,
  },
};

export default nextConfig;

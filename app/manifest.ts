import type { MetadataRoute } from 'next'

// Next's native manifest route convention — auto-serves at
// /manifest.webmanifest and auto-injects the <link rel="manifest"> tag, no
// manual wiring in app/layout.tsx needed (same pattern as app/icon.png,
// app/robots.ts, app/sitemap.ts already use in this repo).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'KhaoPiyo — Café & Restaurant POS',
    short_name: 'KhaoPiyo',
    description:
      'Cloud POS billing for cafés and restaurants — QR ordering, GST invoicing, inventory, CRM and loyalty.',
    start_url: '/dashboard',
    display: 'standalone',
    // Brand tokens (app/globals.css :root), not invented colors.
    background_color: '#FAF6EF',
    theme_color: '#C2410C',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}

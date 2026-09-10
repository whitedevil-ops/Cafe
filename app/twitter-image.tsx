import { ImageResponse } from 'next/og'

// Same card as opengraph-image.tsx, duplicated rather than re-exported
// because Next's file-convention resolution reads size/contentType/the
// default export directly from this file — a re-export doesn't reliably
// register as its own route. See opengraph-image.tsx for why this exists.

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-start',
          background: '#FAF6EF',
          padding: '80px 96px',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '10px 22px',
            borderRadius: 999,
            border: '2px solid #C2410C',
            color: '#C2410C',
            fontSize: 28,
            fontWeight: 600,
          }}
        >
          KhaoPiyo
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 44,
            fontSize: 68,
            fontWeight: 700,
            lineHeight: 1.12,
            color: '#241D15',
            maxWidth: 920,
          }}
        >
          POS &amp; billing software for cafés and restaurants
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 32,
            fontSize: 30,
            color: '#5B5044',
            maxWidth: 880,
          }}
        >
          QR ordering, GST invoicing, kitchen display and inventory — built for India.
        </div>
      </div>
    ),
    { ...size }
  )
}

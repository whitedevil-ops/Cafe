// One-off script, not part of the build — generates the PWA icon set from
// the existing 512x512 brand mark. Run once (`node scripts/generate-pwa-icons.mjs`)
// whenever the source logo changes; the outputs are checked in like any
// other static asset.
import sharp from 'sharp'

const SRC = 'public/logo-mark.png'
const OUT = 'public/icons'

await sharp(SRC).resize(192, 192).png().toFile(`${OUT}/icon-192.png`)
await sharp(SRC).resize(512, 512).png().toFile(`${OUT}/icon-512.png`)

// Maskable icon: the source logo bleeds close to all four edges with no
// margin (confirmed by inspection), which Android's adaptive-icon masks
// (circle/squircle/rounded-square — none of them are the full square) would
// crop into the K-bar and the steam wisps. Composite the mark at ~65% scale,
// centered on a plain white canvas matching its own background, so the
// meaningful content sits inside the safe zone regardless of mask shape.
const SCALE = 0.65
const inner = Math.round(512 * SCALE)
const resizedMark = await sharp(SRC).resize(inner, inner).toBuffer()
await sharp({
  create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
})
  .composite([{ input: resizedMark, gravity: 'center' }])
  .png()
  .toFile(`${OUT}/icon-512-maskable.png`)

console.log('Generated public/icons/icon-192.png, icon-512.png, icon-512-maskable.png')

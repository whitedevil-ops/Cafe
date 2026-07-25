// One-off admin script: attach a representative CC0 (public-domain, zero
// attribution required) stock photo to every menu item that doesn't have one
// yet. Uses the service role key to bypass RLS (writes into any café's
// storage folder + menu_items in one pass, instead of per-item dashboard
// uploads). Run with:
//   node --env-file=.env.local scripts/seed-menu-images.mjs [--cafe=<uuid>] [--dry-run]
//
// Images come from Openverse (api.openverse.org), filtered to license=cc0
// only, so nothing here needs attribution. Each image is resized/re-encoded
// with sharp to the same 1024px-edge webp @ q82 pipeline lib/image-upload.ts
// uses for browser uploads, so results stay under the bucket's 2MB cap.

import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.')
  process.exit(1)
}

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const cafeArg = args.find((a) => a.startsWith('--cafe='))
const CAFE_ID = cafeArg ? cafeArg.slice('--cafe='.length) : 'c0ffee00-0000-4000-a000-000000000001'

const MAX_EDGE = 1024
const MAX_BYTES = 2 * 1024 * 1024
const DELAY_MS = 350

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// Curated search term(s) per item name — the raw menu name is often too
// specific (brand names, qualifiers) or too generic to reliably surface a
// well-matched CC0 photo, so each entry picks 1-2 better queries, tried in
// order until one yields a usable image.
const QUERY_MAP = {
  'Alfredo Pasta': ['alfredo pasta'],
  'Aloo Tikki Chaat': ['aloo tikki chaat', 'indian potato patty'],
  Americano: ['americano coffee'],
  'Arrabbiata Pasta': ['arrabbiata pasta', 'penne tomato sauce'],
  'Blue Lagoon': ['blue lagoon mocktail', 'blue cocktail drink'],
  'Bombay Masala Sandwich': ['grilled sandwich', 'toasted sandwich'],
  Brownie: ['chocolate brownie'],
  'Brownie with Ice Cream': ['brownie ice cream'],
  'Butterscotch Shake': ['butterscotch milkshake', 'milkshake glass'],
  'Cafe Latte': ['cafe latte'],
  'Café Latte': ['cafe latte'],
  'Cafe Mocha': ['mocha coffee'],
  Cappuccino: ['cappuccino'],
  'Caramel Frappe': ['caramel frappe', 'iced coffee caramel'],
  'Caramel Latte': ['caramel latte'],
  'Cheese Burger': ['cheeseburger'],
  'Cheese Corn Pizza': ['corn pizza', 'cheese pizza'],
  'Cheese Corn Sandwich': ['grilled cheese sandwich'],
  'Cheese Corn Wrap': ['vegetable wrap roll', 'tortilla wrap', 'burrito wrap'],
  'Cheese Fries': ['cheese fries'],
  'Cheese Garlic Bread': ['cheese garlic bread'],
  'Cheese Maggi': ['instant noodles bowl'],
  'Cheese Nachos': ['nachos cheese'],
  'Cheesy Baked Pasta': ['baked pasta cheese'],
  'Cheesy Fries': ['cheese fries'],
  'Chilli Paneer': ['chilli paneer'],
  'Chocolate Brownie': ['chocolate brownie'],
  'Chocolate Ice Cream': ['chocolate ice cream'],
  'Chocolate Lava Cake': ['chocolate lava cake', 'molten chocolate cake'],
  'Chocolate Shake': ['chocolate milkshake'],
  'Chocolate Sundae': ['chocolate sundae', 'ice cream sundae'],
  'Chole Kulche': ['chole kulche', 'chole bhature'],
  'Classic Cold Coffee': ['cold coffee glass'],
  'Classic French Fries': ['french fries'],
  'Classic Maggi': ['instant noodles bowl'],
  'Classic Veg Burger': ['veggie burger'],
  'Club Sandwich': ['club sandwich'],
  'Coca Cola': ['cola bottle drink'],
  'Cold Coffee': ['cold coffee glass'],
  'Corn & Cheese Pizza': ['corn pizza'],
  'Crispy Aloo Burger': ['potato burger', 'veggie burger'],
  'Dahi Papdi Chaat': ['papdi chaat', 'indian chaat'],
  'Diet Coke': ['diet cola can', 'soda can', 'soft drink can'],
  'Double Cheese Burger': ['cheeseburger double'],
  'Double Patty Burger': ['double burger'],
  'Elaichi Tea': ['masala chai', 'indian tea cup'],
  Espresso: ['espresso shot'],
  Farmhouse: ['vegetable pizza'],
  'Farmhouse Pizza': ['vegetable pizza'],
  'Flat White': ['flat white coffee'],
  'French Fries': ['french fries'],
  'Fresh Lime Soda': ['lime soda drink'],
  'Fried Momos': ['fried dumplings', 'fried momos'],
  'Garlic Bread': ['garlic bread'],
  'Ginger Tea': ['ginger tea cup'],
  'Green Apple Mojito': ['green apple mojito', 'mojito mocktail'],
  'Green Tea': ['green tea cup'],
  'Hazelnut Cold Coffee': ['iced coffee glass'],
  'Hazelnut Latte': ['latte coffee cup'],
  'Honey Chilli Potato': ['crispy fried potato', 'honey chilli potato'],
  'Hot Chocolate': ['hot chocolate cup'],
  'Iced Americano': ['iced coffee americano'],
  'Iced Latte': ['iced latte'],
  'Iced Mocha': ['iced mocha coffee'],
  'KitKat Shake': ['chocolate milkshake'],
  'Lemon Iced Tea': ['iced tea lemon', 'iced tea glass', 'cold tea drink'],
  'Lemon Tea': ['lemon tea cup', 'black tea cup', 'tea cup lemon'],
  'Loaded Fries': ['loaded fries'],
  'Mango Shake': ['mango milkshake'],
  Margherita: ['margherita pizza'],
  'Margherita Pizza': ['margherita pizza'],
  'Masala Chai': ['masala chai', 'indian tea cup'],
  Mocha: ['mocha coffee'],
  'Mocha Frappe': ['mocha frappe', 'iced coffee chocolate'],
  'New York Cheesecake': ['new york cheesecake'],
  'Oreo Shake': ['oreo milkshake', 'chocolate cookie milkshake'],
  'Packaged Water': ['water bottle'],
  'Paneer Tikka': ['paneer tikka'],
  'Paneer Tikka Burger': ['veggie burger', 'paneer burger'],
  'Paneer Tikka Pizza': ['vegetable pizza'],
  'Paneer Tikka Sandwich': ['grilled sandwich'],
  'Paneer Tikka Wrap': ['wrap roll', 'kathi roll', 'tortilla wrap'],
  'Pav Bhaji': ['pav bhaji'],
  'Peach Iced Tea': ['peach iced tea'],
  'Peri Peri Fries': ['spicy fries', 'seasoned fries'],
  'Pink Sauce Pasta': ['pasta pink sauce', 'penne pasta'],
  'Potato Wedges': ['potato wedges'],
  'Schezwan Maggi': ['spicy noodles bowl'],
  'Schezwan Noodles': ['chinese noodles', 'stir fry noodles'],
  Sprite: ['lemon lime soda can'],
  'Strawberry Shake': ['strawberry milkshake'],
  'Thums Up': ['cola drink glass'],
  'Vanilla Ice Cream': ['vanilla ice cream'],
  'Vanilla Latte': ['vanilla latte', 'latte coffee cup', 'coffee milk latte'],
  'Vanilla Shake': ['vanilla milkshake'],
  'Veg Grilled Sandwich': ['grilled vegetable sandwich'],
  'Veg Hakka Noodles': ['hakka noodles', 'stir fry noodles'],
  'Veg Maggi': ['vegetable noodles bowl'],
  'Veg Manchurian': ['vegetable manchurian', 'fried vegetable balls'],
  'Veg Momos': ['momos dumplings', 'steamed dumplings'],
  'Veg Nachos': ['nachos', 'tortilla chips', 'corn chips snack'],
  'Veg Spring Roll': ['spring rolls'],
  'Veggie Supreme Pizza': ['vegetable pizza'],
  'Veggie Wrap': ['vegetable wrap'],
  'Virgin Mojito': ['virgin mojito mocktail', 'mojito mocktail'],
  'Watermelon Cooler': ['watermelon juice'],
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function searchOpenverse(query) {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license=cc0&mature=false&page_size=5`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'KhaoPiyo-MenuImageSeed/1.0 (admin script; one-off menu photo seeding)' },
  })
  if (!res.ok) return []
  const data = await res.json()
  return (data.results ?? []).filter((r) => (r.width ?? 0) >= 400 && (r.height ?? 0) >= 300)
}

async function downloadImage(url) {
  const res = await fetch(url)
  if (!res.ok) return null
  const buf = Buffer.from(await res.arrayBuffer())
  return buf.length >= 5000 ? buf : null
}

async function toWebp(buf) {
  return sharp(buf)
    .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer()
}

async function findPhotoFor(name) {
  const queries = QUERY_MAP[name] ?? [name]
  for (const q of queries) {
    const candidates = await searchOpenverse(q)
    for (const c of candidates.slice(0, 3)) {
      const raw = await downloadImage(c.url)
      if (!raw) continue
      try {
        const webp = await toWebp(raw)
        if (webp.length <= MAX_BYTES) return { webp, source: c.foreign_landing_url }
      } catch {
        continue
      }
    }
  }
  return null
}

async function run() {
  const { data: items, error } = await supabase
    .from('menu_items')
    .select('id, name, image_url')
    .eq('cafe_id', CAFE_ID)
    .eq('archived', false)
    .order('name')
  if (error) throw error

  const todo = items.filter((i) => !i.image_url)
  console.log(`${todo.length} of ${items.length} items need a photo. ${DRY_RUN ? '(dry run)' : ''}`)

  const ok = []
  const skipped = []

  for (const item of todo) {
    const found = await findPhotoFor(item.name)
    if (!found) {
      console.warn(`✗ ${item.name} — no usable CC0 match`)
      skipped.push(item.name)
      await sleep(DELAY_MS)
      continue
    }

    if (DRY_RUN) {
      console.log(`✓ ${item.name} — would upload (source: ${found.source})`)
      ok.push(item.name)
      await sleep(DELAY_MS)
      continue
    }

    const path = `${CAFE_ID}/item-${item.id}.webp`
    const { error: upErr } = await supabase.storage
      .from('menu-images')
      .upload(path, found.webp, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' })
    if (upErr) {
      console.warn(`✗ ${item.name} — storage upload failed: ${upErr.message}`)
      skipped.push(item.name)
      await sleep(DELAY_MS)
      continue
    }

    const { data: pub } = supabase.storage.from('menu-images').getPublicUrl(path)
    const { error: updErr } = await supabase.from('menu_items').update({ image_url: pub.publicUrl }).eq('id', item.id)
    if (updErr) {
      console.warn(`✗ ${item.name} — db update failed: ${updErr.message}`)
      skipped.push(item.name)
      await sleep(DELAY_MS)
      continue
    }

    console.log(`✓ ${item.name}`)
    ok.push(item.name)
    await sleep(DELAY_MS)
  }

  console.log(`\nDone. ${ok.length} uploaded, ${skipped.length} skipped.`)
  if (skipped.length) console.log('Skipped (needs a manual photo via the dashboard):', skipped.join(', '))
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

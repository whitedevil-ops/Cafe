// Reading a menu out of a photograph.
//
// Every café already has a picture of its menu; almost none can produce a
// clean spreadsheet. So the fastest route into KhaoPiyo is a photo, and this
// module turns one into the same rows the bulk importer already understands.
//
// The deliberate design choice: the model is asked for the SHEET, not for
// database records. Its answer becomes an array-of-arrays with our own header
// row, which then goes through parseMenuFile like any uploaded file. Every
// existing safeguard therefore applies unchanged — category grouping, option
// grouping, duplicate detection, add-on folding, the issue list, and
// update-vs-insert matching. Nothing the model returns reaches the database
// without passing the same checks a hand-made sheet does, and the owner still
// confirms the preview.
//
// No SDK: both providers are one HTTPS POST with JSON, and this only ever runs
// server-side, so a dependency would buy nothing.

export type VisionProvider = 'anthropic' | 'openai'

/** One picture to read. `data` is raw base64, without the data: prefix. */
export type MenuImage = { mediaType: string; data: string }

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const MAX_IMAGES = 8
/** Roughly 5 MB per image once decoded — comfortably above a phone photo. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * What the model is asked to produce. Field names are spelled out rather than
 * left implicit because a menu board is ambiguous in ways a model will
 * otherwise resolve silently — "+20 Add Cheese" is an extra, "6 Slice 99" is a
 * size, and a heading is not a dish.
 */
export type VisionItem = {
  category: string
  name: string
  /** "Small", "6 Slice", "Steam" — one row per option, the item name repeated. */
  option?: string | null
  price: number | null
  veg?: boolean | null
  description?: string | null
  /** "Cheese Slice 20, Extra Dip 20", or a bare name for a free one. */
  addons?: string | null
}

const PROMPT = `You are reading a restaurant menu from photographs and transcribing it.

Return ONLY a JSON object, no prose and no markdown fence, shaped exactly:
{"items":[{"category":"...","name":"...","option":null,"price":0,"veg":true,"description":null,"addons":null}]}

Rules:
- Transcribe only what is printed. Never invent an item, a price, or a description. If a price is unreadable, use null rather than a guess.
- "category" is the section heading the item sits under, e.g. BURGERS, PIZZA, MOJITO.
- One object per orderable thing. If a dish is sold in more than one way, repeat the item name and put the variation in "option": {"name":"Cold Coffee","option":"Small","price":89}, {"name":"Cold Coffee","option":"Large","price":149}. Sizes, "6 Slice"/"8 Slice", "Steam"/"Fried", "Half"/"Full" are all options.
- "option" is null for a dish sold only one way.
- "addons" holds optional extras a guest can add on top, as "Name Price" separated by commas: "Cheese Slice 20, Extra Dip 20". A menu writes these as "+20 Add Cheese Slice", "Add Injector @30", "Extra Dip @ 20", "With Ice-cream +29". If an extra is free, or is a choice of topping at no charge, give just its name: "Onion, Corn, Capsicum". An add-on printed once for a whole section belongs on every item in that section.
- "veg" is true for vegetarian, false for non-vegetarian, null if the menu does not say. Indian menus use a green dot/square for veg and a red or brown one for non-veg.
- "description" is the short line under a dish, if the menu prints one. Otherwise null.
- Prices are plain numbers in rupees: 149, not "₹149" or "149.00".
- Read every section in every image. Combine all images into one list.`

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  // Models sometimes fence the JSON despite being asked not to.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : trimmed
  // And sometimes add a sentence before or after it.
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('the reply was not JSON')
  return JSON.parse(body.slice(start, end + 1))
}

async function callAnthropic(images: MenuImage[], apiKey: string, model: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((img) => ({
              type: 'image',
              source: { type: 'base64', media_type: img.mediaType, data: img.data },
            })),
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`vision request failed (${res.status})`)
  const json = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
  if (!text) throw new Error('the reply was empty')
  return text
}

async function callOpenAI(images: MenuImage[], apiKey: string, model: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            ...images.map((img) => ({
              type: 'image_url',
              image_url: { url: `data:${img.mediaType};base64,${img.data}` },
            })),
          ],
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`vision request failed (${res.status})`)
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = json.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('the reply was empty')
  return text
}

/** Which provider this deployment can use, decided by whichever key is set. */
export function visionProvider(env: Record<string, string | undefined>): VisionProvider | null {
  if (env.ANTHROPIC_API_KEY) return 'anthropic'
  if (env.OPENAI_API_KEY) return 'openai'
  return null
}

// The flat shape — category repeated on every row — because that's what the
// export uses and what survives sorting. It also means no heading rows to
// synthesise, and the produced sheet reads like one an owner exported.
export const VISION_HEADER = ['Category', 'Item', 'Size / Choice', 'Price', 'Add-ons', 'Veg Type', 'Description']

/**
 * Model reply → the array-of-arrays parseMenuFile takes.
 *
 * Anything unusable is dropped here rather than passed on: a row with no name
 * is noise, and a row with no price would only be reported as an error further
 * down. Exported separately from the network call so the shaping is testable
 * without an API key.
 */
export function visionItemsToRows(items: VisionItem[]): unknown[][] {
  const rows: unknown[][] = [VISION_HEADER]
  for (const item of items) {
    const name = String(item?.name ?? '').trim()
    if (!name) continue
    const price = typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0 ? Math.round(item.price) : ''
    if (price === '') continue
    rows.push([
      String(item.category ?? '').trim() || 'Uncategorised',
      name,
      String(item.option ?? '').trim(),
      price,
      String(item.addons ?? '').trim(),
      item.veg === true ? 'Veg' : item.veg === false ? 'Non-Veg' : '',
      String(item.description ?? '').trim(),
    ])
  }
  return rows
}

/** Reads menus out of photographs. Throws with a message safe to show an owner. */
export async function readMenuFromImages(
  images: MenuImage[],
  env: Record<string, string | undefined>,
): Promise<{ rows: unknown[][]; provider: VisionProvider; items: number }> {
  const provider = visionProvider(env)
  if (!provider) throw new Error('Menu scanning is not switched on for this server.')

  const text =
    provider === 'anthropic'
      ? await callAnthropic(images, env.ANTHROPIC_API_KEY!, env.MENU_VISION_MODEL || 'claude-sonnet-5')
      : await callOpenAI(images, env.OPENAI_API_KEY!, env.MENU_VISION_MODEL || 'gpt-4o')

  const parsed = extractJson(text) as { items?: VisionItem[] }
  const items = Array.isArray(parsed?.items) ? parsed.items : []
  if (items.length === 0) throw new Error("No menu items could be read from that photo. Try a sharper, straight-on picture.")

  return { rows: visionItemsToRows(items), provider, items: items.length }
}

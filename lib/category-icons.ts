// Deterministic keyword → emoji mapping for menu categories. Zero cost, no AI —
// the category NAMES are always the café's real data (spec: "Do NOT hardcode
// these categories. Use actual café menu data"); this only decides which
// existing emoji best represents a name the café already chose.

// Same deterministic keyword-matching idea, mapped to an
// emoji instead of a Lucide component — a colorful, "illustrated" mark
// without needing a real icon/illustration asset pack. First match wins;
// falls back to a plain plate for anything unrecognized.
const EMOJI_RULES: [RegExp, string][] = [
  [/pizza/i, '🍕'],
  [/burger/i, '🍔'],
  [/momo/i, '🥟'],
  [/nachos/i, '🧀'],
  [/pasta|noodle|maggi/i, '🍜'],
  [/wrap|roll|kathi/i, '🌯'],
  [/fries|chips/i, '🍟'],
  [/corn/i, '🌽'],
  [/bread|bun|toastie|sandwich/i, '🥪'],
  [/side|starter|appetizer/i, '🍢'],
  [/salad/i, '🥗'],
  [/coffee/i, '☕'],
  [/tea|chai|kulhad/i, '🍵'],
  [/beverage|drink|juice|shake|lassi|soda|cola|slush|mojito/i, '🥤'],
  [/dessert|sweet|cake|brownie|ice\s?cream/i, '🍰'],
  [/cookie|biscuit/i, '🍪'],
  [/sea\s?food|fish|prawn/i, '🐟'],
  [/chicken|meat|kebab/i, '🍗'],
]
export function categoryEmoji(name: string): string {
  for (const [re, emoji] of EMOJI_RULES) if (re.test(name)) return emoji
  return '🍽️'
}

// Display-only title case (e.g. "SWEET CORN" -> "Sweet Corn"). Cafés that
// typed their category names in caps (a common habit) read fine in a form
// field but fight readability in a narrow rail — this never touches the
// real stored name, only how it's rendered, so filtering/matching/sorting by
// name elsewhere is unaffected.
export function categoryDisplayName(name: string): string {
  return name.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
}

// Deterministic keyword → icon mapping for menu categories. Zero cost, no AI —
// the category NAMES are always the café's real data (spec: "Do NOT hardcode
// these categories. Use actual café menu data"); this only decides which
// existing lucide icon best represents a name the café already chose.
import type { LucideIcon } from 'lucide-react'
import {
  Pizza, Sandwich, Beef, Soup, Salad, CupSoda, Coffee, IceCreamCone,
  Cookie, Fish, Drumstick, Utensils,
} from 'lucide-react'

const RULES: [RegExp, LucideIcon][] = [
  [/pizza/i, Pizza],
  [/burger/i, Sandwich],
  [/pasta|noodle/i, Soup],
  [/wrap|roll|kathi/i, Sandwich],
  [/side|starter|appetizer/i, Drumstick],
  [/salad/i, Salad],
  [/beverage|drink|juice|shake|lassi|soda|cola/i, CupSoda],
  [/coffee/i, Coffee],
  [/tea|chai/i, Coffee],
  [/dessert|sweet|cake|brownie|ice\s?cream/i, IceCreamCone],
  [/cookie|biscuit/i, Cookie],
  [/sea\s?food|fish|prawn/i, Fish],
  [/chicken|meat|kebab/i, Beef],
  [/sandwich/i, Sandwich],
]

export function categoryIcon(name: string): LucideIcon {
  for (const [re, icon] of RULES) if (re.test(name)) return icon
  return Utensils
}

// Display-only title case (e.g. "SWEET CORN" -> "Sweet Corn"). Cafés that
// typed their category names in caps (a common habit) read fine in a form
// field but fight readability in a narrow rail — this never touches the
// real stored name, only how it's rendered, so filtering/matching/sorting by
// name elsewhere is unaffected.
export function categoryDisplayName(name: string): string {
  return name.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
}

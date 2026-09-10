import { Bricolage_Grotesque } from 'next/font/google'

// Shared by every route that still wants the marketing display face after
// it was moved out of the root layout (see app/(marketing)/layout.tsx and
// app/r/[token]/layout.tsx) — next/font dedupes identical calls at build
// time, so importing this in more than one place doesn't ship the font
// twice.
export const bricolageGrotesque = Bricolage_Grotesque({
  variable: '--font-bricolage',
  subsets: ['latin'],
})

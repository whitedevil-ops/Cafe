import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

const docs: Record<string, { title: string; intro: string }> = {
  privacy: {
    title: 'Privacy Policy',
    intro:
      'How counter collects, uses, and protects café and customer data. We collect only what the product needs to run, and café owners control their customer information.',
  },
  terms: {
    title: 'Terms & Conditions',
    intro:
      'The terms governing use of counter. By creating a workspace you agree to acceptable use, billing, and account responsibilities described here.',
  },
  cookies: {
    title: 'Cookie Policy',
    intro:
      'counter uses only essential cookies for authentication and session management. We do not use advertising or cross-site tracking cookies.',
  },
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ doc: string }>
}): Promise<Metadata> {
  const { doc } = await params
  return { title: docs[doc]?.title ?? 'Legal' }
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params
  const d = docs[doc]
  if (!d) notFound()

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-3xl items-center px-6">
          <Link href="/" className="text-lg font-semibold tracking-tight text-foreground">
            counter
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{d.title}</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">{d.intro}</p>

        <div className="mt-8 rounded-xl border border-warning/40 bg-warning-subtle px-4 py-3 text-[13px] text-warning">
          Placeholder document. Final legal text must be reviewed for the actual business model
          and jurisdiction before launch.
        </div>

        <p className="mt-8 text-[13px] text-muted-foreground">Last updated: pending launch.</p>
      </main>
    </div>
  )
}

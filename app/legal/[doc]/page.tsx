import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { LEGAL_DOCS as docs } from '@/lib/legal-content'
import { LegalDocBody } from '@/components/legal/legal-doc-body'

export function generateStaticParams() {
  return Object.keys(docs).map((doc) => ({ doc }))
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const { doc } = await params
  return { title: docs[doc]?.title ?? 'Legal' }
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params
  const d = docs[doc]
  if (!d) notFound()

  const others = Object.entries(docs).filter(([k]) => k !== doc)

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-3xl items-center px-6">
          <Link href="/" className="flex items-center">
            <Image src="/logo-wordmark.png" alt="KhaoPiyo" width={900} height={311} className="h-7 w-auto" />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{d.title}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Last updated: {d.updated}</p>

        <div className="mt-4">
          <LegalDocBody doc={d} variant="page" />
        </div>

        <nav className="mt-10 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-6 text-[13px]">
          {others.map(([k, v]) => (
            <Link key={k} href={`/legal/${k}`} className="text-primary hover:underline">{v.title}</Link>
          ))}
        </nav>
      </main>
    </div>
  )
}

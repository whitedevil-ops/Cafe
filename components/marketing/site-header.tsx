import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center">
          <Image src="/logo-wordmark.png" alt="KhaoPiyo" width={900} height={311} className="h-8 w-auto" priority />
        </Link>
        <div className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <Link href="/#features" className="transition-colors hover:text-foreground">Features</Link>
          <Link href="/#how" className="transition-colors hover:text-foreground">How it works</Link>
          <Link href="/#pricing" className="transition-colors hover:text-foreground">Pricing</Link>
          <Link href="/pos-billing-software" className="transition-colors hover:text-foreground">POS &amp; billing</Link>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm">Log in</Button>
          </Link>
          <Link href="/get-started">
            <Button size="sm">Start free</Button>
          </Link>
        </div>
      </nav>
    </header>
  )
}

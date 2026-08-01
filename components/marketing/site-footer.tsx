import Link from 'next/link'

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-surface">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-lg font-semibold tracking-tight text-foreground">KhaoPiyo</p>
            <p className="mt-1 max-w-xs text-[13px] text-muted-foreground">
              POS, QR ordering, and billing software for cafés and restaurants across India.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-[13px] text-muted-foreground sm:flex sm:gap-x-10">
            <nav className="flex flex-col gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Product</span>
              <Link href="/pos-billing-software" className="hover:text-foreground">POS &amp; billing software</Link>
              <Link href="/qr-code-ordering-system" className="hover:text-foreground">QR ordering system</Link>
              <Link href="/digital-menu-software" className="hover:text-foreground">Digital menu software</Link>
              <Link href="/cloud-kitchen-pos-software" className="hover:text-foreground">Cloud kitchen POS</Link>
              <Link href="/restaurant-inventory-management-software" className="hover:text-foreground">Inventory management</Link>
              <Link href="/gst-billing-software-for-restaurants" className="hover:text-foreground">GST billing software</Link>
              <Link href="/petpooja-alternative" className="hover:text-foreground">Petpooja alternative</Link>
              <Link href="/#pricing" className="hover:text-foreground">Pricing</Link>
              <a href="/downloads/KhaoPiyo-Setup.exe" download className="hover:text-foreground">Download for Windows</a>
            </nav>
            <nav className="flex flex-col gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Account</span>
              <Link href="/get-started" className="hover:text-foreground">Start free</Link>
              <Link href="/login" className="hover:text-foreground">Log in</Link>
            </nav>
            <nav className="flex flex-col gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Legal</span>
              <Link href="/legal/privacy" className="hover:text-foreground">Privacy</Link>
              <Link href="/legal/terms" className="hover:text-foreground">Terms</Link>
              <Link href="/legal/cookies" className="hover:text-foreground">Cookies</Link>
            </nav>
          </div>
        </div>
        <p className="mt-8 border-t border-border pt-6 text-[12px] text-muted-foreground">
          © {new Date().getFullYear()} KhaoPiyo. Café billing &amp; POS software, built in Hisar, India.
        </p>
      </div>
    </footer>
  )
}

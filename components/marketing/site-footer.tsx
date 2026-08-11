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
          <div className="grid grid-cols-2 gap-x-10 gap-y-6 text-[13px] text-muted-foreground sm:flex sm:gap-x-10 sm:gap-y-0">
            <nav className="flex flex-col gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Product</span>
              <Link href="/restaurant-pos-software" className="hover:text-foreground">Restaurant POS software</Link>
              <Link href="/pos-billing-software" className="hover:text-foreground">POS &amp; billing software</Link>
              <Link href="/qr-code-ordering-system" className="hover:text-foreground">QR ordering system</Link>
              <Link href="/kitchen-display-system" className="hover:text-foreground">Kitchen display system</Link>
              <Link href="/digital-menu-software" className="hover:text-foreground">Digital menu software</Link>
              <Link href="/cloud-kitchen-pos-software" className="hover:text-foreground">Cloud kitchen POS</Link>
              <Link href="/restaurant-inventory-management-software" className="hover:text-foreground">Inventory management</Link>
              <Link href="/gst-billing-software-for-restaurants" className="hover:text-foreground">GST billing software</Link>
              <Link href="/petpooja-alternative" className="hover:text-foreground">Petpooja alternative</Link>
            </nav>
            <nav className="flex flex-col gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Company</span>
              <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
              <Link href="/blog" className="hover:text-foreground">Blog</Link>
              <Link href="/about" className="hover:text-foreground">About</Link>
              <Link href="/contact" className="hover:text-foreground">Contact</Link>
              <a href="/downloads/KhaoPiyo-Setup.exe" download className="hover:text-foreground">Download for Windows</a>
              <a href="/downloads/KhaoPiyo.dmg" download className="hover:text-foreground">Download for Mac</a>
            </nav>
            <nav className="flex flex-col gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Cities</span>
              <Link href="/restaurant-pos-software/hisar" className="hover:text-foreground">Hisar</Link>
              <Link href="/restaurant-pos-software/gurugram" className="hover:text-foreground">Gurugram</Link>
              <Link href="/restaurant-pos-software/noida" className="hover:text-foreground">Noida</Link>
              <Link href="/restaurant-pos-software/pune" className="hover:text-foreground">Pune</Link>
              <Link href="/restaurant-pos-software/bangalore-hsr-layout" className="hover:text-foreground">HSR Layout, Bengaluru</Link>
            </nav>
            <nav className="flex flex-col gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Account</span>
              <Link href="/get-started" className="hover:text-foreground">Start free</Link>
              <Link href="/login" className="hover:text-foreground">Log in</Link>
              <span className="mt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">Legal</span>
              <Link href="/legal/privacy" className="hover:text-foreground">Privacy</Link>
              <Link href="/legal/terms" className="hover:text-foreground">Terms</Link>
              <Link href="/legal/cookies" className="hover:text-foreground">Cookies</Link>
            </nav>
          </div>
        </div>
        <p className="mt-8 border-t border-border pt-6 text-[12px] text-muted-foreground">
          © {new Date().getFullYear()} KhaoPiyo. Café billing &amp; POS software, built in Hisar,
          India by{' '}
          <a href="https://ventron.in" rel="noopener" className="hover:text-foreground">
            Ventron
          </a>
          .
        </p>
      </div>
    </footer>
  )
}

import Image from 'next/image'
import Link from 'next/link'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full min-h-dvh flex-col bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center px-6 py-6">
        <Link href="/" className="flex items-center">
          <Image src="/logo-wordmark.png" alt="KhaoPiyo" width={900} height={311} className="h-8 w-auto" priority />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  )
}

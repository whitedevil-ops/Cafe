import { bricolageGrotesque } from '@/lib/marketing-font'

// The digital receipt is customer-facing brand, not a staff tool — it keeps
// the display face even though it moved out of the root layout for
// /dashboard and /ops. See app/(marketing)/layout.tsx for the same pattern.
export default function ReceiptLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${bricolageGrotesque.variable} contents`}>{children}</div>
}

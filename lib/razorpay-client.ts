'use client'

// Browser-side Razorpay Checkout.js loader, shared by every surface that
// opens the widget (customer QR payment, café billing) — injected once and
// cached, never bundled as an npm dependency since Razorpay only ships this
// as a hosted script.
export type RazorpayInstance = { open: () => void; on: (event: string, cb: (response: unknown) => void) => void }
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance
  }
}

let razorpayScriptPromise: Promise<boolean> | null = null
export function loadRazorpayCheckout(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (window.Razorpay) return Promise.resolve(true)
  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise((resolve) => {
      const script = document.createElement('script')
      script.src = 'https://checkout.razorpay.com/v1/checkout.js'
      script.onload = () => resolve(true)
      script.onerror = () => resolve(false)
      document.body.appendChild(script)
    })
  }
  return razorpayScriptPromise
}

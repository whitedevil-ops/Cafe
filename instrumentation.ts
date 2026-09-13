import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
    // Sentry.init no-ops silently with no DSN (by design, so this deploys
    // fine before a Sentry project exists) — but that means a since-forgotten
    // DSN in a real production deploy fails the same way, with nothing
    // telling anyone. This is the one loud, unmissable signal for that.
    if (process.env.VERCEL_ENV === 'production' && !process.env.SENTRY_DSN) {
      console.error('[SENTRY] SENTRY_DSN is not set in production — error tracking is a no-op. Set it in the Vercel project environment variables.')
    }
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Reports every server-side error Next.js catches (Server Components, Route
// Handlers, Server Actions) — this is what would have caught the redactReport
// crash the moment it deployed instead of only when someone happened to hit it.
export const onRequestError = Sentry.captureRequestError

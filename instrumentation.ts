import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Reports every server-side error Next.js catches (Server Components, Route
// Handlers, Server Actions) — this is what would have caught the redactReport
// crash the moment it deployed instead of only when someone happened to hit it.
export const onRequestError = Sentry.captureRequestError

import * as Sentry from '@sentry/nextjs'

// No-ops safely (SDK logs a notice, sends nothing) until SENTRY_DSN is set —
// safe to deploy before a Sentry project exists.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Error tracking only for now — no performance/APM sampling, to keep this
  // to exactly what was asked for and cheap on the free tier.
  tracesSampleRate: 0,
})

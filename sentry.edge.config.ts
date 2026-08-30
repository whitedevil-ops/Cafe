import * as Sentry from '@sentry/nextjs'

// Same as sentry.server.config.ts, for code that runs on the Edge runtime.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

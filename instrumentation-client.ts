import * as Sentry from '@sentry/nextjs'

// No-ops safely (no DSN = nothing sent) until NEXT_PUBLIC_SENTRY_DSN is set.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
})

// Lets Sentry attach "what page was the user on right before this broke" as
// a breadcrumb on every error report.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart

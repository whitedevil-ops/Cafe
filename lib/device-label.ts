// Turns a user agent into something an operator can read at a glance.
//
// Deliberately not a UA-parsing dependency: those ship megabytes of regex to
// distinguish browsers nobody in this product uses. "Windows · Chrome" answers
// the only question the console asks — what was this person on when something
// went wrong — and the raw UA is never stored, so a coarse label is the point
// rather than a limitation.
//
// Order matters throughout: Edge and Opera both claim Chrome, Chrome claims
// Safari, and iPadOS claims Macintosh. Every check below is placed so the more
// specific match wins.

function osOf(ua: string): string {
  // iPadOS reports as Macintosh but has touch points, which we cannot see from
  // the UA alone — so an iPad on desktop Safari does read as "Mac". Accepted:
  // the alternative is guessing.
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return 'Android'
  if (/Windows NT/i.test(ua)) return 'Windows'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'Mac'
  if (/CrOS/i.test(ua)) return 'ChromeOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return ''
}

function browserOf(ua: string): string {
  if (/Edg\//i.test(ua)) return 'Edge'
  if (/OPR\/|Opera/i.test(ua)) return 'Opera'
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet'
  if (/Firefox\/|FxiOS/i.test(ua)) return 'Firefox'
  if (/Chrome\/|CriOS/i.test(ua)) return 'Chrome'
  if (/Safari\//i.test(ua)) return 'Safari'
  return ''
}

/**
 * @param ua       The request's user-agent header.
 * @param isDesktopApp Whether the request came from the Tauri shell. Worth
 *   calling out separately: "KhaoPiyo desktop app" vs "Chrome" is the
 *   difference between a till and someone's laptop, and the desktop webview
 *   otherwise reports as plain Chrome/Safari.
 */
export function deviceLabel(ua: string | null | undefined, isDesktopApp = false): string | null {
  if (!ua || !ua.trim()) return null

  const os = osOf(ua)
  if (isDesktopApp) return os ? `${os} · KhaoPiyo app` : 'KhaoPiyo app'

  const browser = browserOf(ua)
  if (os && browser) return `${os} · ${browser}`
  return os || browser || null
}

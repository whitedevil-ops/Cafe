// Is this page running inside the KhaoPiyo desktop app rather than a browser?
//
// It matters for anything that produces a file. A browser shows its own
// download bar; the desktop app's webview saves the file and says nothing at
// all, so a café taps Export, sees no bar, and reasonably concludes it did not
// work. The app has to supply the feedback the browser would have given.
//
// Checked lazily rather than at module load: the global is injected by the
// webview and may not be there the instant a bundle is evaluated.
export function isDesktopApp(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as Record<string, unknown>
  return '__TAURI_INTERNALS__' in w || '__TAURI__' in w
}

/** Where a saved file went, phrased for whoever is standing at the counter. */
export function savedFileHint(filename: string): string {
  return isDesktopApp()
    ? `${filename} saved to your Downloads folder.`
    : `${filename} downloaded.`
}

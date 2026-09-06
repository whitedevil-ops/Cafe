import { describe, it, expect } from 'vitest'
import { isAndroidUA } from '@/lib/platform-guard'

// Same real user agents as tests/unit/device-label.test.ts (not exported
// from there, so duplicated here) — the value of this check is that it
// matches what browsers actually send, not invented strings.
const UA = {
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
}

describe('isAndroidUA', () => {
  it('is true for real Android user agents', () => {
    expect(isAndroidUA(UA.androidChrome)).toBe(true)
    expect(isAndroidUA(UA.androidSamsung)).toBe(true)
  })

  it('is false for every non-Android platform, including plain Linux', () => {
    // Android UAs also claim "Linux" — a naive /Linux/ check would wrongly
    // block nothing while a naive substring match elsewhere could wrongly
    // flag a real Linux desktop as Android. osOf() already orders these
    // checks correctly; this just proves the wrapper doesn't undo that.
    expect(isAndroidUA(UA.windowsChrome)).toBe(false)
    expect(isAndroidUA(UA.macSafari)).toBe(false)
    expect(isAndroidUA(UA.linuxFirefox)).toBe(false)
    expect(isAndroidUA(UA.iphoneSafari)).toBe(false)
    expect(isAndroidUA(UA.ipadSafari)).toBe(false)
  })

  it('is false, not a throw, when there is nothing to go on', () => {
    expect(isAndroidUA(null)).toBe(false)
    expect(isAndroidUA(undefined)).toBe(false)
    expect(isAndroidUA('')).toBe(false)
  })
})

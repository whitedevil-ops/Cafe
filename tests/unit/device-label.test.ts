import { describe, it, expect } from 'vitest'
import { deviceLabel } from '@/lib/device-label'

// Real user agents, not invented ones — the whole value of this function is
// that it matches what browsers actually send.
const UA = {
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  firefox:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
}

describe('deviceLabel', () => {
  it('labels the common desktop browsers', () => {
    expect(deviceLabel(UA.windowsChrome)).toBe('Windows · Chrome')
    expect(deviceLabel(UA.macSafari)).toBe('Mac · Safari')
    expect(deviceLabel(UA.firefox)).toBe('Windows · Firefox')
  })

  it('picks the more specific browser when several are claimed', () => {
    // Edge and Samsung Internet both include "Chrome" in their UA; Chrome
    // includes "Safari". Naive matching gets all three of these wrong.
    expect(deviceLabel(UA.windowsEdge)).toBe('Windows · Edge')
    expect(deviceLabel(UA.androidSamsung)).toBe('Android · Samsung Internet')
    expect(deviceLabel(UA.windowsChrome)).not.toContain('Safari')
  })

  it('prefers Android over Linux, which Android UAs also claim', () => {
    expect(deviceLabel(UA.androidChrome)).toBe('Android · Chrome')
  })

  it('labels mobile', () => {
    expect(deviceLabel(UA.iphoneSafari)).toBe('iPhone · Safari')
  })

  it('calls out the desktop app, which otherwise reads as a plain browser', () => {
    // The whole reason this flag exists: the Tauri webview sends an ordinary
    // Chrome UA, so a till would be indistinguishable from someone's laptop.
    expect(deviceLabel(UA.windowsChrome, true)).toBe('Windows · KhaoPiyo app')
    expect(deviceLabel(UA.macSafari, true)).toBe('Mac · KhaoPiyo app')
  })

  it('returns null rather than a junk label when there is nothing to go on', () => {
    expect(deviceLabel(null)).toBeNull()
    expect(deviceLabel(undefined)).toBeNull()
    expect(deviceLabel('')).toBeNull()
    expect(deviceLabel('   ')).toBeNull()
  })

  it('degrades to whichever half it can identify', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0)')).toBe('Windows')
    expect(deviceLabel('some-cli/1.0 Firefox/121.0')).toBe('Firefox')
  })

  it('never returns an empty or partial separator', () => {
    for (const ua of [...Object.values(UA), 'garbage', 'Mozilla/5.0']) {
      const label = deviceLabel(ua)
      if (label !== null) {
        expect(label.startsWith(' ·'), ua).toBe(false)
        expect(label.endsWith('· '), ua).toBe(false)
        expect(label.trim().length).toBeGreaterThan(0)
      }
    }
  })
})

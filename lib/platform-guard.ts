import { osOf } from '@/lib/device-label'

// Thin wrapper, not a second UA-parsing implementation — osOf() already
// correctly distinguishes Android from iPhone/iPad/Windows/Mac/Linux and is
// already unit-tested (tests/unit/device-label.test.ts).
export function isAndroidUA(ua: string | null | undefined): boolean {
  return !!ua && osOf(ua) === 'Android'
}

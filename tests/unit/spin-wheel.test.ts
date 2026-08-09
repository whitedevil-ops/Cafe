import { describe, it, expect } from 'vitest'
import { chanceOf, totalWeight, oneInPhrase, percentPhrase, weightsForOneIn, prizeLabel } from '@/lib/spin-wheel'

// The odds arithmetic an owner sees while setting the wheel up. Getting this
// wrong means giving away far more than intended, so it is worth pinning.

describe('chanceOf', () => {
  it('is the slice over the whole wheel', () => {
    expect(chanceOf(1, 20)).toBeCloseTo(0.05)
    expect(chanceOf(5, 10)).toBeCloseTo(0.5)
  })

  it('is zero rather than NaN when nothing can be won', () => {
    expect(chanceOf(0, 0)).toBe(0)
    expect(chanceOf(5, 0)).toBe(0)
    expect(chanceOf(0, 10)).toBe(0)
  })
})

describe('totalWeight', () => {
  it('adds the slices up', () => {
    expect(totalWeight([{ weight: 1 }, { weight: 4 }, { weight: 15 }])).toBe(20)
  })

  it('ignores a negative weight rather than subtracting it', () => {
    expect(totalWeight([{ weight: 5 }, { weight: -3 }])).toBe(5)
  })
})

describe('oneInPhrase', () => {
  it('says what the owner asked for', () => {
    expect(oneInPhrase(1, 20)).toBe('1 in 20')
    expect(oneInPhrase(5, 100)).toBe('1 in 20')
  })

  it('keeps a decimal for common odds, where rounding would mislead', () => {
    expect(oneInPhrase(2, 3)).toBe('1 in 1.5')
    expect(oneInPhrase(1, 2)).toBe('1 in 2')
  })

  it('rounds long odds to something readable', () => {
    expect(oneInPhrase(1, 487)).toBe('1 in 490')
  })

  it('returns null for a slice that can never be landed on', () => {
    expect(oneInPhrase(0, 20)).toBeNull()
    expect(oneInPhrase(1, 0)).toBeNull()
  })
})

describe('percentPhrase', () => {
  it('reads as a percentage', () => {
    expect(percentPhrase(1, 20)).toBe('5.0%')
    expect(percentPhrase(1, 4)).toBe('25.0%')
  })

  it('keeps precision on a rare prize instead of collapsing to 0%', () => {
    expect(percentPhrase(1, 500)).toBe('0.20%')
  })

  it('is 0% for an unreachable slice', () => {
    expect(percentPhrase(0, 20)).toBe('0%')
  })
})

// The shortcut behind "make this 1 in 20": the owner names the odds and the
// rest of the wheel rescales around it.
describe('weightsForOneIn', () => {
  it('gives the chosen slice the odds asked for', () => {
    const segments = [{ weight: 1 }, { weight: 5 }, { weight: 5 }, { weight: 9 }]
    const next = weightsForOneIn(segments, 0, 20)!
    const total = totalWeight(next.map((weight) => ({ weight })))
    expect(chanceOf(next[0], total)).toBeCloseTo(0.05, 2)
    expect(oneInPhrase(next[0], total)).toBe('1 in 20')
  })

  it('leaves the other slices exactly as they were', () => {
    const segments = [{ weight: 1 }, { weight: 5 }, { weight: 14 }]
    expect(weightsForOneIn(segments, 0, 10)!.slice(1)).toEqual([5, 14])
  })

  it('handles a long-odds jackpot', () => {
    const segments = [{ weight: 1 }, { weight: 99 }]
    const next = weightsForOneIn(segments, 0, 100)!
    const total = totalWeight(next.map((weight) => ({ weight })))
    expect(oneInPhrase(next[0], total)).toBe('1 in 100')
  })

  it('refuses impossible odds instead of producing a silly wheel', () => {
    const segments = [{ weight: 1 }, { weight: 9 }]
    expect(weightsForOneIn(segments, 0, 1)).toBeNull()
    expect(weightsForOneIn(segments, 0, 0)).toBeNull()
    expect(weightsForOneIn(segments, 0, -5)).toBeNull()
  })

  it('refuses when there is no other slice to take the rest', () => {
    expect(weightsForOneIn([{ weight: 1 }], 0, 20)).toBeNull()
    expect(weightsForOneIn([{ weight: 1 }, { weight: 0 }], 0, 20)).toBeNull()
  })

  it('never returns a weight below 1 for the chosen slice', () => {
    // Very long odds against a small wheel would otherwise round to zero,
    // making the "prize" unwinnable.
    const next = weightsForOneIn([{ weight: 1 }, { weight: 2 }], 0, 10000)!
    expect(next[0]).toBeGreaterThanOrEqual(1)
  })
})

describe('prizeLabel', () => {
  it('spells out what was won', () => {
    expect(prizeLabel('percent', 10, 'Lucky you')).toBe('Lucky you — 10% off')
    expect(prizeLabel('flat', 50, 'Nice one')).toBe('Nice one — ₹50 off')
    expect(prizeLabel('item', 0, 'Cold Coffee')).toBe('Cold Coffee — free')
    expect(prizeLabel('none', 0, 'Better luck next time')).toBe('Better luck next time')
  })
})

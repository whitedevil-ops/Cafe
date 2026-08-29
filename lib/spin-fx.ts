// Tiny, dependency-free win effects for Spin & Win. No audio file asset and
// no confetti library — a three-note chime is cheap to synthesize with the
// Web Audio API, and a CSS-driven confetti burst is a few dozen divs, so
// neither is worth the bundle weight of a real library for a once-in-a-visit
// moment.

let sharedCtx: AudioContext | null = null

/** Called from the same click handler that starts the spin, so this is
 *  always inside a real user gesture — browsers never block it. */
export function playWinChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    sharedCtx ??= new Ctx()
    const ctx = sharedCtx
    const notes = [523.25, 659.25, 783.99] // C5, E5, G5 — a simple major triad, reads as "win"
    notes.forEach((freq, i) => {
      const start = ctx.currentTime + i * 0.09
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.4)
    })
  } catch {
    // Audio is a nicety — never let it break the win screen.
  }
}

import { playbackEngine } from '../audio/playbackEngine'
import { usePlayerStore } from '../store/usePlayerStore'
import type { NoteEvent } from '../types'
import { MIDI_MAX, MIDI_MIN } from './layout'
import { syncPalette } from './noteColors'

const MAX_STRIKES = 64

/**
 * Per-frame snapshot shared by all scene components. Mutated in place once per frame
 * (by <FrameDriver/>) so the render loop never touches React state.
 */
export const frame = {
  /** Song time in seconds for this frame. */
  time: 0,
  playing: false,
  notes: [] as NoteEvent[],
  /** Visible note range [lo, hi) into `notes` (superset; consumers still cull ended notes). */
  lo: 0,
  hi: 0,
  /** Seconds of song visible above the hit line; set by the camera rig. */
  lookahead: 3,
  /** World-space height of the note field above the hit line; set by the camera rig. */
  fieldHeight: 20,
  /** Indexed by MIDI number: 0 = idle, otherwise hand (0 left / 1 right) + 1 of the sounding note. */
  active: new Uint8Array(128),
  /** Notes whose start crossed the hit line during this frame (first `strikeCount` entries are valid). */
  strikeCount: 0,
  strikeMidi: new Uint8Array(MAX_STRIKES),
  strikeHand: new Uint8Array(MAX_STRIKES),
  /** How long each struck note is held, in seconds. */
  strikeDuration: new Float32Array(MAX_STRIKES),
}

let prevTime = 0

let cachedNotes: NoteEvent[] | null = null
let maxDuration = 0
let lastSignature = ''

function lowerBound(notes: NoteEvent[], time: number): number {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (notes[mid].time < time) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function updateFrame() {
  const state = usePlayerStore.getState()
  const notes = state.parsedNotes
  if (notes !== cachedNotes) {
    cachedNotes = notes
    maxDuration = 0
    for (const n of notes) if (n.duration > maxDuration) maxDuration = n.duration
  }

  syncPalette(state.noteColors, frame.fieldHeight)

  const t = playbackEngine.getTime()
  frame.time = t
  frame.playing = playbackEngine.isPlaying
  frame.notes = notes
  frame.lo = lowerBound(notes, t - maxDuration)
  frame.hi = lowerBound(notes, t + frame.lookahead)

  // Strikes: note starts in [previous frame, this frame) while the song plays forward (not on seeks).
  frame.strikeCount = 0
  if (frame.playing && t > prevTime && t - prevTime < 0.25) {
    for (let i = lowerBound(notes, prevTime); i < notes.length && notes[i].time < t; i++) {
      const n = notes[i]
      if (n.midi < MIDI_MIN || n.midi > MIDI_MAX || frame.strikeCount >= MAX_STRIKES) continue
      frame.strikeMidi[frame.strikeCount] = n.midi
      frame.strikeHand[frame.strikeCount] = n.hand
      frame.strikeDuration[frame.strikeCount] = n.duration
      frame.strikeCount++
    }
  }
  prevTime = t

  const active = frame.active
  active.fill(0)
  let signature = ''
  for (let i = frame.lo; i < frame.hi; i++) {
    const n = notes[i]
    if (n.time > t) break
    if (n.time + n.duration > t && n.midi >= MIDI_MIN && n.midi <= MIDI_MAX && !active[n.midi]) {
      active[n.midi] = n.hand + 1
    }
  }
  for (let m = MIDI_MIN; m <= MIDI_MAX; m++) if (active[m]) signature += m + ','

  // Only notify React subscribers when the set of pressed keys actually changes.
  if (signature !== lastSignature) {
    lastSignature = signature
    const keys: number[] = []
    for (let m = MIDI_MIN; m <= MIDI_MAX; m++) if (active[m]) keys.push(m)
    state.setActiveKeys(keys)
  }
}

/** World units: one white key is 1 unit wide; the hit line is y = 0; notes fall along -y. */
export const MIDI_MIN = 21
export const MIDI_MAX = 108
export const WHITE_COUNT = 52
export const KEYBOARD_WIDTH = WHITE_COUNT
export const WHITE_LENGTH = 6.5
export const BLACK_LENGTH = 4.1
export const WHITE_WIDTH = 1
export const BLACK_WIDTH = 0.58
/** Fall speed in world units per second of song time. */
export const FALL_SPEED = 9

export interface KeyInfo {
  midi: number
  black: boolean
  /** Center x in world units. */
  x: number
  /** Width of a falling note bar on this key. */
  noteWidth: number
  /** Instance index within the white or black key mesh. */
  index: number
}

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

export const KEYS: KeyInfo[] = (() => {
  const keys: KeyInfo[] = []
  let white = 0
  let black = 0
  for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
    if (BLACK_PITCH_CLASSES.has(midi % 12)) {
      keys.push({ midi, black: true, x: white - WHITE_COUNT / 2, noteWidth: 0.52, index: black++ })
    } else {
      keys.push({ midi, black: false, x: white + 0.5 - WHITE_COUNT / 2, noteWidth: 0.86, index: white++ })
    }
  }
  return keys
})()

export const BLACK_COUNT = KEYS.length - WHITE_COUNT

export type AudioMode = 'soundfont' | 'audio-track'

export interface NoteEvent {
  midi: number
  /** Start time in seconds. */
  time: number
  /** Duration in seconds. */
  duration: number
  /** Normalized velocity, 0..1. */
  velocity: number
  track: number
  /** 0 = left hand, 1 = right hand. */
  hand: 0 | 1
}

/** Order matters: the index is the style id used by the background pulse shader. */
export const PULSE_STYLES = [
  { id: 'blot', label: 'Soft blots' },
  { id: 'ripple', label: 'Ripples' },
  { id: 'nebula', label: 'Nebula' },
  { id: 'bokeh', label: 'Bokeh' },
  { id: 'rays', label: 'Starbursts' },
] as const

export type PulseStyle = (typeof PULSE_STYLES)[number]['id']

export type NoteColorMode = 'solid' | 'hands' | 'gradient'

export const MAX_GRADIENT_STOPS = 6

export interface GradientStop {
  /** Hex color. */
  color: string
  /** Where the color sits along the gradient line, 0..1. Moving stops apart or together changes how much room each color gets. */
  position: number
}

export interface NoteColorSettings {
  mode: NoteColorMode
  /** Hex colors, e.g. "#ae9eff". */
  solid: string
  left: string
  right: string
  /** 2 to MAX_GRADIENT_STOPS colors placed along the gradient line. */
  gradientStops: GradientStop[]
  /** Degrees, CSS convention: 0 = bottom to top, 90 = left to right. */
  gradientAngle: number
}

export interface TrackInfo {
  index: number
  name: string
  instrument: string
  noteCount: number
}

export interface ParsedMidi {
  name: string
  duration: number
  bpm: number
  tracks: TrackInfo[]
  /** All notes across tracks, sorted by start time. */
  notes: NoteEvent[]
}

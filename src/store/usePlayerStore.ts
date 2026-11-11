import { create } from 'zustand'
import type { AudioMode, NoteColorSettings, NoteEvent, ParsedMidi, PulseStyle, TrackInfo } from '../types'

export interface PlayerState {
  // --- source selection ---
  audioMode: AudioMode

  // --- transport ---
  isPlaying: boolean
  /** Song position in seconds. Throttled UI mirror of the engine clock; the render loop reads the engine directly. */
  currentTime: number
  /** Song length in seconds (MIDI length, extended by the audio track when one is loaded). */
  duration: number
  /** Tempo multiplier, 1 = original speed. */
  playbackRate: number
  /** Master volume, 0..1. Applies to whichever source is active. */
  volume: number

  // --- MIDI ---
  midiFile: File | null
  midiName: string
  midiDuration: number
  bpm: number
  tracks: TrackInfo[]
  parsedNotes: NoteEvent[]
  /** MIDI numbers currently sounding at the play head. */
  activeKeys: number[]

  // --- audio track ---
  audioFile: File | null
  audioUrl: string | null
  audioDuration: number
  /** Seconds of lead-in to skip in the audio file so it lines up with MIDI time 0. */
  audioOffset: number

  // --- appearance ---
  noteColors: NoteColorSettings
  /** Blots of note color pulse in the background whenever a note strikes the keyboard. */
  backgroundPulses: boolean
  pulseStyle: PulseStyle

  // --- status ---
  soundfontReady: boolean
  soundfontProgress: number
  error: string | null

  // --- state setters (playback side effects live in audio/playbackEngine.ts) ---
  setAudioMode: (mode: AudioMode) => void
  setIsPlaying: (isPlaying: boolean) => void
  setCurrentTime: (time: number) => void
  setPlaybackRate: (rate: number) => void
  setVolume: (volume: number) => void
  setMidi: (file: File, parsed: ParsedMidi) => void
  setAudioTrack: (file: File, url: string) => void
  setAudioDuration: (duration: number) => void
  clearAudioTrack: () => void
  setAudioOffset: (offset: number) => void
  setActiveKeys: (keys: number[]) => void
  setNoteColors: (patch: Partial<NoteColorSettings>) => void
  setBackgroundPulses: (enabled: boolean) => void
  setPulseStyle: (style: PulseStyle) => void
  setSoundfontStatus: (ready: boolean, progress: number) => void
  setError: (error: string | null) => void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const songDuration = (midiDuration: number, audioDuration: number, audioOffset: number) =>
  Math.max(midiDuration, audioDuration > 0 ? audioDuration - audioOffset : 0, 0)

export const usePlayerStore = create<PlayerState>()((set) => ({
  audioMode: 'soundfont',

  isPlaying: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  volume: 0.8,

  midiFile: null,
  midiName: '',
  midiDuration: 0,
  bpm: 120,
  tracks: [],
  parsedNotes: [],
  activeKeys: [],

  audioFile: null,
  audioUrl: null,
  audioDuration: 0,
  audioOffset: 0,

  noteColors: {
    mode: 'gradient',
    solid: '#ae9eff',
    left: '#5cc8ff',
    right: '#ae9eff',
    gradientStops: [
      { color: '#ffc4d4', position: 0 },
      { color: '#ae9eff', position: 1 },
    ],
    gradientAngle: 0,
  },
  backgroundPulses: true,
  pulseStyle: 'blot',

  soundfontReady: false,
  soundfontProgress: 0,
  error: null,

  setAudioMode: (audioMode) => set({ audioMode }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setPlaybackRate: (rate) => set({ playbackRate: clamp(rate, 0.25, 2) }),
  setVolume: (volume) => set({ volume: clamp(volume, 0, 1) }),

  setMidi: (file, parsed) =>
    set((s) => ({
      midiFile: file,
      midiName: parsed.name,
      midiDuration: parsed.duration,
      bpm: parsed.bpm,
      tracks: parsed.tracks,
      parsedNotes: parsed.notes,
      activeKeys: [],
      currentTime: 0,
      duration: songDuration(parsed.duration, s.audioDuration, s.audioOffset),
    })),

  setAudioTrack: (file, url) => set({ audioFile: file, audioUrl: url, audioDuration: 0 }),

  setAudioDuration: (audioDuration) =>
    set((s) => ({
      audioDuration,
      duration: songDuration(s.midiDuration, audioDuration, s.audioOffset),
    })),

  clearAudioTrack: () =>
    set((s) => ({
      audioFile: null,
      audioUrl: null,
      audioDuration: 0,
      audioMode: 'soundfont',
      duration: songDuration(s.midiDuration, 0, 0),
    })),

  setAudioOffset: (offset) =>
    set((s) => {
      const audioOffset = Math.max(0, offset)
      return { audioOffset, duration: songDuration(s.midiDuration, s.audioDuration, audioOffset) }
    }),

  setActiveKeys: (activeKeys) => set({ activeKeys }),
  setNoteColors: (patch) => set((s) => ({ noteColors: { ...s.noteColors, ...patch } })),
  setBackgroundPulses: (backgroundPulses) => set({ backgroundPulses }),
  setPulseStyle: (pulseStyle) => set({ pulseStyle }),
  setSoundfontStatus: (soundfontReady, soundfontProgress) => set({ soundfontReady, soundfontProgress }),
  setError: (error) => set({ error }),
}))

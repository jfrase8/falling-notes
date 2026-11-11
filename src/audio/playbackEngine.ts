import * as Tone from 'tone'
import { SplendidGrandPiano } from 'smplr'
import { parseMidiFile } from '../midi/parseMidi'
import { usePlayerStore } from '../store/usePlayerStore'
import type { AudioMode, NoteEvent } from '../types'

/**
 * Song time is mapped onto Transport ticks at a fixed reference tempo, so
 * `songSeconds = ticks / TICKS_PER_SECOND` regardless of the MIDI's own tempo map
 * (note times are already absolute seconds). The tempo control scales Transport BPM,
 * which speeds up both the tick clock and the note scheduler together.
 */
const PPQ = 480
const BASE_BPM = 120
const TICKS_PER_SECOND = (PPQ * BASE_BPM) / 60
/** Scheduler step, in ticks (50 ms of song time). */
const WINDOW_TICKS = 48
const WINDOW_SECONDS = WINDOW_TICKS / TICKS_PER_SECOND

const store = () => usePlayerStore.getState()

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

class PlaybackEngine {
  private ctx: AudioContext | null = null
  private piano: SplendidGrandPiano | null = null
  private audio: HTMLAudioElement | null = null

  private playing = false
  /** Authoritative song position whenever the active clock is not running. */
  private position = 0

  // soundfont clock
  /** Context time before which Transport ticks are stale (start/seek take effect after Tone's look-ahead). */
  private holdUntil = 0
  /** Song time up to which notes have been handed to the sampler. */
  private scheduledUpTo = 0

  // audio-track clock (HTMLAudioElement.currentTime is too coarse per frame; interpolate with performance.now)
  private audioRunning = false
  private anchorMedia = 0
  private anchorPerf = 0
  private lastMedia = 0
  private lastMediaPerf = 0

  get isPlaying() {
    return this.playing
  }

  // ---------------------------------------------------------------- setup

  private ensureContext() {
    if (this.ctx) return
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx
    // Share one native context between Tone (clock) and smplr (sampler).
    Tone.setContext(ctx)

    const transport = Tone.getTransport()
    transport.PPQ = PPQ
    transport.bpm.value = BASE_BPM * store().playbackRate
    transport.scheduleRepeat(this.scheduleWindow, `${WINDOW_TICKS}i`, 0)

    this.piano = SplendidGrandPiano(ctx, {
      volume: store().volume * 127,
      onLoadProgress: ({ loaded, total }) => {
        if (!store().soundfontReady) store().setSoundfontStatus(false, total ? loaded / total : 0)
      },
    })
    this.piano.ready
      .then(() => store().setSoundfontStatus(true, 1))
      .catch((e: unknown) => store().setError(`Failed to load piano samples: ${String(e)}`))
  }

  /** Transport callback: hand the next slice of notes to the sampler with sample-accurate times. */
  private scheduleWindow = (time: number) => {
    const piano = this.piano
    if (!piano || !this.playing || store().audioMode !== 'soundfont') return
    const { parsedNotes, playbackRate } = store()

    const windowStart = Tone.getTransport().getTicksAtTime(time) / TICKS_PER_SECOND
    const windowEnd = windowStart + WINDOW_SECONDS
    // After a start/seek the first callback lands on the next step boundary; pick up the gap.
    const gap = windowStart - this.scheduledUpTo
    const from = gap > 0 && gap < 4 * WINDOW_SECONDS ? this.scheduledUpTo : windowStart
    this.scheduledUpTo = windowEnd

    const now = this.ctx!.currentTime
    for (let i = lowerBound(parsedNotes, from); i < parsedNotes.length; i++) {
      const n = parsedNotes[i]
      if (n.time >= windowEnd) break
      piano.start({
        note: n.midi,
        velocity: Math.round(n.velocity * 127),
        time: Math.max(now, time + (n.time - windowStart) / playbackRate),
        duration: n.duration / playbackRate,
      })
    }
  }

  private ensureAudioElement(): HTMLAudioElement {
    if (this.audio) return this.audio
    const audio = new Audio()
    audio.preload = 'auto'
    audio.preservesPitch = true
    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration)) store().setAudioDuration(audio.duration)
    })
    audio.addEventListener('ended', () => {
      if (this.playing && store().audioMode === 'audio-track') this.pause()
    })
    audio.addEventListener('error', () => {
      if (audio.src) store().setError('Could not decode the audio file.')
    })
    this.audio = audio
    return audio
  }

  // ---------------------------------------------------------------- loading

  async loadMidi(file: File) {
    try {
      const parsed = await parseMidiFile(file)
      if (parsed.notes.length === 0) throw new Error('No playable notes found in this MIDI file.')
      this.pause()
      this.position = 0
      store().setError(null)
      store().setMidi(file, parsed)
      this.ensureContext()
    } catch (e) {
      store().setError(e instanceof Error ? e.message : String(e))
    }
  }

  loadAudio(file: File) {
    this.pause()
    const prev = store().audioUrl
    if (prev) URL.revokeObjectURL(prev)
    const url = URL.createObjectURL(file)
    const audio = this.ensureAudioElement()
    audio.src = url
    audio.volume = store().volume
    audio.load()
    store().setError(null)
    store().setAudioTrack(file, url)
    this.setMode('audio-track')
  }

  removeAudio() {
    const t = this.getTime()
    this.pause()
    this.position = t
    const { audioUrl } = store()
    if (this.audio) {
      this.audio.removeAttribute('src')
      this.audio.load()
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    store().clearAudioTrack()
  }

  // ---------------------------------------------------------------- clock

  /** Current song position in seconds. Cheap; call once per rendered frame. */
  getTime(): number {
    if (!this.playing) return this.position
    if (store().audioMode === 'soundfont') {
      const ctx = this.ctx!
      if (ctx.currentTime < this.holdUntil) return this.position
      // Subtract output latency so visuals line up with what is heard, not what was queued.
      const heard = ctx.currentTime - (ctx.outputLatency || 0)
      return Math.max(this.position, Tone.getTransport().getTicksAtTime(heard) / TICKS_PER_SECOND)
    }
    return Math.max(0, this.audioClock() - store().audioOffset)
  }

  private audioClock(): number {
    const a = this.audio!
    const media = a.currentTime
    const now = performance.now()

    if (a.paused || a.seeking || a.readyState < 3) {
      this.audioRunning = false
      this.lastMedia = media
      return media
    }
    if (!this.audioRunning) {
      if (media === this.lastMedia) return media
      this.audioRunning = true
      this.anchorMedia = this.lastMedia = media
      this.anchorPerf = this.lastMediaPerf = now
      return media
    }

    const predicted = this.anchorMedia + ((now - this.anchorPerf) / 1000) * a.playbackRate
    if (media !== this.lastMedia) {
      this.lastMedia = media
      this.lastMediaPerf = now
      const err = media - predicted
      if (Math.abs(err) > 0.08) {
        this.anchorMedia = media
        this.anchorPerf = now
        return media
      }
      // Nudge toward the element's clock so interpolation never drifts.
      this.anchorMedia += err * 0.1
      return predicted + err * 0.1
    }
    if (now - this.lastMediaPerf > 250) {
      // Element stopped reporting progress (buffering); stop extrapolating.
      this.audioRunning = false
      return media
    }
    return predicted
  }

  // ---------------------------------------------------------------- transport

  private startSource() {
    const { audioMode, audioOffset, playbackRate } = store()
    if (audioMode === 'soundfont') {
      const transport = Tone.getTransport()
      transport.ticks = Math.round(this.position * TICKS_PER_SECOND)
      this.scheduledUpTo = this.position
      transport.start()
      this.holdUntil = transport.now() + 0.005
    } else {
      const a = this.audio!
      a.playbackRate = playbackRate
      a.currentTime = this.position + audioOffset
      this.audioRunning = false
      this.lastMedia = a.currentTime
      a.play().catch((e: unknown) => {
        store().setError(`Audio playback failed: ${String(e)}`)
        this.pause()
      })
    }
  }

  private haltSource() {
    if (store().audioMode === 'soundfont') {
      if (this.ctx) Tone.getTransport().pause()
      this.piano?.stop()
    } else {
      this.audio?.pause()
    }
    this.audioRunning = false
  }

  private canPlay(mode: AudioMode): boolean {
    const s = store()
    if (s.duration <= 0) return false
    return mode === 'soundfont' ? s.parsedNotes.length > 0 : !!s.audioUrl
  }

  async play() {
    if (this.playing || !this.canPlay(store().audioMode)) return
    this.ensureContext()
    await Tone.start()
    if (this.playing) return
    if (this.position >= store().duration - 0.01) this.position = 0
    this.playing = true
    this.startSource()
    store().setIsPlaying(true)
  }

  pause() {
    if (!this.playing) return
    const t = this.getTime()
    this.haltSource()
    this.playing = false
    this.position = t
    store().setIsPlaying(false)
    store().setCurrentTime(t)
  }

  toggle() {
    if (this.playing) this.pause()
    else void this.play()
  }

  seek(time: number) {
    const t = Math.min(Math.max(time, 0), store().duration)
    this.position = t
    if (this.playing) {
      if (store().audioMode === 'soundfont') {
        const transport = Tone.getTransport()
        this.piano?.stop()
        transport.ticks = Math.round(t * TICKS_PER_SECOND)
        this.scheduledUpTo = t
        this.holdUntil = transport.now() + 0.005
      } else {
        const a = this.audio!
        a.currentTime = t + store().audioOffset
        this.audioRunning = false
        this.lastMedia = a.currentTime
      }
    }
    store().setCurrentTime(t)
  }

  /** Switch the sound source without losing the play head. */
  setMode(mode: AudioMode) {
    if (mode === store().audioMode) return
    if (mode === 'audio-track' && !store().audioUrl) return
    const wasPlaying = this.playing
    const t = this.getTime()
    if (wasPlaying) this.haltSource()
    this.position = t
    store().setAudioMode(mode)
    if (wasPlaying) {
      if (this.canPlay(mode)) this.startSource()
      else {
        this.playing = false
        store().setIsPlaying(false)
      }
    }
  }

  setRate(rate: number) {
    store().setPlaybackRate(rate)
    const r = store().playbackRate
    if (this.ctx) Tone.getTransport().bpm.value = BASE_BPM * r
    if (this.audio) {
      this.audio.playbackRate = r
      this.audioRunning = false
    }
  }

  setVolume(volume: number) {
    store().setVolume(volume)
    const v = store().volume
    if (this.piano) this.piano.output.volume = v * 127
    if (this.audio) this.audio.volume = v
  }

  setAudioOffset(offset: number) {
    const t = this.getTime()
    store().setAudioOffset(offset)
    if (store().audioMode === 'audio-track') this.seek(t)
  }

  /** Per-frame housekeeping: stop at the end of the song. Returns the current time. */
  tick(): number {
    const t = this.getTime()
    const { duration } = store()
    if (this.playing && duration > 0 && t >= duration) {
      this.pause()
      this.position = duration
      store().setCurrentTime(duration)
      return duration
    }
    return t
  }
}

export const playbackEngine = new PlaybackEngine()

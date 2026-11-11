import { useEffect } from 'react'
import { playbackEngine } from './playbackEngine'
import { usePlayerStore } from '../store/usePlayerStore'

/**
 * Mount once at the app root. Mirrors the engine clock into the store for UI
 * (throttled — the 3D scene reads `playbackEngine.getTime()` directly every frame),
 * handles end-of-song, and binds the space bar to play/pause.
 */
export function usePlaybackSync() {
  useEffect(() => {
    let raf = 0
    let lastPush = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const t = playbackEngine.tick()
      if (playbackEngine.isPlaying && now - lastPush > 66) {
        lastPush = now
        usePlayerStore.getState().setCurrentTime(t)
      }
    }
    raf = requestAnimationFrame(loop)

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.code !== 'Space' || (el && /^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(el.tagName) && (el as HTMLInputElement).type !== 'range')) return
      e.preventDefault()
      playbackEngine.toggle()
    }
    window.addEventListener('keydown', onKey)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
}

/** Transport controls for UI components. All methods are stable references. */
export const playback = {
  loadMidi: (file: File) => playbackEngine.loadMidi(file),
  loadAudio: (file: File) => playbackEngine.loadAudio(file),
  removeAudio: () => playbackEngine.removeAudio(),
  play: () => playbackEngine.play(),
  pause: () => playbackEngine.pause(),
  toggle: () => playbackEngine.toggle(),
  seek: (time: number) => playbackEngine.seek(time),
  setMode: (mode: Parameters<typeof playbackEngine.setMode>[0]) => playbackEngine.setMode(mode),
  setRate: (rate: number) => playbackEngine.setRate(rate),
  setVolume: (volume: number) => playbackEngine.setVolume(volume),
  setAudioOffset: (offset: number) => playbackEngine.setAudioOffset(offset),
}

import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import { playback } from '../audio/usePlayback'
import { usePlayerStore } from '../store/usePlayerStore'
import { GradientEditor, gradientCss } from './GradientEditor'
import { PULSE_STYLES, type NoteColorMode, type PulseStyle } from '../types'

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const COLOR_MODES: [NoteColorMode, string][] = [
  ['solid', 'Solid'],
  ['hands', 'Two hands'],
  ['gradient', 'Gradient'],
]

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <label className="field">
      {label}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

export function Controls() {
  const midiInput = useRef<HTMLInputElement>(null)
  const audioInput = useRef<HTMLInputElement>(null)

  const audioMode = usePlayerStore((s) => s.audioMode)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const playbackRate = usePlayerStore((s) => s.playbackRate)
  const volume = usePlayerStore((s) => s.volume)
  const midiFile = usePlayerStore((s) => s.midiFile)
  const audioFile = usePlayerStore((s) => s.audioFile)
  const audioOffset = usePlayerStore((s) => s.audioOffset)
  const soundfontReady = usePlayerStore((s) => s.soundfontReady)
  const soundfontProgress = usePlayerStore((s) => s.soundfontProgress)
  const error = usePlayerStore((s) => s.error)
  const noteColors = usePlayerStore((s) => s.noteColors)
  const setNoteColors = usePlayerStore((s) => s.setNoteColors)
  const backgroundPulses = usePlayerStore((s) => s.backgroundPulses)
  const setBackgroundPulses = usePlayerStore((s) => s.setBackgroundPulses)
  const pulseStyle = usePlayerStore((s) => s.pulseStyle)
  const setPulseStyle = usePlayerStore((s) => s.setPulseStyle)

  // --- panel chrome: drag by the header, collapse to the header, or hide entirely ---
  const panelRef = useRef<HTMLDivElement>(null)
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  // 'button' (the × button) leaves a small reopen button; 'full' (the H key) leaves nothing on screen.
  const [hidden, setHidden] = useState<false | 'button' | 'full'>(false)

  const onDragStart = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button') || !panelRef.current) return
    const rect = panelRef.current.getBoundingClientRect()
    dragOffset.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: PointerEvent<HTMLDivElement>) => {
    const offset = dragOffset.current
    if (!offset || !panelRef.current) return
    const rect = panelRef.current.getBoundingClientRect()
    // Keep the header reachable: never let the panel leave the window.
    setPos({
      x: Math.min(Math.max(e.clientX - offset.dx, 0), Math.max(window.innerWidth - rect.width, 0)),
      y: Math.min(Math.max(e.clientY - offset.dy, 0), Math.max(window.innerHeight - 40, 0)),
    })
  }
  const onDragEnd = () => {
    dragOffset.current = null
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.code !== 'KeyH' || e.ctrlKey || e.metaKey || e.altKey) return
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && (el as HTMLInputElement).type !== 'range') return
      setHidden((h) => (h ? false : 'full'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onMidi = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void playback.loadMidi(file)
    e.target.value = ''
  }
  const onAudio = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) playback.loadAudio(file)
    e.target.value = ''
  }

  const loadingPiano = audioMode === 'soundfont' && !!midiFile && !soundfontReady
  const canPlay = duration > 0 && !loadingPiano && (audioMode === 'soundfont' ? !!midiFile : !!audioFile)

  if (hidden === 'full') {
    // Nothing stays on screen; the hint fades out after a moment.
    return (
      <div className="hide-hint" role="status">
        Press H to show settings
      </div>
    )
  }

  if (hidden) {
    return (
      <button className="reopen" onClick={() => setHidden(false)} title="Show settings (H)">
        ⚙ Settings
      </button>
    )
  }

  return (
    <div
      ref={panelRef}
      className={collapsed ? 'controls collapsed' : 'controls'}
      style={pos ? { left: pos.x, top: pos.y, transform: 'none' } : undefined}
    >
      <div
        className="panel-header"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        title="Drag to move"
      >
        <span className="grip" aria-hidden>
          ⠿
        </span>
        <span className="row-label">Settings</span>
        {collapsed && (
          <>
            <button className="play" disabled={!canPlay} onClick={playback.toggle} aria-label={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? '❚❚' : '▶'}
            </button>
            <span className="time">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </>
        )}
        <span className="spacer" />
        <button
          className="icon"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand' : 'Collapse'}
          aria-label={collapsed ? 'Expand settings' : 'Collapse settings'}
          aria-expanded={!collapsed}
        >
          {collapsed ? '▾' : '▴'}
        </button>
        <button className="icon" onClick={() => setHidden('button')} title="Hide settings (press H to hide completely)" aria-label="Hide settings">
          ×
        </button>
      </div>

      {!collapsed && (
        <>
      <div className="row">
        <input ref={midiInput} type="file" accept=".mid,.midi,audio/midi" hidden onChange={onMidi} />
        <input ref={audioInput} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" hidden onChange={onAudio} />

        <button className="file" onClick={() => midiInput.current?.click()} title="Upload a MIDI file">
          <span className="label">MIDI</span>
          <span className="name">{midiFile?.name ?? 'Choose .mid'}</span>
        </button>
        <button className="file" onClick={() => audioInput.current?.click()} title="Upload an MP3 or WAV to play instead of the piano samples">
          <span className="label">Audio</span>
          <span className="name">{audioFile?.name ?? 'Choose .mp3 / .wav'}</span>
        </button>
        {audioFile && (
          <button className="icon" onClick={playback.removeAudio} title="Remove audio track" aria-label="Remove audio track">
            ×
          </button>
        )}

        <div className="segmented" role="group" aria-label="Sound source">
          <button className={audioMode === 'soundfont' ? 'on' : ''} onClick={() => playback.setMode('soundfont')}>
            Piano
          </button>
          <button
            className={audioMode === 'audio-track' ? 'on' : ''}
            disabled={!audioFile}
            onClick={() => playback.setMode('audio-track')}
          >
            Audio track
          </button>
        </div>

        {audioMode === 'audio-track' && (
          <label className="field" title="Seconds of lead-in to skip in the audio file so it lines up with the MIDI">
            Offset
            <input
              type="number"
              min={0}
              step={0.01}
              value={audioOffset}
              onChange={(e) => playback.setAudioOffset(Number(e.target.value) || 0)}
            />
            s
          </label>
        )}

        <span className="spacer" />

        <label className="field">
          Tempo
          <input
            type="range"
            min={0.25}
            max={2}
            step={0.05}
            value={playbackRate}
            onChange={(e) => playback.setRate(Number(e.target.value))}
            onDoubleClick={() => playback.setRate(1)}
          />
          <span className="value">{Math.round(playbackRate * 100)}%</span>
        </label>
        <label className="field">
          Volume
          <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => playback.setVolume(Number(e.target.value))} />
        </label>
      </div>

      <div className="row">
        <button className="play" disabled={!canPlay} onClick={playback.toggle} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? '❚❚' : '▶'}
        </button>
        <span className="time">{formatTime(currentTime)}</span>
        <input
          className="seek"
          type="range"
          min={0}
          max={duration || 1}
          step={0.01}
          value={Math.min(currentTime, duration || 1)}
          disabled={duration <= 0}
          onChange={(e) => playback.seek(Number(e.target.value))}
          aria-label="Seek"
        />
        <span className="time">{formatTime(duration)}</span>
      </div>

      <div className="row">
        <span className="row-label">Note colors</span>
        <div className="segmented" role="group" aria-label="Note color mode">
          {COLOR_MODES.map(([mode, label]) => (
            <button key={mode} className={noteColors.mode === mode ? 'on' : ''} onClick={() => setNoteColors({ mode })}>
              {label}
            </button>
          ))}
        </div>

        {noteColors.mode === 'solid' && (
          <ColorField label="Color" value={noteColors.solid} onChange={(solid) => setNoteColors({ solid })} />
        )}
        {noteColors.mode === 'hands' && (
          <>
            <ColorField label="Left hand" value={noteColors.left} onChange={(left) => setNoteColors({ left })} />
            <ColorField label="Right hand" value={noteColors.right} onChange={(right) => setNoteColors({ right })} />
          </>
        )}
        {noteColors.mode === 'gradient' && (
          <>
            <label className="field" title="0° runs bottom to top, 90° left to right">
              Angle
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={noteColors.gradientAngle}
                onChange={(e) => setNoteColors({ gradientAngle: Number(e.target.value) })}
              />
              <span className="value">{noteColors.gradientAngle}°</span>
            </label>
            <span
              className="gradient-preview"
              style={{ background: gradientCss(noteColors.gradientStops, noteColors.gradientAngle) }}
              aria-hidden
            />
          </>
        )}

        <span className="spacer" />
        <label className="field check" title="Blots of note color pulse in the background when notes strike the keys">
          <input type="checkbox" checked={backgroundPulses} onChange={(e) => setBackgroundPulses(e.target.checked)} />
          Background pulses
        </label>
        <select
          className="select"
          value={pulseStyle}
          disabled={!backgroundPulses}
          onChange={(e) => setPulseStyle(e.target.value as PulseStyle)}
          aria-label="Background pulse style"
          title="Background pulse style"
        >
          {PULSE_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {noteColors.mode === 'gradient' && (
        <div className="row">
          <span className="row-label">Gradient</span>
          <GradientEditor stops={noteColors.gradientStops} onChange={(gradientStops) => setNoteColors({ gradientStops })} />
        </div>
      )}
        </>
      )}

      {(error || loadingPiano) && (
        <div className={error ? 'status error' : 'status'}>
          {error ?? `Loading piano samples… ${Math.round(soundfontProgress * 100)}%`}
        </div>
      )}
    </div>
  )
}

import { useRef, type PointerEvent } from 'react'
import { MAX_GRADIENT_STOPS, type GradientStop } from '../types'

const MIN_STOPS = 2
/** Neighboring stops cannot be dragged closer than this (fraction of the line). */
const MIN_GAP = 0.01

function mixHex(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return (
    '#' +
    [0, 1, 2]
      .map((i) =>
        Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * t)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}

export function gradientCss(stops: GradientStop[], angle: number): string {
  return `linear-gradient(${angle}deg, ${stops.map((s) => `${s.color} ${(s.position * 100).toFixed(1)}%`).join(', ')})`
}

interface Props {
  /** Sorted by position. */
  stops: GradientStop[]
  onChange: (stops: GradientStop[]) => void
}

/**
 * Gradient line editor: drag a handle to give its color more or less room, edit the
 * swatches to recolor, and add or remove colors.
 */
export function GradientEditor({ stops, onChange }: Props) {
  const barRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<number | null>(null)

  const update = (index: number, patch: Partial<GradientStop>) =>
    onChange(stops.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  const moveTo = (index: number, clientX: number) => {
    const bar = barRef.current
    if (!bar) return
    const rect = bar.getBoundingClientRect()
    // Stops keep their order: each can travel only between its neighbors.
    const lo = index > 0 ? stops[index - 1].position + MIN_GAP : 0
    const hi = index < stops.length - 1 ? stops[index + 1].position - MIN_GAP : 1
    const position = Math.min(Math.max((clientX - rect.left) / rect.width, lo), hi)
    update(index, { position: Math.round(position * 1000) / 1000 })
  }

  const onPointerDown = (index: number) => (e: PointerEvent<HTMLButtonElement>) => {
    dragging.current = index
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (dragging.current !== null) moveTo(dragging.current, e.clientX)
  }
  const onPointerUp = () => {
    dragging.current = null
  }

  const nudge = (index: number, delta: number) => {
    const lo = index > 0 ? stops[index - 1].position + MIN_GAP : 0
    const hi = index < stops.length - 1 ? stops[index + 1].position - MIN_GAP : 1
    update(index, { position: Math.min(Math.max(stops[index].position + delta, lo), hi) })
  }

  /** New colors go in the middle of the widest gap, starting as the blend already shown there. */
  const addStop = () => {
    let widest = 0
    for (let i = 1; i < stops.length - 1; i++) {
      if (stops[i + 1].position - stops[i].position > stops[widest + 1].position - stops[widest].position) widest = i
    }
    const a = stops[widest]
    const b = stops[widest + 1]
    const next = [...stops]
    next.splice(widest + 1, 0, { color: mixHex(a.color, b.color, 0.5), position: (a.position + b.position) / 2 })
    onChange(next)
  }

  const removeStop = (index: number) => onChange(stops.filter((_, i) => i !== index))

  return (
    <div className="gradient-editor">
      <div ref={barRef} className="gradient-bar" style={{ background: gradientCss(stops, 90) }}>
        {stops.map((stop, i) => (
          <button
            key={i}
            className="gradient-handle"
            style={{ left: `${stop.position * 100}%`, background: stop.color }}
            onPointerDown={onPointerDown(i)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') nudge(i, -0.01)
              if (e.key === 'ArrowRight') nudge(i, 0.01)
            }}
            role="slider"
            aria-label={`Color ${i + 1} position`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(stop.position * 100)}
            title={`Drag to move (${Math.round(stop.position * 100)}%)`}
          />
        ))}
      </div>

      <div className="gradient-stops">
        {stops.map((stop, i) => (
          <span key={i} className="gradient-stop">
            <input
              type="color"
              value={stop.color}
              onChange={(e) => update(i, { color: e.target.value })}
              aria-label={`Color ${i + 1}`}
            />
            {stops.length > MIN_STOPS && (
              <button className="stop-remove" onClick={() => removeStop(i)} title="Remove this color" aria-label={`Remove color ${i + 1}`}>
                ×
              </button>
            )}
          </span>
        ))}
        <button onClick={addStop} disabled={stops.length >= MAX_GRADIENT_STOPS} title={`Add a color (up to ${MAX_GRADIENT_STOPS})`}>
          + Add color
        </button>
      </div>
    </div>
  )
}

import * as THREE from 'three'
import { MAX_GRADIENT_STOPS, type NoteColorSettings } from '../types'
import { KEYBOARD_WIDTH } from './layout'

export const MODE_SOLID = 0
export const MODE_HANDS = 1
export const MODE_GRADIENT = 2

/**
 * Resolved note palette in linear color space. `colorAt` mirrors the shader's math on the
 * CPU so pressed keys, sparks and background pulses get exactly the color of the note
 * that is striking them.
 */
export const palette = {
  mode: MODE_GRADIENT,
  /** Solid color / left hand. */
  a: new THREE.Color(),
  /** Right hand. */
  b: new THREE.Color(),
  /** Gradient stops, sorted by position; only the first `stopCount` are used. */
  stops: Array.from({ length: MAX_GRADIENT_STOPS }, () => new THREE.Color()),
  stopPositions: new Array<number>(MAX_GRADIENT_STOPS).fill(0),
  stopCount: 2,
  /** Gradient: direction x, direction y, center y, extent along the direction. */
  gradient: new THREE.Vector4(0, 1, 0, 1),
}

/**
 * Uniforms for NOTE_COLOR_GLSL. Spread these into a material's uniforms: the inner
 * `{ value }` objects are shared, so every material follows the palette automatically.
 */
export const paletteUniforms = {
  uMode: { value: palette.mode },
  uColorA: { value: palette.a },
  uColorB: { value: palette.b },
  uGradient: { value: palette.gradient },
  uStops: { value: palette.stops },
  uStopPositions: { value: palette.stopPositions },
  uStopCount: { value: palette.stopCount },
}

/** Fragment shader chunk: `noteColor(hand, worldXY)`. Keep in sync with colorAt() below. */
export const NOTE_COLOR_GLSL = /* glsl */ `
  uniform int uMode;      // 0 solid, 1 per hand, 2 gradient across the note field
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec4 uGradient; // direction x, direction y, center y, extent
  uniform vec3 uStops[${MAX_GRADIENT_STOPS}];
  uniform float uStopPositions[${MAX_GRADIENT_STOPS}];
  uniform int uStopCount;

  vec3 gradientColor(float t) {
    vec3 c = uStops[0];
    for (int i = 1; i < ${MAX_GRADIENT_STOPS}; i++) {
      if (i >= uStopCount) break;
      float span = max(uStopPositions[i] - uStopPositions[i - 1], 1e-4);
      c = mix(c, uStops[i], clamp((t - uStopPositions[i - 1]) / span, 0.0, 1.0));
    }
    return c;
  }

  float gradientCoord(vec2 world) {
    return clamp(0.5 + dot(world - vec2(0.0, uGradient.z), uGradient.xy) / uGradient.w, 0.0, 1.0);
  }

  vec3 noteColor(float hand, vec2 world) {
    if (uMode == 1) return hand >= 0.5 ? uColorB : uColorA;
    if (uMode == 2) return gradientColor(gradientCoord(world));
    return uColorA;
  }
`

let lastSettings: NoteColorSettings | null = null
let lastFieldHeight = -1

/** Call once per frame; recomputes only when the settings or the viewport change. */
export function syncPalette(settings: NoteColorSettings, fieldHeight: number) {
  if (settings === lastSettings && fieldHeight === lastFieldHeight) return
  lastSettings = settings
  lastFieldHeight = fieldHeight

  if (settings.mode === 'solid') {
    palette.mode = MODE_SOLID
    palette.a.set(settings.solid)
    palette.b.set(settings.solid)
  } else if (settings.mode === 'hands') {
    palette.mode = MODE_HANDS
    palette.a.set(settings.left)
    palette.b.set(settings.right)
  } else {
    palette.mode = MODE_GRADIENT
    const stops = [...settings.gradientStops].sort((p, q) => p.position - q.position).slice(0, MAX_GRADIENT_STOPS)
    palette.stopCount = Math.max(stops.length, 1)
    stops.forEach((stop, i) => {
      palette.stops[i].set(stop.color)
      palette.stopPositions[i] = stop.position
    })
    const angle = THREE.MathUtils.degToRad(settings.gradientAngle)
    const dx = Math.sin(angle)
    const dy = Math.cos(angle)
    // Span the whole note field (keyboard width x visible height above the hit line).
    const extent = Math.max(KEYBOARD_WIDTH * Math.abs(dx) + fieldHeight * Math.abs(dy), 1e-3)
    palette.gradient.set(dx, dy, fieldHeight / 2, extent)
  }

  paletteUniforms.uMode.value = palette.mode
  paletteUniforms.uStopCount.value = palette.stopCount
}

/** Color of a note of the given hand at world position (x, y). */
export function colorAt(hand: number, x: number, y: number, out: THREE.Color): THREE.Color {
  if (palette.mode === MODE_SOLID) return out.copy(palette.a)
  if (palette.mode === MODE_HANDS) return out.copy(hand >= 0.5 ? palette.b : palette.a)
  const g = palette.gradient
  const t = THREE.MathUtils.clamp(0.5 + (x * g.x + (y - g.z) * g.y) / g.w, 0, 1)
  out.copy(palette.stops[0])
  for (let i = 1; i < palette.stopCount; i++) {
    const span = Math.max(palette.stopPositions[i] - palette.stopPositions[i - 1], 1e-4)
    out.lerp(palette.stops[i], THREE.MathUtils.clamp((t - palette.stopPositions[i - 1]) / span, 0, 1))
  }
  return out
}

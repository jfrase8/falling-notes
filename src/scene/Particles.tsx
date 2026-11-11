import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { frame } from './frame'
import { KEYS, MIDI_MAX, MIDI_MIN } from './layout'
import { colorAt } from './noteColors'

const MAX_PARTICLES = 4000
/** Sparks emitted per second for each held key. */
const EMIT_RATE = 70
/** Extra sparks released the moment a key is struck. */
const STRIKE_BURST = 14

const vertexShader = /* glsl */ `
  attribute vec2 aLife;  // remaining life 0..1, size in world units
  attribute vec3 aColor;
  uniform float uPixelsPerUnit;
  varying float vLife;
  varying vec3 vColor;
  void main() {
    vLife = aLife.x;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Orthographic camera: size on screen does not depend on depth.
    gl_PointSize = aLife.x <= 0.0 ? 0.0 : aLife.y * (0.35 + 0.65 * aLife.x) * uPixelsPerUnit;
  }
`

const fragmentShader = /* glsl */ `
  varying float vLife;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = smoothstep(1.0, 0.0, d);
    // Sparks carry the color of the note that threw them: white-hot when new, saturated as they cool.
    vec3 hot = vColor * 2.2 + 0.5;
    vec3 ember = vColor * 1.8;
    vec3 col = mix(ember, hot, vLife * vLife);
    gl_FragColor = vec4(col * core * core * vLife, 1.0);
  }
`

export function Particles() {
  const sim = useMemo(() => {
    const positions = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3)
    const life = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 2), 2)
    positions.setUsage(THREE.DynamicDrawUsage)
    const colors = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3)
    life.setUsage(THREE.DynamicDrawUsage)
    colors.setUsage(THREE.DynamicDrawUsage)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', positions)
    geometry.setAttribute('aLife', life)
    geometry.setAttribute('aColor', colors)

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uPixelsPerUnit: { value: 1 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })

    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    points.renderOrder = 4

    return {
      points,
      positions,
      life,
      colors,
      tmpColor: new THREE.Color(),
      material,
      velocity: new Float32Array(MAX_PARTICLES * 2),
      decay: new Float32Array(MAX_PARTICLES),
      phase: new Float32Array(MAX_PARTICLES),
      emitDebt: new Float32Array(128),
      held: new Uint8Array(128),
      cursor: 0,
    }
  }, [])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const pos = sim.positions.array as Float32Array
    const life = sim.life.array as Float32Array
    const color = sim.colors.array as Float32Array
    const { velocity, decay, phase, emitDebt, held } = sim
    let emitted = false

    // Emit from every key that is being struck while the song is advancing.
    if (frame.playing) {
      for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
        if (!frame.active[midi]) {
          held[midi] = 0
          continue
        }
        const key = KEYS[midi - MIDI_MIN]
        if (!held[midi]) {
          held[midi] = 1
          emitDebt[midi] = STRIKE_BURST
        }
        emitDebt[midi] += EMIT_RATE * dt
        const c = colorAt(frame.active[midi] - 1, key.x, 0, sim.tmpColor)
        while (emitDebt[midi] >= 1) {
          emitDebt[midi] -= 1
          const i = sim.cursor
          sim.cursor = (sim.cursor + 1) % MAX_PARTICLES
          pos[i * 3] = key.x + (Math.random() - 0.5) * key.noteWidth
          pos[i * 3 + 1] = Math.random() * 0.25
          pos[i * 3 + 2] = 0.45
          velocity[i * 2] = (Math.random() - 0.5) * 3.2
          velocity[i * 2 + 1] = 1.5 + Math.random() * 6.5
          life[i * 2] = 1
          life[i * 2 + 1] = 0.14 + Math.random() * Math.random() * 0.55
          decay[i] = 1 / (0.45 + Math.random() * 1.1)
          phase[i] = Math.random() * Math.PI * 2
          color[i * 3] = c.r
          color[i * 3 + 1] = c.g
          color[i * 3 + 2] = c.b
          emitted = true
        }
      }
    }

    // Integrate: drift upward, slow down, and wander sideways like embers.
    const t = state.clock.elapsedTime
    const drag = Math.exp(-1.6 * dt)
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const l = life[i * 2]
      if (l <= 0) continue
      const next = l - decay[i] * dt
      if (next <= 0) {
        life[i * 2] = 0
        continue
      }
      life[i * 2] = next
      velocity[i * 2] = velocity[i * 2] * drag + Math.sin(phase[i] + t * 5.0) * 5.0 * dt
      velocity[i * 2 + 1] = velocity[i * 2 + 1] * drag + 0.6 * dt
      pos[i * 3] += velocity[i * 2] * dt
      pos[i * 3 + 1] += velocity[i * 2 + 1] * dt
    }

    sim.positions.needsUpdate = true
    sim.life.needsUpdate = true
    if (emitted) sim.colors.needsUpdate = true

    sim.material.uniforms.uPixelsPerUnit.value =
      (state.gl.domElement.height * state.camera.projectionMatrix.elements[5]) / 2
  })

  return <primitive object={sim.points} />
}

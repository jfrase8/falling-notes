import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { usePlayerStore } from '../store/usePlayerStore'
import { PULSE_STYLES } from '../types'
import { frame } from './frame'
import { KEYBOARD_WIDTH, KEYS, MIDI_MIN } from './layout'
import { colorAt } from './noteColors'

const MAX_BLOTS = 40
/** A big chord should not flood the background in a single frame. */
const MAX_SPAWNS_PER_FRAME = 4
/** Notes held at least this long get the largest blots. */
const LONG_NOTE_SECONDS = 2.5

const vertexShader = /* glsl */ `
  attribute vec4 aBlot;  // center x, center y, radius, intensity
  attribute vec4 aTint;  // rgb, shape seed
  attribute float aAge;  // 0..1 through the pulse's life
  varying vec2 vUv;
  varying vec4 vTint;
  varying float vIntensity;
  varying float vAge;
  void main() {
    vUv = uv;
    vTint = aTint;
    vIntensity = aBlot.w;
    vAge = aAge;
    vec3 p = vec3(position.xy * aBlot.z * 2.0 + aBlot.xy, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vTint;
  varying float vIntensity;
  varying float vAge;
  uniform int uStyle; // index into PULSE_STYLES

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * noise(p);
      p = p * 2.03 + 17.0;
      amp *= 0.5;
    }
    return sum;
  }

  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float r = length(q);
    float angle = atan(q.y, q.x);
    float seed = vTint.a;
    float edgeFade = smoothstep(1.0, 0.0, r);
    float shape;

    if (uStyle == 1) {
      // Ripples: a ring that travels outward, trailed by a fainter one, like a drop in water.
      float front = mix(0.12, 0.88, vAge);
      float width = 0.05 + 0.05 * vAge;
      float ring = exp(-pow((r - front) / width, 2.0));
      float trail = 0.4 * exp(-pow((r - front * 0.55) / width, 2.0));
      float wash = 0.12 * smoothstep(front, 0.0, r);
      shape = (ring + trail + wash) * 1.7;
    } else if (uStyle == 2) {
      // Nebula: wispy, drifting clouds.
      float cloud = fbm(q * 2.2 + seed * 10.0 + vec2(0.0, vAge * 0.5));
      shape = smoothstep(0.3, 0.75, cloud) * edgeFade * 2.2;
    } else if (uStyle == 3) {
      // Bokeh: out-of-focus discs with a crisp, slightly brighter rim.
      float d = r * 1.8;
      float disc = 1.0 - smoothstep(0.94, 1.0, d);
      shape = disc * (0.4 + 0.6 * smoothstep(0.55, 0.97, d)) * 0.8;
    } else if (uStyle == 4) {
      // Starbursts: a hot core throwing slowly turning rays.
      float a = angle + vAge * 0.7;
      float rays = pow(abs(sin(a * 3.0 + seed)), 10.0) + 0.5 * pow(abs(sin(a * 5.0 - seed * 2.0)), 16.0);
      float core = exp(-r * r * 22.0);
      shape = core * 1.6 + rays * edgeFade * edgeFade * exp(-r * 2.0) * 2.4;
    } else {
      // Soft blots: wobble the outline so each is an irregular stain rather than a perfect disc.
      float outline = 0.84 + 0.08 * sin(2.0 * angle + seed) + 0.05 * sin(3.0 * angle - seed * 1.7);
      shape = smoothstep(1.0, 0.0, r / outline);
      shape *= shape;
    }

    // Dither to hide banding in the long, dark gradients.
    float dither = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    gl_FragColor = vec4(vTint.rgb * shape * vIntensity + dither * smoothstep(0.0, 0.05, shape), 1.0);
  }
`

/**
 * Soft blots of color that bloom and fade behind the notes each time a note strikes the
 * keyboard, in that note's color, at a random spot on screen.
 */
export function BackgroundPulses() {
  const sim = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1)
    const blots = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOTS * 4), 4)
    const tints = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOTS * 4), 4)
    const ages = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOTS).fill(1), 1)
    blots.setUsage(THREE.DynamicDrawUsage)
    tints.setUsage(THREE.DynamicDrawUsage)
    ages.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('aBlot', blots)
    geometry.setAttribute('aTint', tints)
    geometry.setAttribute('aAge', ages)

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uStyle: { value: 0 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      // Depth-tested (but not written) so the opaque keyboard in front stays clean.
      depthWrite: false,
      toneMapped: false,
    })

    const mesh = new THREE.InstancedMesh(geometry, material, MAX_BLOTS)
    mesh.position.z = -2
    mesh.frustumCulled = false
    mesh.renderOrder = -1

    return {
      mesh,
      blots,
      tints,
      ages,
      material,
      age: ages.array as Float32Array, // 0..1, 1 = finished
      lifetime: new Float32Array(MAX_BLOTS).fill(1),
      radius: new Float32Array(MAX_BLOTS),
      growth: new Float32Array(MAX_BLOTS),
      peak: new Float32Array(MAX_BLOTS),
      cursor: 0,
      tmpColor: new THREE.Color(),
    }
  }, [])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const blot = sim.blots.array as Float32Array
    const tint = sim.tints.array as Float32Array
    const { age, lifetime, radius, growth, peak } = sim

    const { backgroundPulses, pulseStyle } = usePlayerStore.getState()
    sim.material.uniforms.uStyle.value = Math.max(0, PULSE_STYLES.findIndex((s) => s.id === pulseStyle))

    if (backgroundPulses) {
      const spawns = Math.min(frame.strikeCount, MAX_SPAWNS_PER_FRAME)
      for (let s = 0; s < spawns; s++) {
        const key = KEYS[frame.strikeMidi[s] - MIDI_MIN]
        const c = colorAt(frame.strikeHand[s], key.x, 0, sim.tmpColor)
        const i = sim.cursor
        sim.cursor = (sim.cursor + 1) % MAX_BLOTS
        blot[i * 4] = (Math.random() - 0.5) * KEYBOARD_WIDTH
        blot[i * 4 + 1] = Math.random() * frame.fieldHeight
        tint[i * 4] = c.r
        tint[i * 4 + 1] = c.g
        tint[i * 4 + 2] = c.b
        tint[i * 4 + 3] = Math.random() * Math.PI * 2
        // Longer-held notes make bigger blots that spread further and linger about as long as the note.
        const held = frame.strikeDuration[s]
        const sustain = Math.min(held / LONG_NOTE_SECONDS, 1)
        age[i] = 0
        lifetime[i] = 1.2 + Math.random() * 0.8 + Math.min(held, 4) * 0.8
        radius[i] = 3.5 + Math.random() * 3 + sustain * 8
        growth[i] = 0.3 + sustain * 0.9
        peak[i] = 0.13 + Math.random() * 0.09
      }
      if (spawns > 0) sim.tints.needsUpdate = true
    }

    for (let i = 0; i < MAX_BLOTS; i++) {
      if (age[i] >= 1) {
        blot[i * 4 + 2] = 0 // zero-size quad: costs nothing to draw
        continue
      }
      const a = (age[i] = Math.min(age[i] + dt / lifetime[i], 1))
      // Quick fade in, long fade out, while slowly spreading.
      const fadeIn = THREE.MathUtils.smoothstep(a, 0, 0.22)
      const fadeOut = 1 - THREE.MathUtils.smoothstep(a, 0.22, 1)
      blot[i * 4 + 2] = radius[i] * (0.7 + growth[i] * a)
      blot[i * 4 + 3] = peak[i] * fadeIn * fadeOut
    }
    sim.blots.needsUpdate = true
    sim.ages.needsUpdate = true
  })

  return <primitive object={sim.mesh} />
}

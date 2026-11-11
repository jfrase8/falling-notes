import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { frame } from './frame'
import { FALL_SPEED, KEYS, MIDI_MAX, MIDI_MIN } from './layout'
import { NOTE_COLOR_GLSL, paletteUniforms } from './noteColors'

const MAX_VISIBLE = 2048

const vertexShader = /* glsl */ `
  attribute vec4 aRect;   // center x, center y, width, height
  attribute vec2 aStyle;  // active flag, hand (0 left, 1 right)
  varying vec2 vUv;
  varying vec2 vSize;
  varying vec2 vWorld;
  varying vec2 vStyle;
  void main() {
    vUv = uv;
    vSize = aRect.zw;
    vStyle = aStyle;
    vec3 p = vec3(position.xy * aRect.zw + aRect.xy, 0.0);
    vWorld = p.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  ${NOTE_COLOR_GLSL}
  varying vec2 vUv;
  varying vec2 vSize;
  varying vec2 vWorld;
  varying vec2 vStyle;

  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    // The part of a note that has passed the hit line is consumed by the keyboard.
    if (vWorld.y < 0.0) discard;

    vec2 p = (vUv - 0.5) * vSize;
    vec2 halfSize = 0.5 * vSize;
    float minHalf = min(halfSize.x, halfSize.y);
    float r = min(0.2, minHalf);
    float d = sdRoundBox(p, halfSize, r);
    float aa = fwidth(d);
    float shape = 1.0 - smoothstep(-aa, aa, d);

    // Fake depth: treat the bar as a rounded glass rod. The distance to the edge gives a
    // circular height profile, from which we derive a surface normal and light it.
    vec2 q = abs(p) - halfSize + r;
    vec2 outward = (q.x > 0.0 && q.y > 0.0)
      ? normalize(q) * sign(p)
      : (q.x > q.y ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y)));
    float u = 1.0 - clamp(-d / minHalf, 0.0, 1.0); // 1 at the edge, 0 along the ridge
    float slope = u / sqrt(max(1.0 - u * u, 0.03));
    vec3 normal = normalize(vec3(outward * slope, 1.0));

    vec3 lightDir = normalize(vec3(-0.5, 0.55, 0.67));
    vec3 halfDir = normalize(lightDir + vec3(0.0, 0.0, 1.0));
    float diffuse = max(dot(normal, lightDir), 0.0);
    float specular = pow(max(dot(normal, halfDir), 0.0), 40.0);
    float rim = pow(u, 3.0);

    vec3 base = noteColor(vStyle.y, vWorld);
    float sheen = pow(0.5 + 0.5 * sin(vWorld.y * 0.55 + vWorld.x * 0.3 - uTime * 1.2), 6.0);

    vec3 col = base * (0.15 + 0.85 * diffuse + 0.5 * sheen);
    col += base * 1.7 * rim;
    col += vec3(1.3) * specular;
    float alpha = clamp(0.6 + 0.2 * sheen + 0.4 * rim + specular, 0.0, 1.0);

    // A note being struck keeps its color; it just becomes more solid and a little brighter.
    if (vStyle.x > 0.5) {
      col *= 1.3;
      alpha = max(alpha, 0.9);
    }

    gl_FragColor = vec4(col, alpha * shape);
  }
`

export function FallingNotes() {
  const { mesh, rects, styles, material } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1)
    const rects = new THREE.InstancedBufferAttribute(new Float32Array(MAX_VISIBLE * 4), 4)
    const styles = new THREE.InstancedBufferAttribute(new Float32Array(MAX_VISIBLE * 2), 2)
    rects.setUsage(THREE.DynamicDrawUsage)
    styles.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('aRect', rects)
    geometry.setAttribute('aStyle', styles)

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        // Shared by reference with the palette, which is refreshed once per frame.
        ...paletteUniforms,
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })

    const mesh = new THREE.InstancedMesh(geometry, material, MAX_VISIBLE)
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    return { mesh, rects, styles, material }
  }, [])

  useFrame((state) => {
    const { notes, lo, hi, time } = frame
    const rect = rects.array as Float32Array
    const style = styles.array as Float32Array
    let count = 0

    for (let i = lo; i < hi && count < MAX_VISIBLE; i++) {
      const n = notes[i]
      const end = n.time + n.duration
      if (end <= time || n.midi < MIDI_MIN || n.midi > MIDI_MAX) continue
      const key = KEYS[n.midi - MIDI_MIN]
      const y0 = (n.time - time) * FALL_SPEED
      const y1 = (end - time) * FALL_SPEED
      const r = count * 4
      rect[r] = key.x
      rect[r + 1] = (y0 + y1) / 2
      rect[r + 2] = key.noteWidth
      rect[r + 3] = y1 - y0
      const s = count * 2
      style[s] = y0 <= 0 ? 1 : 0
      style[s + 1] = n.hand
      count++
    }

    mesh.count = count
    rects.needsUpdate = true
    styles.needsUpdate = true
    material.uniforms.uTime.value = state.clock.elapsedTime
  })

  return <primitive object={mesh} />
}

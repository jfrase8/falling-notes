import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { frame } from './frame'
import {
  BLACK_COUNT,
  BLACK_LENGTH,
  BLACK_WIDTH,
  KEYBOARD_WIDTH,
  KEYS,
  MIDI_MIN,
  WHITE_COUNT,
  WHITE_LENGTH,
  WHITE_WIDTH,
} from './layout'
import { NOTE_COLOR_GLSL, colorAt, paletteUniforms } from './noteColors'

const KEY_DEPTH = 0.5
const BLACK_RAISE = 0.35
/** White keys extend past the bottom of the viewport so perspective never exposes a gap. */
const WHITE_OVERHANG = 3

// Linear-space colors. Idle keys stay under the bloom threshold.
const WHITE_IDLE = new THREE.Color(0.62, 0.61, 0.58) // slightly warm, like ivory
const BLACK_IDLE = new THREE.Color(0.012, 0.012, 0.014)
/** x of middle C, where the strike line blends from the left-hand to the right-hand color. */
const MIDDLE_C_X = KEYS[60 - MIDI_MIN].x

const hitLineVertexShader = /* glsl */ `
  varying float vX;
  varying float vHeight;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vX = world.x;
    vHeight = uv.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

// Same color the notes have where they meet the line (see colorAt() in noteColors.ts), in HDR so it glows.
const hitLineFragmentShader = /* glsl */ `
  ${NOTE_COLOR_GLSL}
  uniform float uMiddleC;
  varying float vX;
  varying float vHeight;
  void main() {
    // Per-hand mode has no single color per position, so blend the two around middle C.
    vec3 col = uMode == 1
      ? mix(uColorA, uColorB, smoothstep(-4.0, 4.0, vX - uMiddleC))
      : noteColor(0.0, vec2(vX, 0.0));
    // No hard line: strongest where it meets the keys, fading out upward.
    float falloff = pow(1.0 - vHeight, 3.0);
    gl_FragColor = vec4(col * 0.7 * falloff, 1.0);
  }
`
/** Pressed keys take the striking note's color, pushed into HDR so they glow. */
const PRESSED_BOOST = 1.5
/** How far the glow above the keys reaches, in world units. */
const GLOW_HEIGHT = 1.6

const vertexShader = /* glsl */ `
  attribute float aPressed;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vPressed;
  varying vec2 vWorld;
  void main() {
    vUv = uv;
    vColor = instanceColor;
    vPressed = aPressed;
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorld = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const glslFloat = (n: number) => n.toFixed(4)

/**
 * Keys are flat boxes seen straight on, so all the depth is painted in the shader as if
 * lit from the upper left: soft shadows, highlights, bevels and gloss.
 */
const fragmentShader = /* glsl */ `
  uniform float uWhite; // 1 = white keys, 0 = black keys
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vPressed;
  varying vec2 vWorld;

  const float HALF_KEYS = ${glslFloat(WHITE_COUNT / 2)};
  const float WHITE_LEN = ${glslFloat(WHITE_LENGTH)};
  const float BLACK_LEN = ${glslFloat(BLACK_LENGTH)};
  const float BLACK_HALF_W = ${glslFloat(BLACK_WIDTH / 2)};
  /** Where the top surface of a white key ends and its front face begins. */
  const float LIP_Y = ${glslFloat(-WHITE_LENGTH + 0.42)};

  void main() {
    float pressed = step(0.5, vPressed);
    vec3 col;

    if (uWhite > 0.5) {
      float xw = vWorld.x + HALF_KEYS; // 0..52, one unit per white key
      float y = vWorld.y;              // 0 at the hit line, negative toward the player
      float u = fract(xw);

      // Anti-aliased gap between neighbors, at least ~1px wide at any zoom.
      float gap = smoothstep(0.0, max(0.03, fwidth(xw) * 1.25), min(u, 1.0 - u));

      float light = 1.0;
      // Shade where the keys disappear under the fallboard, brightening toward the player.
      light *= mix(mix(0.68, 1.0, smoothstep(0.0, -1.5, y)), 1.0, pressed);
      light *= mix(0.94, 1.08, smoothstep(-1.0, -WHITE_LEN, y));
      // Rounded long edges: a thin highlight on the lit side, falling off on the other.
      light += 0.07 * smoothstep(0.03, 0.07, u) * (1.0 - smoothstep(0.09, 0.17, u));
      light *= mix(1.0, 0.91, smoothstep(0.68, 1.0, u));

      // Soft shadow cast by a neighboring black key, down and to the right. Black keys sit
      // on every white-key boundary except B-C and E-F.
      float k = floor(xw + 0.5);
      float m = mod(k, 7.0);
      float hasBlack = step(0.5, k) * step(k, 51.5) * step(0.5, abs(m - 2.0)) * step(0.5, abs(m - 5.0));
      vec2 sq = abs(vec2(xw - k - 0.09, y + BLACK_LEN * 0.5 + 0.12)) - vec2(BLACK_HALF_W, BLACK_LEN * 0.5);
      float shadowDistance = length(max(sq, 0.0)) + min(max(sq.x, sq.y), 0.0);
      light *= 1.0 - 0.42 * hasBlack * (1.0 - smoothstep(-0.04, 0.22, shadowDistance));

      // Front lip: a crease, then the front face in shade.
      light *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.04, abs(y - LIP_Y)));
      light *= mix(1.0, 0.84, step(y, LIP_Y));

      // A pressed key glows brightest where the note lands on it.
      light *= mix(1.0, mix(0.6, 1.0, smoothstep(-WHITE_LEN, 0.0, y)), pressed);
      col = vColor * light * mix(0.18, 1.0, gap);
    } else {
      float u = vUv.x;
      float v = vUv.y; // 1 at the hit line, 0 at the front end
      // Rounded sides, a glossy streak down the lit side, and a sloped front face catching light.
      float sides = smoothstep(0.0, 0.14, u) * smoothstep(0.0, 0.14, 1.0 - u);
      float gloss = (1.0 - smoothstep(0.0, 0.1, abs(u - 0.3))) * smoothstep(0.12, 0.3, v) * (1.0 - smoothstep(0.7, 1.0, v));
      float frontFace = 1.0 - smoothstep(0.075, 0.1, v);
      vec3 idle = vColor * mix(1.7, 0.7, v) * mix(0.45, 1.0, sides) + vec3(0.05) * gloss + vec3(0.04, 0.04, 0.045) * frontFace * sides;
      vec3 held = vColor * mix(0.55, 1.0, v) * mix(0.7, 1.0, sides) * (1.0 + 0.25 * gloss);
      col = mix(idle, held, pressed);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`

function keyMaterial(white: boolean) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uWhite: { value: white ? 1 : 0 } },
    toneMapped: false,
  })
}

export function Keyboard() {
  const whiteRef = useRef<THREE.InstancedMesh>(null)
  const blackRef = useRef<THREE.InstancedMesh>(null)
  const anyPressed = useRef(true)
  const whiteMaterial = useMemo(() => keyMaterial(true), [])
  const blackMaterial = useMemo(() => keyMaterial(false), [])
  const whitePressed = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(WHITE_COUNT), 1), [])
  const blackPressed = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(BLACK_COUNT), 1), [])
  const tmpColor = useMemo(() => new THREE.Color(), [])
  const hitLineMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: hitLineVertexShader,
        fragmentShader: hitLineFragmentShader,
        uniforms: {
          // Shared by reference with the palette, which is refreshed once per frame.
          ...paletteUniforms,
          uMiddleC: { value: MIDDLE_C_X },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )
  const whiteLength = WHITE_LENGTH + WHITE_OVERHANG

  useLayoutEffect(() => {
    const white = whiteRef.current!
    const black = blackRef.current!
    const m = new THREE.Matrix4()
    for (const key of KEYS) {
      if (key.black) {
        m.makeTranslation(key.x, -BLACK_LENGTH / 2, BLACK_RAISE - KEY_DEPTH / 2)
        black.setMatrixAt(key.index, m)
        black.setColorAt(key.index, BLACK_IDLE)
      } else {
        m.makeTranslation(key.x, -whiteLength / 2, -KEY_DEPTH / 2)
        white.setMatrixAt(key.index, m)
        white.setColorAt(key.index, WHITE_IDLE)
      }
    }
    white.instanceMatrix.needsUpdate = true
    black.instanceMatrix.needsUpdate = true
    anyPressed.current = true
  }, [whiteLength])

  useFrame(() => {
    const white = whiteRef.current
    const black = blackRef.current
    if (!white || !black) return
    const active = frame.active
    let pressedNow = false

    // Recolor every frame while anything is held (the palette can change under a held key),
    // plus one extra frame after the last release to restore idle colors.
    for (const key of KEYS) if (active[key.midi]) pressedNow = true
    if (!pressedNow && !anyPressed.current) return
    anyPressed.current = pressedNow

    for (const key of KEYS) {
      const hand = active[key.midi] - 1
      const mesh = key.black ? black : white
      const pressed = key.black ? blackPressed : whitePressed
      if (hand >= 0) {
        // Same color the falling note has where it meets the hit line.
        mesh.setColorAt(key.index, colorAt(hand, key.x, 0, tmpColor).multiplyScalar(PRESSED_BOOST))
        pressed.array[key.index] = 1
      } else {
        mesh.setColorAt(key.index, key.black ? BLACK_IDLE : WHITE_IDLE)
        pressed.array[key.index] = 0
      }
    }
    if (white.instanceColor) white.instanceColor.needsUpdate = true
    if (black.instanceColor) black.instanceColor.needsUpdate = true
    whitePressed.needsUpdate = true
    blackPressed.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={whiteRef} args={[undefined, whiteMaterial, WHITE_COUNT]} frustumCulled={false}>
        <boxGeometry args={[WHITE_WIDTH, whiteLength, KEY_DEPTH]}>
          <primitive object={whitePressed} attach="attributes-aPressed" />
        </boxGeometry>
      </instancedMesh>
      <instancedMesh ref={blackRef} args={[undefined, blackMaterial, BLACK_COUNT]} frustumCulled={false}>
        <boxGeometry args={[BLACK_WIDTH, BLACK_LENGTH, KEY_DEPTH]}>
          <primitive object={blackPressed} attach="attributes-aPressed" />
        </boxGeometry>
      </instancedMesh>
      {/* Soft glow of the note color rising from the top edge of the keyboard. */}
      <mesh position={[0, GLOW_HEIGHT / 2, BLACK_RAISE + 0.05]} renderOrder={1} material={hitLineMaterial}>
        <planeGeometry args={[KEYBOARD_WIDTH + 6, GLOW_HEIGHT]} />
      </mesh>
    </group>
  )
}

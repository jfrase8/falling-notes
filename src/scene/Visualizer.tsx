import { useLayoutEffect, useMemo, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import type * as THREE from 'three'
import { BackgroundPulses } from './BackgroundPulses'
import { FallingNotes } from './FallingNotes'
import { HueClipEffect } from './HueClip'
import { Keyboard } from './Keyboard'
import { Particles } from './Particles'
import { frame, updateFrame } from './frame'
import { FALL_SPEED, KEYBOARD_WIDTH, WHITE_LENGTH } from './layout'

const CAMERA_DISTANCE = 50

/** Samples the audio clock once per frame. Must be mounted before every other scene component. */
function FrameDriver() {
  useFrame(updateFrame)
  return null
}

/**
 * Frames the full 88-key keyboard edge to edge along the bottom of the viewport at any
 * aspect ratio, viewed straight on. The camera is orthographic so there is no parallax:
 * a falling note lines up exactly with its key (including the raised black keys) anywhere
 * on screen.
 */
function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const size = useThree((s) => s.size)

  useLayoutEffect(() => {
    // R3F keeps the orthographic frustum at one world unit per CSS pixel; zoom does the fitting.
    const zoom = size.width / KEYBOARD_WIDTH
    const visibleHeight = size.height / zoom
    const targetY = visibleHeight / 2 - WHITE_LENGTH

    camera.zoom = zoom
    camera.near = 0.1
    camera.far = CAMERA_DISTANCE * 4
    camera.position.set(0, targetY, CAMERA_DISTANCE)
    camera.lookAt(0, targetY, 0)
    camera.updateProjectionMatrix()

    // Seconds of notes that fit above the hit line.
    frame.lookahead = visibleHeight / FALL_SPEED
    frame.fieldHeight = Math.max(visibleHeight - WHITE_LENGTH, 1)
  }, [camera, size])

  return null
}

export function Visualizer() {
  const [dpr, setDpr] = useState(1.5)
  const hueClip = useMemo(() => new HueClipEffect(), [])

  return (
    <Canvas
      flat
      dpr={dpr}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      orthographic
      camera={{ near: 0.1, far: CAMERA_DISTANCE * 4, position: [0, 0, CAMERA_DISTANCE] }}
    >
      <color attach="background" args={['#070709']} />
      <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(2)} />

      <FrameDriver />
      <CameraRig />
      <BackgroundPulses />
      <Keyboard />
      <FallingNotes />
      <Particles />

      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={0.75} luminanceSmoothing={0.2} intensity={1.5} radius={0.8} />
        <primitive object={hueClip} />
        <Vignette offset={0.2} darkness={0.5} />
      </EffectComposer>
    </Canvas>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import {
  AnimationState,
  AnimationStateData,
  AtlasAttachmentLoader,
  Physics,
  ResizeMode,
  Skeleton,
  SkeletonJson,
  Skin,
  SpineCanvas
} from '@esotericsoftware/spine-webgl'
import type { TextureAtlas } from '@esotericsoftware/spine-webgl'
import type { PetPack, PetWindowState } from '../../shared/types'
import type { PetHitTest } from './PetVisual'

const ACTION_ANIMATIONS: Record<string, string> = {
  idle: 'eye',
  click: '抬手示意',
  drag: 'walk',
  'drag-end': '冲浪',
  sleep: 'loop',
  wake: 'loop笑'
}

const LOOP_ACTIONS = new Set(['drag', 'sleep'])
const IDLE_ANIMATION = ACTION_ANIMATIONS['idle']
const FIT_MARGIN = 1.15

interface SpineRuntime {
  skeleton: Skeleton
  state: AnimationState
  spineCanvas: SpineCanvas
  bounds: { x: number; y: number; width: number; height: number }
  currentAction: string
}

interface SpinePetVisualProps {
  pack: PetPack
  state: PetWindowState
  blinkIntervalSeconds: number
  hitTestRef: RefObject<PetHitTest | null>
  onHitTestReady?: () => void
}

function createCombinedSkin(skeleton: Skeleton): Skin | null {
  const defaultSkin = skeleton.data.findSkin('default')
  const directionSkin = skeleton.data.findSkin('right')
  if (!defaultSkin || !directionSkin) return null

  const combinedSkin = new Skin('pet-right')
  combinedSkin.addSkin(defaultSkin)
  combinedSkin.addSkin(directionSkin)
  return combinedSkin
}

export function SpinePetVisual({ pack, state, blinkIntervalSeconds, hitTestRef, onHitTestReady }: SpinePetVisualProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const spineCanvasRef = useRef<SpineCanvas | null>(null)
  const runtimeRef = useRef<SpineRuntime | null>(null)
  const blinkIntervalRef = useRef(blinkIntervalSeconds)
  const blinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const clearBlinkTimeout = useCallback(() => {
    if (blinkTimeoutRef.current === null) return
    clearTimeout(blinkTimeoutRef.current)
    blinkTimeoutRef.current = null
  }, [])

  const scheduleNextBlink = useCallback(() => {
    clearBlinkTimeout()
    blinkTimeoutRef.current = setTimeout(() => {
      blinkTimeoutRef.current = null
      const runtime = runtimeRef.current
      if (!runtime || runtime.currentAction !== 'idle') return
      runtime.state.setAnimation(0, IDLE_ANIMATION, false)
    }, blinkIntervalRef.current * 1000)
  }, [clearBlinkTimeout])

  useEffect(() => {
    const target = canvasRef.current
    if (!target) return

    let disposed = false
    setReady(false)
    setError(null)

    const skeletonUrl = `pet-asset://pack/${pack.assets['skeleton']}`
    const atlasUrl = `pet-asset://pack/${pack.assets['atlas']}`
    const spineCanvas = new SpineCanvas(target, {
      webglConfig: { alpha: true, antialias: true, preserveDrawingBuffer: true },
      app: {
        loadAssets(canvas) {
          canvas.assetManager.loadJson(skeletonUrl)
          canvas.assetManager.loadTextureAtlas(atlasUrl)
        },
        initialize(canvas) {
          const atlas = canvas.assetManager.require(atlasUrl) as TextureAtlas
          const skeletonJson = canvas.assetManager.require(skeletonUrl) as object
          const skeletonData = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(skeletonJson)
          const skeleton = new Skeleton(skeletonData)
          const animationState = new AnimationState(new AnimationStateData(skeletonData))

          const combinedSkin = createCombinedSkin(skeleton)
          if (combinedSkin) skeleton.setSkin(combinedSkin)
          skeleton.setToSetupPose()
          skeleton.updateWorldTransform(Physics.update)

          animationState.addListener({
            complete: (entry) => {
              if (entry.animation?.name === IDLE_ANIMATION) {
                scheduleNextBlink()
              } else {
                animationState.setAnimation(0, IDLE_ANIMATION, false)
              }
            }
          })

          runtimeRef.current = {
            skeleton,
            state: animationState,
            spineCanvas: canvas,
            bounds: skeleton.getBoundsRect(),
            currentAction: ''
          }

          if (!disposed) setReady(true)
        },
        update(canvas, delta) {
          const runtime = runtimeRef.current
          if (!runtime) return
          runtime.state.update(delta)
          runtime.state.apply(runtime.skeleton)
          runtime.skeleton.updateWorldTransform(Physics.update)
        },
        render(canvas) {
          const runtime = runtimeRef.current
          if (!runtime) return

          const renderer = canvas.renderer
          renderer.resize(ResizeMode.Expand)

          const camera = renderer.camera
          const boundsWidth = runtime.bounds.width
          const boundsHeight = runtime.bounds.height
          camera.position.x = runtime.bounds.x + boundsWidth / 2
          camera.position.y = runtime.bounds.y + boundsHeight / 2
          camera.zoom = Math.max(
            boundsWidth / canvas.htmlCanvas.width,
            boundsHeight / canvas.htmlCanvas.height
          ) * FIT_MARGIN
          camera.setViewport(canvas.htmlCanvas.width, canvas.htmlCanvas.height)
          camera.update()

          canvas.clear(0, 0, 0, 0)
          renderer.begin()
          renderer.drawSkeleton(runtime.skeleton, false)
          renderer.end()
        },
        error(canvas, errors) {
          if (disposed) return
          const message = Object.values(errors).join('\n')
          setError(message || 'Spine 资产加载失败')
        },
        dispose(canvas) {
          canvas.assetManager.removeAll()
          canvas.renderer.dispose()
          runtimeRef.current = null
        }
      }
    })

    spineCanvasRef.current = spineCanvas

    return () => {
      disposed = true
      clearBlinkTimeout()
      spineCanvasRef.current?.dispose()
      spineCanvasRef.current = null
      runtimeRef.current = null
    }
  }, [pack])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || !ready) return

    const animationName = ACTION_ANIMATIONS[state.action] ?? IDLE_ANIMATION
    if (!runtime.skeleton.data.findAnimation(animationName)) return
    clearBlinkTimeout()

    const loop = LOOP_ACTIONS.has(state.action)
    if (animationName === runtime.currentAction) {
      if (!loop) runtime.state.setAnimation(0, animationName, false)
      return
    }

    runtime.currentAction = animationName
    runtime.state.setAnimation(0, animationName, loop)
  }, [state.action, ready, clearBlinkTimeout])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || !ready) return
    blinkIntervalRef.current = blinkIntervalSeconds
    if (runtime.currentAction === 'idle') scheduleNextBlink()
  }, [blinkIntervalSeconds, ready, scheduleNextBlink])

  useEffect(() => {
    if (!ready) return
    hitTestRef.current = {
      isPointOnPet(clientX, clientY) {
        const canvas = canvasRef.current
        const spineCanvas = spineCanvasRef.current
        if (!canvas || !spineCanvas) return false

        const rect = canvas.getBoundingClientRect()
        const x = clientX - rect.left
        const y = clientY - rect.top
        if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return false

        const pixelX = Math.floor((x / rect.width) * canvas.width)
        const pixelY = Math.floor((y / rect.height) * canvas.height)
        if (pixelX < 0 || pixelY < 0 || pixelX >= canvas.width || pixelY >= canvas.height) return false

        const gl = spineCanvas.gl
        const pixel = new Uint8Array(4)
        gl.readPixels(pixelX, canvas.height - 1 - pixelY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
        return pixel[3] > 8
      }
    }
    onHitTestReady?.()
    return () => {
      hitTestRef.current = null
    }
  }, [hitTestRef, onHitTestReady, ready])

  return (
    <div className="pet-spine">
      <canvas ref={canvasRef} />
      {error ? <div className="pet-spine__error">{error}</div> : null}
    </div>
  )
}

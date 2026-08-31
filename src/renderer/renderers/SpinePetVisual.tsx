import { useEffect, useRef, useState } from 'react'
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
import type { PetDirection, PetPack, PetWindowState } from '../../shared/types'
import type { PetHitTest } from './PetVisual'

const ACTION_ANIMATIONS: Record<string, string> = {
  idle: 'eye',
  click: '抬手示意',
  drag: 'walk',
  'drag-end': '冲浪',
  sleep: 'loop',
  wake: 'loop笑'
}

const LOOP_ACTIONS = new Set(['idle', 'drag', 'sleep'])
const IDLE_ANIMATION = ACTION_ANIMATIONS['idle']
const FIT_MARGIN = 1.15

interface SpineRuntime {
  skeleton: Skeleton
  state: AnimationState
  spineCanvas: SpineCanvas
  bounds: { x: number; y: number; width: number; height: number }
  currentAction: string
  currentDirection: PetDirection
}

interface SpinePetVisualProps {
  pack: PetPack
  state: PetWindowState
  blinkIntervalSeconds: number
  hitTestRef: RefObject<PetHitTest | null>
  onHitTestReady?: () => void
}

function createCombinedSkin(skeleton: Skeleton, direction: PetDirection): Skin | null {
  const defaultSkin = skeleton.data.findSkin('default')
  const directionSkin = skeleton.data.findSkin(direction)
  if (!defaultSkin || !directionSkin) return null

  const combinedSkin = new Skin(`pet-${direction}`)
  combinedSkin.addSkin(defaultSkin)
  combinedSkin.addSkin(directionSkin)
  return combinedSkin
}

export function SpinePetVisual({ pack, state, blinkIntervalSeconds, hitTestRef, onHitTestReady }: SpinePetVisualProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const spineCanvasRef = useRef<SpineCanvas | null>(null)
  const runtimeRef = useRef<SpineRuntime | null>(null)
  const directionRef = useRef<PetDirection>(state.direction)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    directionRef.current = state.direction
  }, [state.direction])

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

          const combinedSkin = createCombinedSkin(skeleton, directionRef.current)
          if (combinedSkin) skeleton.setSkin(combinedSkin)
          skeleton.setToSetupPose()
          skeleton.updateWorldTransform(Physics.update)

          animationState.addListener({
            complete: (entry) => {
              if (entry.animation?.name !== IDLE_ANIMATION) {
                animationState.setAnimation(0, IDLE_ANIMATION, true)
              }
            }
          })

          runtimeRef.current = {
            skeleton,
            state: animationState,
            spineCanvas: canvas,
            bounds: skeleton.getBoundsRect(),
            currentAction: '',
            currentDirection: directionRef.current
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

    const loop = LOOP_ACTIONS.has(state.action)
    if (animationName === runtime.currentAction) {
      if (!loop) runtime.state.setAnimation(0, animationName, false)
      return
    }

    runtime.currentAction = animationName
    const entry = runtime.state.setAnimation(0, animationName, loop)
    if (animationName === IDLE_ANIMATION && entry.animation) {
      entry.timeScale = entry.animation.duration / blinkIntervalSeconds
    }
  }, [state.action, ready])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || !ready) return
    const entry = runtime.state.getCurrent(0)
    if (entry?.animation?.name !== IDLE_ANIMATION || !entry.animation) return
    entry.timeScale = entry.animation.duration / blinkIntervalSeconds
  }, [blinkIntervalSeconds, ready])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || !ready || runtime.currentDirection === state.direction) return

    const combinedSkin = createCombinedSkin(runtime.skeleton, state.direction)
    runtime.currentDirection = state.direction
    if (!combinedSkin) return

    runtime.skeleton.setSkin(combinedSkin)
    runtime.skeleton.setToSetupPose()
  }, [state.direction, ready])

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

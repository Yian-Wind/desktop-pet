import { useEffect, useRef, useState } from 'react'
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

function createCombinedSkin(skeleton: Skeleton, direction: PetDirection): Skin | null {
  const defaultSkin = skeleton.data.findSkin('default')
  const directionSkin = skeleton.data.findSkin(direction)
  if (!defaultSkin || !directionSkin) return null

  const combinedSkin = new Skin(`pet-${direction}`)
  combinedSkin.addSkin(defaultSkin)
  combinedSkin.addSkin(directionSkin)
  return combinedSkin
}

export function SpinePetVisual({ pack, state }: { pack: PetPack; state: PetWindowState }) {
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
      webglConfig: { alpha: true, antialias: true },
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
    runtime.state.setAnimation(0, animationName, loop)
  }, [state.action, ready])

  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime || !ready || runtime.currentDirection === state.direction) return

    const combinedSkin = createCombinedSkin(runtime.skeleton, state.direction)
    runtime.currentDirection = state.direction
    if (!combinedSkin) return

    runtime.skeleton.setSkin(combinedSkin)
    runtime.skeleton.setToSetupPose()
  }, [state.direction, ready])

  return (
    <div className="pet-spine">
      <canvas ref={canvasRef} />
      {error ? <div className="pet-spine__error">{error}</div> : null}
    </div>
  )
}

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
import type { PetPack, PetWindowState } from '../../shared/types'
import { CLICK_EXCLUDED_ANIMATIONS } from '../../shared/animation-pool'
import type { PetHitTest } from './PetVisual'

const ACTION_ANIMATIONS: Record<string, string> = {
  idle: 'eye',
  click: '抬手示意',
  drag: 'eye',
  'drag-end': '冲浪',
  sleep: 'loop',
  wake: 'loop笑',
  cheer: '举手张嘴',
  alarm: '闹钟提示'
}

const LOOP_ACTIONS = new Set(['sleep'])
const LOOP_ANIMATIONS = new Set(['loop', 'loop笑'])
const IDLE_ANIMATION = ACTION_ANIMATIONS['idle']
const FIT_MARGIN = 1.15
const DROP_FALL_SECONDS = 0.14
const DROP_SPRING_SECONDS = 0.32
const DRAG_EYE_ATTACHMENT = 'gt-lt-eyes'
const DRAG_EYE_SLOT = 'gt-lt-eyes'
const SURF_EXIT_END_SECONDS = 2.8333
const SURF_RETURN_START_SECONDS = 3.3333
const SURF_RETURN_END_SECONDS = 6.129
const SURF_DISMOUNT_START_SECONDS = 8.0833
const SURF_DISMOUNT_END_SECONDS = 9.3333
const SURF_EXIT_TO_ENTER_GAP_SECONDS = 0
const SURF_ENTER_DELAY_SECONDS =
  SURF_EXIT_END_SECONDS + SURF_EXIT_TO_ENTER_GAP_SECONDS
const SURF_RETURN_DURATION_SECONDS =
  SURF_RETURN_END_SECONDS - SURF_RETURN_START_SECONDS
const EYE_SLOT_NAMES = [
  '上弯闭目',
  '下睫毛',
  '双眼皮',
  '眼白',
  '睫毛',
  '瞳孔',
  '高光'
]

interface SpineRuntime {
  skeleton: Skeleton
  state: AnimationState
  spineCanvas: SpineCanvas
  bounds: { x: number; y: number; width: number; height: number }
  currentAction: string
  currentAnimationName: string
  swayTime: number
  dropSpringTime: number | null
  baseRootRotation: number
  baseRootScaleX: number
  baseRootScaleY: number
  baseSkeletonY: number
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
  const directionSkin = skeleton.data.findSkin('left')
  if (!defaultSkin || !directionSkin) return null

  const combinedSkin = new Skin('pet-left')
  combinedSkin.addSkin(defaultSkin)
  combinedSkin.addSkin(directionSkin)
  return combinedSkin
}

function applyStructuralDropSpring(runtime: SpineRuntime, delta: number): void {
  const rootBone = runtime.skeleton.getRootBone()
  if (!rootBone) return

  if (runtime.dropSpringTime === null) {
    rootBone.scaleX = runtime.baseRootScaleX
    rootBone.scaleY = runtime.baseRootScaleY
    return
  }

  runtime.dropSpringTime += delta
  const elapsed = runtime.dropSpringTime
  if (elapsed < DROP_FALL_SECONDS) {
    const progress = elapsed / DROP_FALL_SECONDS
    rootBone.scaleX = runtime.baseRootScaleX - runtime.baseRootScaleX * 0.0175 * progress
    rootBone.scaleY = runtime.baseRootScaleY + runtime.baseRootScaleY * 0.03 * progress
    return
  }

  const springProgress = Math.min(
    1,
    (elapsed - DROP_FALL_SECONDS) / DROP_SPRING_SECONDS
  )
  const spring =
    Math.exp(-5 * springProgress) *
    Math.cos(Math.PI * 2 * springProgress)
  rootBone.scaleX = runtime.baseRootScaleX + runtime.baseRootScaleX * 0.045 * spring
  rootBone.scaleY = runtime.baseRootScaleY - runtime.baseRootScaleY * 0.06 * spring

  if (springProgress >= 1) {
    runtime.dropSpringTime = null
    rootBone.scaleX = runtime.baseRootScaleX
    rootBone.scaleY = runtime.baseRootScaleY
    setDragExpression(runtime.skeleton, false)
  }
}

function setDragExpression(skeleton: Skeleton, enabled: boolean): void {
  const dragEyeSlot = skeleton.findSlot(DRAG_EYE_SLOT)
  if (!dragEyeSlot) return

  if (enabled) {
    dragEyeSlot.setAttachment(skeleton.getAttachment(dragEyeSlot.data.index, DRAG_EYE_ATTACHMENT))
    dragEyeSlot.color.set(1, 1, 1, 1)
    for (const slotName of EYE_SLOT_NAMES) {
      if (slotName === DRAG_EYE_SLOT) continue
      const slot = skeleton.findSlot(slotName)
      if (slot) slot.color.set(1, 1, 1, 0)
    }
    return
  }

  dragEyeSlot.color.set(1, 1, 1, 0)
  for (const slotName of EYE_SLOT_NAMES) {
    const slot = skeleton.findSlot(slotName)
    slot?.setToSetupPose()
  }
}

function playSurfSequence(runtime: SpineRuntime): void {
  const state = runtime.state
  runtime.currentAnimationName = '冲浪'

  const exitEntry = state.setAnimation(0, '冲浪', false)
  exitEntry.animationStart = 0
  exitEntry.animationEnd = SURF_EXIT_END_SECONDS
  exitEntry.mixDuration = 0

  const returnEntry = state.addAnimation(0, '冲浪', false, SURF_ENTER_DELAY_SECONDS)
  returnEntry.animationStart = SURF_RETURN_START_SECONDS
  returnEntry.animationEnd = SURF_RETURN_END_SECONDS
  returnEntry.mixDuration = 0

  const dismountEntry = state.addAnimation(
    0,
    '冲浪',
    false,
    SURF_RETURN_DURATION_SECONDS
  )
  dismountEntry.animationStart = SURF_DISMOUNT_START_SECONDS
  dismountEntry.animationEnd = SURF_DISMOUNT_END_SECONDS
  dismountEntry.reverse = true
  dismountEntry.mixDuration = 0
}

export function SpinePetVisual({ pack, state, blinkIntervalSeconds, hitTestRef, onHitTestReady }: SpinePetVisualProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const spineCanvasRef = useRef<SpineCanvas | null>(null)
  const runtimeRef = useRef<SpineRuntime | null>(null)
  const lastClickAnimationRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

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
          const rootBone = skeleton.getRootBone()
          const baseRootRotation = rootBone?.rotation ?? 0
          const baseRootScaleX = rootBone?.scaleX ?? 1
          const baseRootScaleY = rootBone?.scaleY ?? 1
          const baseSkeletonY = skeleton.y

          const combinedSkin = createCombinedSkin(skeleton)
          if (combinedSkin) skeleton.setSkin(combinedSkin)
          skeleton.setToSetupPose()
          skeleton.updateWorldTransform(Physics.update)

          animationState.addListener({
            complete: (entry) => {
              const runtime = runtimeRef.current
              if (
                runtime &&
                entry.animation?.name !== IDLE_ANIMATION &&
                !(runtime.currentAction === 'surf' && !entry.reverse)
              ) {
                runtime.currentAction = 'idle'
                runtime.currentAnimationName = IDLE_ANIMATION
                animationState.setAnimation(0, IDLE_ANIMATION, false)
              }
            }
          })

          runtimeRef.current = {
            skeleton,
            state: animationState,
            spineCanvas: canvas,
            bounds: skeleton.getBoundsRect(),
            currentAction: '',
            currentAnimationName: '',
            swayTime: 0,
            dropSpringTime: null,
            baseRootRotation,
            baseRootScaleX,
            baseRootScaleY,
            baseSkeletonY
          }

          if (!disposed) setReady(true)
        },
        update(canvas, delta) {
          const runtime = runtimeRef.current
          if (!runtime) return
          runtime.swayTime += delta
          const rootBone = runtime.skeleton.getRootBone()
          if (runtime.currentAction === 'idle') {
            const sway = Math.sin(runtime.swayTime * Math.PI)
            if (rootBone) rootBone.rotation = runtime.baseRootRotation + sway * 0.35
            runtime.skeleton.y = runtime.baseSkeletonY + Math.sin(runtime.swayTime * Math.PI * 2) * 1.5
          } else {
            if (rootBone) rootBone.rotation = runtime.baseRootRotation
            runtime.skeleton.y = runtime.baseSkeletonY
          }
          runtime.state.update(delta)
          runtime.state.apply(runtime.skeleton)
          if (runtime.currentAction === 'drag' || runtime.dropSpringTime !== null) {
            setDragExpression(runtime.skeleton, true)
          }
          applyStructuralDropSpring(runtime, delta)
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

    if (state.action === 'drag') {
      if (runtime.currentAction !== 'drag' || runtime.dropSpringTime !== null) {
        runtime.state.clearTrack(0)
        runtime.skeleton.setToSetupPose()
        runtime.currentAction = 'drag'
        runtime.currentAnimationName = ACTION_ANIMATIONS['drag']
        runtime.state.setAnimation(0, ACTION_ANIMATIONS['drag'], false)
      }
      runtime.dropSpringTime = null
      return
    }
    if (state.action === 'idle' && runtime.currentAction === 'drag') {
      runtime.dropSpringTime = 0
    }
    let animationName = ACTION_ANIMATIONS[state.action] ?? IDLE_ANIMATION
    if (state.action === 'click') {
      const choices = pack.manifest.animations.filter((name) => {
        return !CLICK_EXCLUDED_ANIMATIONS.has(name) && runtime.skeleton.data.findAnimation(name) !== null
      })
      const nonRepeatingChoices = choices.filter((name) => {
        return name !== lastClickAnimationRef.current && name !== runtime.currentAnimationName
      })
      const pool = nonRepeatingChoices.length > 0 ? nonRepeatingChoices : choices
      animationName = pool[Math.floor(Math.random() * pool.length)] ?? ACTION_ANIMATIONS['click']
      lastClickAnimationRef.current = animationName
    } else if (state.animationName) {
      animationName = state.animationName
    }
    if (!runtime.skeleton.data.findAnimation(animationName)) return
    const loop = state.animationName
      ? LOOP_ANIMATIONS.has(animationName)
      : LOOP_ACTIONS.has(state.action)
    if (animationName === '冲浪') {
      runtime.currentAction = 'surf'
      playSurfSequence(runtime)
      return
    }
    if (state.action === 'click') {
      runtime.state.clearTrack(0)
      runtime.skeleton.setToSetupPose()
    }
    if (runtime.currentAction === state.action) {
      if (state.action === 'click' || state.animationName || !loop) {
        runtime.state.setAnimation(0, animationName, loop)
        runtime.currentAnimationName = animationName
      }
      return
    }

    runtime.currentAction = state.action
    runtime.currentAnimationName = animationName
    runtime.state.setAnimation(0, animationName, loop)
  }, [state.action, state.actionNonce, state.animationName, ready, pack.manifest.animations])

  useEffect(() => {
    if (!ready) return
    let timeout = 0
    const blink = () => {
      const runtime = runtimeRef.current
      if (runtime?.currentAction === 'idle') {
        runtime.state.setAnimation(0, IDLE_ANIMATION, false)
        runtime.currentAnimationName = IDLE_ANIMATION
      }
      timeout = window.setTimeout(blink, blinkIntervalSeconds * 1000)
    }
    timeout = window.setTimeout(blink, blinkIntervalSeconds * 1000)
    return () => window.clearTimeout(timeout)
  }, [ready, blinkIntervalSeconds])

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

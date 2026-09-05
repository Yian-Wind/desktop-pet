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
import type { TextureAtlas, TrackEntry } from '@esotericsoftware/spine-webgl'
import type { PetPack, PetWindowState } from '../../shared/types'
import { CLICK_EXCLUDED_ANIMATIONS } from '../../shared/animation-pool'
import type { PetHitTest, PetVisualBounds } from './PetVisual'

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

interface CanvasSourceBounds {
  left: number
  top: number
  right: number
  bottom: number
}
const SURF_EXIT_END_SECONDS = 2.8333
const SURF_RETURN_START_SECONDS = 3.3333
// 切点由"刹车初速=切点速度"连续条件解出：bone.translate 单段贝塞尔（控制点 t=3.379/8.19）
// 满足 x(t_c) + v(t_c)·T/3 = 1731.47（世界 x≈0 的原地 timeline 值）。
// T=0.6s 缓刹：该区间贝塞尔近线性 v≈1292，x(t_c)=−256 → t_c=5.952，D=v·T/3=260
const SURF_RETURN_END_SECONDS = 5.952
// 刹车借用出场段"落板站稳"切片 raw 1.2333→1.8333（板全亮、无跳起动作），程序化减速叠加在 root 上；
// 旧方案用 0.8333→1.2333（空中落板片段）会观感成"又跳上一次板"
const SURF_BRAKE_START_SECONDS = 1.2333
const SURF_BRAKE_END_SECONDS = 1.8333
const SURF_BRAKE_SECONDS = SURF_BRAKE_END_SECONDS - SURF_BRAKE_START_SECONDS
// 滑行段 root.translate y=18.97 只在 raw≥3.3333 生效（整体抬高），站稳/下板切片没有；
// 刹车起步把 worldY 从切片原生的 50.2 拉回切点的 68.3，随减速收敛到 50.2+18.97 抬升
const SURF_BRAKE_Y_ALIGN_UNITS = 68.3 - 50.2
const SURF_ROOT_LIFT_UNITS = 18.97
// 下板倒放：reverse 采样 raw = 9.3333−(start+trackTime)，从 raw 1.6333 倒放到 0——
// 与刹车末帧同帧无缝，自带"下蹲蓄力→起跳→落地"完整下板动作
const SURF_DISMOUNT_START_SECONDS = 9.3333 - SURF_BRAKE_END_SECONDS
const SURF_DISMOUNT_END_SECONDS = 9.3333
const SURF_DISMOUNT_SECONDS = SURF_DISMOUNT_END_SECONDS - SURF_DISMOUNT_START_SECONDS
const SURF_BRAKE_SLOT_ALPHA = '鲨鱼'
// 刹车终点的世界坐标 = 刹车切片原生位置（bone 局部 x/y 常数，root 回 setup 后的世界值）
const SURF_BRAKE_REST_X_UNITS = 3.61
const SURF_BRAKE_REST_Y_UNITS = 69.17 // 切片原生 50.2 + 滑行抬升 18.97
const SURF_EXIT_TO_ENTER_GAP_SECONDS = 0
const SURF_ENTER_DELAY_SECONDS =
  SURF_EXIT_END_SECONDS + SURF_EXIT_TO_ENTER_GAP_SECONDS
const SURF_RETURN_DURATION_SECONDS =
  SURF_RETURN_END_SECONDS - SURF_RETURN_START_SECONDS
// 刹车程序化位移总量 = 世界原地 x(1731.47) − 切点 x(t_c)，与 T 内 ease-out 减速匹配
const SURF_BRAKE_OFFSET_X_UNITS = 178
const EYE_SLOT_NAMES = [
  '上弯闭目',
  '下睫毛',
  '双眼皮',
  '眼白',
  '睫毛',
  '瞳孔',
  '高光'
]

interface SurfBrakeState {
  brakeEntry: TrackEntry
  dismountEntry: TrackEntry
  elapsed: number
  phase: 'brake' | 'dismount'
  x0: number
  y0: number
}
interface SpineRuntime {
  skeleton: Skeleton
  state: AnimationState
  spineCanvas: SpineCanvas
  bounds: { x: number; y: number; width: number; height: number }
  currentAction: string
  currentAnimationName: string
  swayTime: number
  dropSpringTime: number | null
  surfBrake: SurfBrakeState | null
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

function applySurfBrake(runtime: SpineRuntime, delta: number): void {
  const brake = runtime.surfBrake
  if (!brake) return
  const current = runtime.state.getCurrent(0)

  // 刹车条目：仍在队列则等待；被下板条目接管则切相位；被其他打断则清理
  if (brake.phase === 'brake') {
    if (current !== brake.brakeEntry) {
      if (current === brake.dismountEntry) {
        brake.phase = 'dismount'
        brake.elapsed = 0
      } else {
        let queued: TrackEntry | null = current
        while (queued && queued !== brake.brakeEntry) queued = queued.next
        if (queued !== brake.brakeEntry) runtime.surfBrake = null
        return
      }
    } else {
      brake.elapsed += delta
      const progress = Math.min(1, brake.elapsed / SURF_BRAKE_SECONDS)
      const ease = 1 - Math.pow(1 - progress, 3)
      const rootBone = runtime.skeleton.getRootBone()
      const bone = runtime.skeleton.findBone('bone')
      if (rootBone && bone) {
        if (Number.isNaN(brake.x0)) {
          // 首帧记录实际世界位置作为 pin 起点（兼容 mixDuration 过渡）
          brake.x0 = bone.worldX
          brake.y0 = bone.worldY
        }
        // pin 式补偿：目标轨迹 x0/y0 → rest 的 ease-out 减速线（p=0 在切点、p=1 在原地）。
        // apply 已把 root/bone 重置为本帧原生局部值（简单平移，无旋转缩放），
        // 按目标与原生之差叠加，mix 姿态过渡不影响位置精度
        const targetX = brake.x0 + (SURF_BRAKE_REST_X_UNITS - brake.x0) * ease
        const targetY = brake.y0 + (SURF_BRAKE_REST_Y_UNITS - brake.y0) * ease
        const nativeX = rootBone.x + bone.x
        const nativeY = runtime.baseSkeletonY + rootBone.y + bone.y
        rootBone.x += targetX - nativeX
        rootBone.y += targetY - nativeY
      }
      // 借用切片段内板本来就全亮，仍强制兜底避免帧边界闪没
      const boardSlot = runtime.skeleton.findSlot(SURF_BRAKE_SLOT_ALPHA)
      if (boardSlot) boardSlot.color.a = 1
      if (progress >= 1) {
        brake.phase = 'dismount'
        brake.elapsed = 0
      }
      return
    }
  }

  // 下板倒放段：延续滑行抬升，落地段（progress 0.45→0.61）线性淡出；
  // 板在人起跳后即淡出（progress 0.3→0.5）：素材固有轨道里跳跃时板留在水面，
  // 淡出与正放"板在人落板途中淡入"对称，避免顶点附近人板分离画面
  if (current !== brake.dismountEntry) {
    runtime.surfBrake = null
    return
  }
  brake.elapsed += delta
  const progress = Math.min(1, brake.elapsed / SURF_DISMOUNT_SECONDS)
  const liftFade = 1 - Math.min(1, Math.max(0, (progress - 0.45) / 0.16))
  const rootBone = runtime.skeleton.getRootBone()
  if (rootBone) rootBone.y += SURF_ROOT_LIFT_UNITS * liftFade
  const boardSlot = runtime.skeleton.findSlot(SURF_BRAKE_SLOT_ALPHA)
  if (boardSlot) {
    boardSlot.color.a = progress < 0.3 ? 1 : Math.max(0, 1 - (progress - 0.3) / 0.2)
  }

  if (progress >= 1) runtime.surfBrake = null
}

function getOpaqueCanvasBounds(
  gl: WebGLRenderingContext,
  width: number,
  height: number
): CanvasSourceBounds | null {
  if (!width || !height) return null
  const pixels = new Uint8Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

  let left = -1
  let top = -1
  let right = -1
  let bottom = -1
  for (let yFromBottom = 0; yFromBottom < height; yFromBottom += 1) {
    const y = height - 1 - yFromBottom
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(yFromBottom * width + x) * 4 + 3]
      if (alpha <= 8) continue
      if (left === -1 || x < left) left = x
      if (top === -1 || y < top) top = y
      if (x > right) right = x
      if (y > bottom) bottom = y
    }
  }
  if (left === -1) return null
  return { left, top, right, bottom }
}

function getCanvasVisualBounds(
  canvas: HTMLCanvasElement,
  sourceBounds: CanvasSourceBounds
): PetVisualBounds {
  const rect = canvas.getBoundingClientRect()
  const left = rect.left + (sourceBounds.left / canvas.width) * rect.width
  const top = rect.top + (sourceBounds.top / canvas.height) * rect.height
  const width = Math.max(1, ((sourceBounds.right - sourceBounds.left + 1) / canvas.width) * rect.width)
  const height = Math.max(1, ((sourceBounds.bottom - sourceBounds.top + 1) / canvas.height) * rect.height)
  return { left, top, width, height, centerX: left + width / 2, centerY: top + height / 2 }
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

  const brakeEntry = state.addAnimation(0, '冲浪', false, SURF_RETURN_DURATION_SECONDS)
  brakeEntry.animationStart = SURF_BRAKE_START_SECONDS
  brakeEntry.animationEnd = SURF_BRAKE_END_SECONDS
  // 0.12s 姿态混合柔化滑回→刹车的瞬切；位置由 applySurfBrake 的 pin 式补偿保证连续
  brakeEntry.mixDuration = 0.12

  const dismountEntry = state.addAnimation(
    0,
    '冲浪',
    false,
    SURF_BRAKE_SECONDS
  )
  dismountEntry.animationStart = SURF_DISMOUNT_START_SECONDS
  dismountEntry.animationEnd = SURF_DISMOUNT_END_SECONDS
  dismountEntry.reverse = true
  dismountEntry.mixDuration = 0

  runtime.surfBrake = {
    brakeEntry,
    dismountEntry,
    elapsed: 0,
    phase: 'brake',
    x0: NaN,
    y0: NaN
  }
}

export function SpinePetVisual({ pack, state, blinkIntervalSeconds, hitTestRef, onHitTestReady }: SpinePetVisualProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const spineCanvasRef = useRef<SpineCanvas | null>(null)
  const runtimeRef = useRef<SpineRuntime | null>(null)
  const visualSourceBoundsRef = useRef<CanvasSourceBounds | null>(null)
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
            surfBrake: null,
            baseRootRotation,
            baseRootScaleX,
            baseRootScaleY,
            baseSkeletonY
          }

          if (!disposed) setReady(true)

          // dev 调试钩子：forceSurf=1 时加载后播放冲浪序列（用于端到端视觉验收）
          if (
            !disposed &&
            new URLSearchParams(window.location.search).get('forceSurf') === '1'
          ) {
            window.setTimeout(() => {
              const rt = runtimeRef.current
              if (!rt) return
              rt.currentAction = 'surf'
              playSurfSequence(rt)
            }, 2000)
          }
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
          applySurfBrake(runtime, delta)
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
      runtime.surfBrake = null
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
      runtime.surfBrake = null
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
    const frame = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      const spineCanvas = spineCanvasRef.current
      if (!canvas || !spineCanvas) return
      visualSourceBoundsRef.current = getOpaqueCanvasBounds(spineCanvas.gl, canvas.width, canvas.height)

      hitTestRef.current = {
        isPointOnPet(clientX, clientY) {
          const hitCanvas = canvasRef.current
          const hitSpineCanvas = spineCanvasRef.current
          if (!hitCanvas || !hitSpineCanvas) return false

          const rect = hitCanvas.getBoundingClientRect()
          const x = clientX - rect.left
          const y = clientY - rect.top
          if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return false

          const pixelX = Math.floor((x / rect.width) * hitCanvas.width)
          const pixelY = Math.floor((y / rect.height) * hitCanvas.height)
          if (pixelX < 0 || pixelY < 0 || pixelX >= hitCanvas.width || pixelY >= hitCanvas.height) return false

          const gl = hitSpineCanvas.gl
          const pixel = new Uint8Array(4)
          gl.readPixels(pixelX, hitCanvas.height - 1 - pixelY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
          return pixel[3] > 8
        },
        getVisualBounds() {
          const boundsCanvas = canvasRef.current
          const sourceBounds = visualSourceBoundsRef.current
          if (!boundsCanvas || !sourceBounds) return null
          return getCanvasVisualBounds(boundsCanvas, sourceBounds)
        }
      }
      onHitTestReady?.()
    })

    return () => {
      cancelAnimationFrame(frame)
      hitTestRef.current = null
      visualSourceBoundsRef.current = null
    }
  }, [hitTestRef, onHitTestReady, ready])

  return (
    <div className="pet-spine">
      <canvas ref={canvasRef} />
      {error ? <div className="pet-spine__error">{error}</div> : null}
    </div>
  )
}

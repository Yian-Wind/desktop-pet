import { DEFAULT_CORPUS } from '../shared/defaults'
import { IDLE_SHOW_ANIMATIONS, POSE_ANIMATIONS, SLEEP_EXCLUDED_ANIMATIONS } from '../shared/animation-pool'
import type { CorpusConfig, PetEvent, PetPack, PetWindowState } from '../shared/types'
function pick(arr: string[] | undefined): string | null {
  if (!arr || arr.length === 0) return null
  return arr[Math.floor(Math.random() * arr.length)]
}

export class BehaviorEngine {
  private state: PetWindowState = {
    packId: 'fairy',
    action: 'idle',
    actionNonce: 0,
    emotion: 'neutral',
    bubble: '',
    bubbleVisible: false,
    busy: false,
    packType: 'gif'
  }

  private idleMinutes = 0
  private lastIdleBubbleAt = 0
  private idleTimer?: NodeJS.Timeout
  private sleepAnimationTimer?: NodeJS.Timeout
  private idleShowTimer?: NodeJS.Timeout
  private idleShowClearTimer?: NodeJS.Timeout
  // 刃舞表演时长（秒）——与 tools/promeia/blade_orbit.py 的 DURATION 保持一致
  private static readonly IDLE_SHOW_DURATION_SECONDS = 10
  private currentPack?: PetPack
  private lastSleepAnimationName: string | null = null
  // 姿势切换状态：true = 背手（下一次点击播 解背手）
  private poseToggled = false
  private sleepAnimationIntervalSeconds = 30
  private bubbleDurationSeconds = 5
  private bubbleTimer?: NodeJS.Timeout
  private corpus: CorpusConfig = { ...DEFAULT_CORPUS, phrases: { ...DEFAULT_CORPUS.phrases } }

  constructor(
    private onState: (state: PetWindowState) => void
  ) {}

  start(pack: PetPack): void {
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.stopSleepAnimationTimer()
    this.stopIdleShowTimer()
    this.currentPack = pack
    this.lastSleepAnimationName = null
    this.poseToggled = false
    this.state.animationName = undefined
    this.corpus = {
      ...DEFAULT_CORPUS,
      ...pack.corpus,
      phrases: { ...DEFAULT_CORPUS.phrases, ...pack.corpus.phrases }
    }
    this.state.packId = pack.manifest.id
    this.state.packType = pack.manifest.type
    this.state.action = 'idle'
    this.state.bubble = ''
    this.idleMinutes = 0
    this.lastIdleBubbleAt = 0
    this.emit()
    this.idleTimer = setInterval(() => {
      this.idleMinutes += 1
      const shouldSleep = this.corpus.enabled && this.idleMinutes >= this.corpus.sleepAfterMinutes
      this.handle({ type: shouldSleep ? 'sleep' : 'idle' })
    }, 60_000)
    this.startIdleShowTimer()
  }

  stop(): void {
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.stopSleepAnimationTimer()
    this.stopIdleShowTimer()
  }

  setSleepAnimationIntervalSeconds(seconds: number): void {
    this.sleepAnimationIntervalSeconds = seconds
    if (this.state.action === 'sleep') this.startSleepAnimationTimer()
    // 待机表演复用同一间隔：设置变更时重排
    this.startIdleShowTimer()
  }

  setBubbleDurationSeconds(seconds: number): void {
    this.bubbleDurationSeconds = seconds
    if (this.state.bubbleVisible) this.scheduleBubbleHide()
  }

  getState(): PetWindowState {
    return { ...this.state }
  }

  async handle(event: PetEvent): Promise<void> {
    // 刃舞表演期间忽略分钟级 idle tick（nonce/animationName 重置会掐断表演）
    if (event.type === 'idle' && this.state.animationName &&
        IDLE_SHOW_ANIMATIONS.has(this.state.animationName)) return
    if (event.type !== 'idle' && event.type !== 'sleep') this.idleMinutes = 0
    if (event.type !== 'sleep') this.stopSleepAnimationTimer()
    this.state.actionNonce += 1
    this.state.animationName = undefined
    const phrases = this.corpus.phrases
    switch (event.type) {
      case 'click': {
        this.state.action = 'click'
        this.state.emotion = 'happy'
        // 姿势切换包（manifest 同时含 背手/解背手）：点击翻转姿势，
        // 经 state.animationName 通道下发确定性动画（不走随机点击池）
        const animations = this.currentPack?.manifest.animations ?? []
        if (animations.includes('背手') && animations.includes('解背手')) {
          this.poseToggled = !this.poseToggled
          this.state.animationName = this.poseToggled ? '背手' : '解背手'
        }
        this.showBubble(pick(phrases.click) ?? '戳到我啦~')
        break
      }
      case 'drag-start':
        this.state.action = 'drag'
        this.state.emotion = 'excited'
        this.hideBubble()
        break
      case 'drag-end':
        this.state.action = 'idle'
        this.showBubble(pick(phrases['drag-end']) ?? '飞起来啦！')
        break
      case 'sleep':
        if (this.state.action !== 'sleep') this.startSleepAnimationTimer()
        this.state.action = 'sleep'
        this.state.emotion = 'sleepy'
        this.showBubble(pick(phrases.sleep) ?? 'Zzz…')
        break
      case 'cheer':
        this.state.action = 'cheer'
        this.state.emotion = 'excited'
        this.showBubble(typeof event.payload?.text === 'string' ? event.payload.text : '今日待办推荐！')
        break
      case 'alarm':
        this.state.action = 'alarm'
        this.state.emotion = 'neutral'
        this.showBubble(typeof event.payload?.text === 'string' ? event.payload.text : '闹钟已设置')
        break
      case 'idle': {
        this.state.action = 'idle'
        this.state.emotion = 'neutral'
        if (this.corpus.enabled && this.idleMinutes >= this.corpus.idleAfterMinutes) {
          const now = Date.now()
          const cooldownMs = this.corpus.idleCooldownMinutes * 60_000
          if (now - this.lastIdleBubbleAt >= cooldownMs) {
            this.lastIdleBubbleAt = now
            this.showBubble(pick(phrases.idle) ?? '我在呢~')
          }
        } else if (this.state.bubbleVisible) {
          this.hideBubble()
        }
        break
      }
      case 'wake':
      default:
        this.state.action = 'idle'
        this.state.emotion = 'neutral'
        this.showBubble(pick(phrases.wake) ?? '我醒啦！')
    }
    // 回到 idle 重新挂待机表演定时器；离开 idle（点击/拖拽/睡眠等）即撤下
    if (this.state.action === 'idle') {
      if (!this.idleShowTimer && !this.idleShowClearTimer) this.startIdleShowTimer()
    } else {
      this.stopIdleShowTimer()
    }
    this.emit()
  }

  setBubble(text: string): void {
    this.showBubble(text)
  }

  private showBubble(text: string): void {
    this.state.bubble = text
    this.state.bubbleVisible = true
    this.emit()
    this.scheduleBubbleHide()
  }

  private scheduleBubbleHide(): void {
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer)
    this.bubbleTimer = setTimeout(() => {
      this.hideBubble()
      this.bubbleTimer = undefined
    }, this.bubbleDurationSeconds * 1000)
  }

  private startSleepAnimationTimer(): void {
    this.stopSleepAnimationTimer()
    this.sleepAnimationTimer = setInterval(() => {
      if (this.state.action !== 'sleep') {
        this.stopSleepAnimationTimer()
        return
      }

      const animationName = this.pickSleepAnimation()
      if (!animationName) return

      this.state.actionNonce += 1
      this.state.animationName = animationName
      this.emit()
    }, this.sleepAnimationIntervalSeconds * 1000)
  }

  private stopSleepAnimationTimer(): void {
    if (!this.sleepAnimationTimer) return
    clearInterval(this.sleepAnimationTimer)
    this.sleepAnimationTimer = undefined
  }

  // 待机表演（如普罗米娅的刃舞）：每 sleepAnimationIntervalSeconds 秒尝试一次，
  // 播放 = 动画时长 + 间隔；非 idle（拖拽/睡眠等）或姿势保持（背手）时跳过本轮。
  private startIdleShowTimer(): void {
    // 仅重排触发定时器；表演进行中的清场定时器（idleShowClearTimer）不能动，
    // 否则 animationName 卡在表演名上、后续触发全部跳过
    if (this.idleShowTimer) {
      clearTimeout(this.idleShowTimer)
      this.idleShowTimer = undefined
    }
    if (!this.currentPack) return
    const show = [...IDLE_SHOW_ANIMATIONS].find(
      (name) => this.currentPack!.manifest.animations.includes(name)
    )
    if (!show) return
    this.idleShowTimer = setTimeout(() => {
      this.idleShowTimer = undefined
      this.fireIdleShow(show, BehaviorEngine.IDLE_SHOW_DURATION_SECONDS)
    }, this.sleepAnimationIntervalSeconds * 1000)
  }

  private stopIdleShowTimer(): void {
    if (this.idleShowTimer) {
      clearTimeout(this.idleShowTimer)
      this.idleShowTimer = undefined
    }
    if (this.idleShowClearTimer) {
      clearTimeout(this.idleShowClearTimer)
      this.idleShowClearTimer = undefined
    }
  }

  private fireIdleShow(show: string, durationSeconds: number): void {
    if (this.state.action !== 'idle') return
    const held = this.state.animationName
    if (held) {
      // 表演可接替解背手停帧（已释放、末帧即 setup）；背手保持/表演未清场则跳过本轮
      const releasedPose = POSE_ANIMATIONS.has(held) && !this.poseToggled
      if (!releasedPose) {
        this.startIdleShowTimer()
        return
      }
    }
    this.state.actionNonce += 1
    this.state.animationName = show
    this.emit()
    this.idleShowClearTimer = setTimeout(() => {
      this.idleShowClearTimer = undefined
      // 表演被点击等事件打断时 animationName 已被 handle() 清空，此处不动作
      if (this.state.animationName !== show) return
      this.state.actionNonce += 1
      this.state.animationName = undefined
      this.emit()
      this.startIdleShowTimer()
    }, durationSeconds * 1000)
  }

  private pickSleepAnimation(): string | null {
    const animations = this.currentPack?.manifest.animations ?? []
    const choices = animations.filter((name) => !SLEEP_EXCLUDED_ANIMATIONS.has(name))
    const nonRepeatingChoices = choices.filter((name) => name !== this.lastSleepAnimationName)
    const pool = nonRepeatingChoices.length > 0 ? nonRepeatingChoices : choices
    const animationName = pool[Math.floor(Math.random() * pool.length)] ?? null
    if (animationName) this.lastSleepAnimationName = animationName
    return animationName
  }

  private hideBubble(): void {
    this.state.bubbleVisible = false
    // cheer/alarm reactions exist for their bubble; once it hides the pet
    // returns to idle so sprite reactions (e.g. Promeia's closed eyes) reset.
    if (this.state.action === 'cheer' || this.state.action === 'alarm') {
      this.state.action = 'idle'
      if (!this.idleShowTimer && !this.idleShowClearTimer) this.startIdleShowTimer()
    }
    this.emit()
  }

  private emit(): void {
    this.onState(this.getState())
  }
}

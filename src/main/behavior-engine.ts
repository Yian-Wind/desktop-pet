import { DEFAULT_CORPUS } from '../shared/defaults'
import { IDLE_SHOW_ANIMATIONS, SLEEP_EXCLUDED_ANIMATIONS } from '../shared/animation-pool'
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
      // 睡眠动画池为空的包不自动入睡：入睡会撤下待机表演定时器，而池空时
      // 睡态没有任何动画可播（视觉与待机无异），等于把宠物冻结成死状态
      // （promeia_back 曾在 60s 后静默停摆刃舞）。显式 sleep 事件不受影响。
      const shouldSleep =
        this.corpus.enabled &&
        this.idleMinutes >= this.corpus.sleepAfterMinutes &&
        this.hasSleepAnimations()
      this.handle({ type: shouldSleep ? 'sleep' : 'idle' })
    }, 60_000)
    this.startIdleShowTimer()
  }

  private hasSleepAnimations(): boolean {
    const animations = this.currentPack?.manifest.animations ?? []
    return animations.some((name) => !SLEEP_EXCLUDED_ANIMATIONS.has(name))
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
    // 回到 idle 重新挂待机表演定时器；离开 idle（点击/拖拽/睡眠等）即撤下。
    // 点击是瞬时反应（动画播完即归 idle 语义），渲染端由 complete 监听回 idle，
    // 但主进程不再有后续事件——若此处不重挂，待机表演要等 60s 一次的分钟 tick
    // 才恢复，期间表现为"打断后再也不触发"。点击事件本身短暂，重挂无害：
    // fireIdleShow 触发时若 action 仍非 idle 会自动跳过本轮。
    if (this.state.action === 'idle') {
      if (!this.idleShowTimer && !this.idleShowClearTimer) this.startIdleShowTimer()
    } else if (this.state.action !== 'click' && this.state.action !== 'drag') {
      // click/drag 是短时动作（下一事件会重挂），其余（sleep 等）撤下定时器
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
      console.log('[idle-show] timer fired, interval =', this.sleepAnimationIntervalSeconds)
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
    console.log('[idle-show] fire:', show, 'action=', this.state.action,
      'held=', this.state.animationName, 'poseToggled=', this.poseToggled)
    if (this.state.action !== 'idle') {
      console.log('[idle-show] skip: not idle')
      return
    }
    // 背手姿势保持中不表演（姿势会被覆盖且手臂状态错乱）。判 poseToggled
    // 而非 animationName——分钟级 idle tick 会清掉 animationName，但姿势
    // 停帧实际仍由渲染端保持（POSE_ANIMATIONS），主进程姿势状态只在
    // 点击切换时变化。解背手释放态（poseToggled=false）可正常接替表演。
    if (this.poseToggled && this.currentPack?.manifest.animations.includes('背手')) {
      console.log('[idle-show] skip: pose held (背手)')
      this.startIdleShowTimer()
      return
    }
    this.state.actionNonce += 1
    this.state.animationName = show
    this.emit()
    this.idleShowClearTimer = setTimeout(() => {
      this.idleShowClearTimer = undefined
      // 表演被点击等事件打断时 animationName 已被 handle() 清空；
      // 仍需重挂触发器（action 已回到 idle 的话），否则定时器死锁
      if (this.state.animationName !== show) {
        console.log('[idle-show] clear skipped: interrupted')
        if (this.state.action === 'idle' && !this.idleShowTimer) this.startIdleShowTimer()
        return
      }
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
    // cheer/alarm/click reactions exist for their bubble; once it hides the pet
    // returns to idle so sprite reactions (e.g. Promeia's closed eyes) reset.
    // click 的归位尤其重要：渲染端动画播完只改渲染端状态，主进程的 action
    // 若不归位会永远停在 'click'，待机表演的 fireIdleShow 全部 skip:not idle，
    // 表现为"打断后再也不触发"。
    if (
      this.state.action === 'cheer' || this.state.action === 'alarm' ||
      this.state.action === 'click'
    ) {
      this.state.action = 'idle'
      if (!this.idleShowTimer && !this.idleShowClearTimer) this.startIdleShowTimer()
    }
    this.emit()
  }

  private emit(): void {
    this.onState(this.getState())
  }
}

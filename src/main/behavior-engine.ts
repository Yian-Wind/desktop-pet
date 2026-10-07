import { DEFAULT_CORPUS } from '../shared/defaults'
import {
  BIN_ESCAPE_ANIMATION, BIN_PEEK_ACTIVE_SECONDS, BIN_PEEK_ANIMATION,
  IDLE_SHOW_ANIMATIONS, SLEEP_EXCLUDED_ANIMATIONS
} from '../shared/animation-pool'
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
  private static readonly IDLE_SHOW_DURATION_SECONDS = 25
  private currentPack?: PetPack
  private lastSleepAnimationName: string | null = null
  // 姿势切换状态：true = 背手（下一次点击播 解背手）
  private poseToggled = false
  // 垃圾桶包（开拓者）睡态快捷按钮：张望一次后气泡隐藏回桶内待机而非唤醒
  private peekWhileSleeping = false
  // 张望激活窗口：期间再次点击（wake）→ 脱离垃圾桶；超时自动回桶内待机
  private binPeekActive = false
  // 桶内拖动：拖动期间保持睡态（渲染端沿用桶动画），松手触发顶盖张望
  private dragWhileSleeping = false
  private binPeekTimer?: ReturnType<typeof setTimeout>
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
    this.stopBinPeekState()
    this.peekWhileSleeping = false
    this.dragWhileSleeping = false
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
  }

  stop(): void {
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.stopSleepAnimationTimer()
    this.stopIdleShowTimer()
  }

  setSleepAnimationIntervalSeconds(seconds: number): void {
    this.sleepAnimationIntervalSeconds = seconds
    if (this.state.action === 'sleep') {
      this.startSleepAnimationTimer()
      this.startIdleShowTimer()
    }
  }

  setBubbleDurationSeconds(seconds: number): void {
    this.bubbleDurationSeconds = seconds
    if (this.state.bubbleVisible) this.scheduleBubbleHide()
  }

  getState(): PetWindowState {
    return { ...this.state }
  }

  async handle(event: PetEvent): Promise<void> {
    if (process.env.PET_DEBUG_BE === '1') {
      console.log('[be] event=' + event.type + ' before(action=' + this.state.action +
        ' anim=' + (this.state.animationName ?? '-') + ' peek=' + this.binPeekActive + ')')
    }
    // 刃舞表演期间忽略分钟级 tick（idle/sleep 的 nonce/animationName 重置都会
    // 掐断表演——入睡后每分钟的 tick 派发的是 sleep 事件，同样要挡）
    if ((event.type === 'idle' || event.type === 'sleep') && this.state.animationName &&
        IDLE_SHOW_ANIMATIONS.has(this.state.animationName)) return
    // 60s 周期 sleep tick 落在张望期间：不打断（张望播完自然回桶内待机）
    if ((event.type === 'idle' || event.type === 'sleep') &&
        this.state.animationName === BIN_PEEK_ANIMATION) return
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
        // 垃圾桶包：睡态拖动保持桶状态（渲染端沿用桶动画，不做拖拽换动画）
        if (this.state.action === 'sleep' && this.binPeekAvailable()) {
          this.dragWhileSleeping = true
          this.state.emotion = 'sleepy'
          this.hideBubble()
          break
        }
        this.state.action = 'drag'
        this.state.emotion = 'excited'
        this.hideBubble()
        break
      case 'drag-end':
        // 桶内松手：不回待机，直接顶盖张望看看被放到哪了
        if (this.dragWhileSleeping) {
          this.dragWhileSleeping = false
          if (this.state.action === 'sleep' && this.binPeekAvailable()) {
            this.startBinPeekState()
            this.state.action = 'sleep'
            this.state.emotion = 'sleepy'
            this.state.animationName = BIN_PEEK_ANIMATION
            this.showBubble(pick(phrases['drag-end']) ?? '飞起来啦！')
            break
          }
        }
        this.state.action = 'idle'
        this.showBubble(pick(phrases['drag-end']) ?? '飞起来啦！')
        break
      case 'sleep':
        if (this.state.action !== 'sleep') this.startSleepAnimationTimer()
        this.state.action = 'sleep'
        this.state.emotion = 'sleepy'
        this.showBubble(pick(phrases.sleep) ?? 'Zzz…')
        break
      case 'cheer': {
        // 垃圾桶包：睡眠态快捷按钮不唤醒——顶盖张望一次（animationName 通道），
        // 气泡隐藏回桶内待机（hideBubble 的 peekWhileSleeping 分支）
        if (this.state.action === 'sleep' && this.binPeekAvailable()) {
          this.state.action = 'sleep'
          this.state.emotion = 'sleepy'
          this.state.animationName = BIN_PEEK_ANIMATION
          this.peekWhileSleeping = true
          this.startBinPeekState()
          this.showBubble(typeof event.payload?.text === 'string' ? event.payload.text : '今日待办推荐！')
          break
        }
        this.state.action = 'cheer'
        this.state.emotion = 'excited'
        this.showBubble(typeof event.payload?.text === 'string' ? event.payload.text : '今日待办推荐！')
        break
      }
      case 'alarm': {
        if (this.state.action === 'sleep' && this.binPeekAvailable()) {
          this.state.action = 'sleep'
          this.state.emotion = 'sleepy'
          this.state.animationName = BIN_PEEK_ANIMATION
          this.peekWhileSleeping = true
          this.startBinPeekState()
          this.showBubble(typeof event.payload?.text === 'string' ? event.payload.text : '闹钟已设置')
          break
        }
        this.state.action = 'alarm'
        this.state.emotion = 'neutral'
        this.showBubble(typeof event.payload?.text === 'string' ? event.payload.text : '闹钟已设置')
        break
      }
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
      default: {
        const wasSleeping = this.state.action === 'sleep'
        // 垃圾桶包睡态点击：首次 → 顶盖张望（仍在桶内）；张望期间再点击 → 跳出炸开
        if (wasSleeping && this.binPeekAvailable()) {
          if (this.binPeekActive) {
            this.stopBinPeekState()
            this.state.action = 'idle'
            this.state.emotion = 'neutral'
            this.state.animationName = BIN_ESCAPE_ANIMATION
            this.showBubble(pick(phrases.wake) ?? '我醒啦！')
            break
          }
          this.startBinPeekState()
          this.state.action = 'sleep'
          this.state.emotion = 'sleepy'
          this.state.animationName = BIN_PEEK_ANIMATION
          this.showBubble(pick(phrases.click) ?? '嗯？')
          break
        }
        this.state.action = 'idle'
        this.state.emotion = 'neutral'
        this.showBubble(pick(phrases.wake) ?? '我醒啦！')
        break
      }
    }
    // 待机表演定时器生命周期：睡眠态（长待机）挂载——刃舞等表演在睡态轮播；
    // 醒/普通待机/交互撤下。click/drag 是短时动作（下一事件会重挂），
    // sleep 分支的 startSleepAnimationTimer 对池空的包没有可播项（无害）。
    if (this.state.action === 'sleep') {
      if (!this.idleShowTimer && !this.idleShowClearTimer) this.startIdleShowTimer()
    } else if (this.state.action !== 'click' && this.state.action !== 'drag') {
      this.stopIdleShowTimer()
    }
    if (process.env.PET_DEBUG_BE === '1') {
      console.log('[be] after action=' + this.state.action + ' anim=' + (this.state.animationName ?? '-'))
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

  // 垃圾桶包判定：暴露 顶盖张望 即支持睡态张望交互
  private binPeekAvailable(): boolean {
    return this.currentPack?.manifest.animations.includes(BIN_PEEK_ANIMATION) ?? false
  }

  // 张望激活窗口：动画时长内再次点击=脱离；超时窗口关闭，之后的点击重新触发张望
  private startBinPeekState(): void {
    if (this.binPeekTimer) clearTimeout(this.binPeekTimer)
    this.binPeekActive = true
    this.binPeekTimer = setTimeout(() => {
      this.binPeekTimer = undefined
      this.binPeekActive = false
    }, BIN_PEEK_ACTIVE_SECONDS * 1000)
  }

  private stopBinPeekState(): void {
    if (this.binPeekTimer) {
      clearTimeout(this.binPeekTimer)
      this.binPeekTimer = undefined
    }
    this.binPeekActive = false
  }

  private startSleepAnimationTimer(): void {
    this.stopSleepAnimationTimer()
    this.sleepAnimationTimer = setInterval(() => {
      if (this.state.action !== 'sleep') {
        this.stopSleepAnimationTimer()
        return
      }
      // 待机表演进行中不轮播——随机动画经 animationName 通道覆盖表演轨道
      if (this.state.animationName && IDLE_SHOW_ANIMATIONS.has(this.state.animationName)) return
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
  // 播放 = 动画时长 + 间隔。仅在睡眠态（长待机）播放——睡眠即本包的长待机表现，
  // 池空的包入睡后靠它轮播（替代死寂）；普通待机/姿势保持（背手）跳过本轮。
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
    // 仅睡眠态（长待机）播放：普通待机的稳定形象不被打断；池空的包
    // 入睡后由表演轮播避免死寂
    if (this.state.action !== 'sleep') {
      console.log('[idle-show] skip: not sleeping')
      return
    }
    // 背手姿势保持中不表演（姿势会被覆盖且手臂状态错乱）。判 poseToggled
    // 而非 animationName——分钟级 idle tick 会清掉 animationName，但姿势
    // 停帧实际仍由渲染端保持（POSE_ANIMATIONS），主进程姿势状态只在
    // 点击切换时变化。仅对姿势包（同时含背手/解背手）生效；
    // 解背手释放态（poseToggled=false）可正常接替表演。
    const animations = this.currentPack?.manifest.animations ?? []
    if (this.poseToggled && animations.includes('背手') && animations.includes('解背手')) {
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
        if (this.state.action === 'sleep' && !this.idleShowTimer) this.startIdleShowTimer()
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
    // 垃圾桶包睡态张望：气泡隐藏后回桶内待机（不唤醒）；注意不改
    // animationName/nonce——渲染端依赖不变则不会重播
    if (this.peekWhileSleeping) {
      this.peekWhileSleeping = false
      if (this.state.action === 'cheer' || this.state.action === 'alarm') {
        this.state.action = 'sleep'
        this.emit()
        return
      }
    }
    if (
      this.state.action === 'cheer' || this.state.action === 'alarm' ||
      this.state.action === 'click'
    ) {
      this.state.action = 'idle'
    }
    this.emit()
  }

  private emit(): void {
    this.onState(this.getState())
  }
}

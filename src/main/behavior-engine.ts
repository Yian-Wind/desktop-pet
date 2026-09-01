import { DEFAULT_CORPUS } from '../shared/defaults'
import { SLEEP_EXCLUDED_ANIMATIONS } from '../shared/animation-pool'
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
  private currentPack?: PetPack
  private lastSleepAnimationName: string | null = null
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
    this.currentPack = pack
    this.lastSleepAnimationName = null
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
  }

  setSleepAnimationIntervalSeconds(seconds: number): void {
    this.sleepAnimationIntervalSeconds = seconds
    if (this.state.action === 'sleep') this.startSleepAnimationTimer()
  }

  setBubbleDurationSeconds(seconds: number): void {
    this.bubbleDurationSeconds = seconds
    if (this.state.bubbleVisible) this.scheduleBubbleHide()
  }

  getState(): PetWindowState {
    return { ...this.state }
  }

  async handle(event: PetEvent): Promise<void> {
    if (event.type !== 'idle' && event.type !== 'sleep') this.idleMinutes = 0
    if (event.type !== 'sleep') this.stopSleepAnimationTimer()
    this.state.actionNonce += 1
    this.state.animationName = undefined
    const phrases = this.corpus.phrases
    switch (event.type) {
      case 'click':
        this.state.action = 'click'
        this.state.emotion = 'happy'
        this.showBubble(pick(phrases.click) ?? '戳到我啦~')
        break
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
    this.emit()
  }

  private emit(): void {
    this.onState(this.getState())
  }
}

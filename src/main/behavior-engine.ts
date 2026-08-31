import { DEFAULT_CORPUS } from '../shared/defaults'
import type { CorpusConfig, PetEvent, PetPack, PetWindowState } from '../shared/types'

function pick(arr: string[] | undefined): string | null {
  if (!arr || arr.length === 0) return null
  return arr[Math.floor(Math.random() * arr.length)]
}

export class BehaviorEngine {
  private state: PetWindowState = {
    packId: 'fairy',
    action: 'idle',
    emotion: 'neutral',
    bubble: '',
    bubbleVisible: false,
    busy: false,
    packType: 'gif',
    direction: 'right'
  }

  private idleMinutes = 0
  private lastIdleBubbleAt = 0
  private idleTimer?: NodeJS.Timeout
  private corpus: CorpusConfig = { ...DEFAULT_CORPUS, phrases: { ...DEFAULT_CORPUS.phrases } }

  constructor(
    private onState: (state: PetWindowState) => void
  ) {}

  start(pack: PetPack): void {
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.corpus = {
      ...DEFAULT_CORPUS,
      ...pack.corpus,
      phrases: { ...DEFAULT_CORPUS.phrases, ...pack.corpus.phrases }
    }
    this.state.packId = pack.manifest.id
    this.state.packType = pack.manifest.type
    this.state.action = 'idle'
    this.state.direction = 'right'
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
  }

  getState(): PetWindowState {
    return { ...this.state }
  }

  async handle(event: PetEvent): Promise<void> {
    if (event.type !== 'idle' && event.type !== 'sleep') this.idleMinutes = 0
    const phrases = this.corpus.phrases
    if (event.payload?.direction === 'left' || event.payload?.direction === 'right') {
      this.state.direction = event.payload.direction
    }
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
      case 'direction-change':
        break
      case 'sleep':
        this.state.action = 'sleep'
        this.state.emotion = 'sleepy'
        this.showBubble(pick(phrases.sleep) ?? 'Zzz…')
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
  }

  private hideBubble(): void {
    this.state.bubbleVisible = false
    this.emit()
  }

  private emit(): void {
    this.onState(this.getState())
  }
}

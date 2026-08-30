import type { PetEvent, PetPack, PetWindowState } from '../shared/types'

export class BehaviorEngine {
  private state: PetWindowState = {
    packId: 'fairy',
    action: 'idle',
    emotion: 'neutral',
    bubble: '',
    bubbleVisible: false,
    busy: false,
    packType: 'gif'
  }

  private idleMinutes = 0
  private idleTimer?: NodeJS.Timeout

  constructor(private onState: (state: PetWindowState) => void) {}

  start(pack: PetPack): void {
    this.state.packId = pack.manifest.id
    this.state.packType = pack.manifest.type
    this.state.action = 'idle'
    this.state.bubble = ''
    this.idleMinutes = 0
    this.emit()
    this.idleTimer = setInterval(() => {
      this.idleMinutes += 1
      this.handle({ type: this.idleMinutes >= 8 ? 'sleep' : 'idle' })
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
    switch (event.type) {
      case 'click':
        this.state.action = 'click'
        this.state.emotion = 'happy'
        this.showBubble('戳到我啦~')
        break
      case 'drag-start':
        this.state.action = 'drag'
        this.state.emotion = 'excited'
        this.hideBubble()
        break
      case 'drag-end':
        this.state.action = 'idle'
        this.showBubble('飞起来啦！')
        break
      case 'sleep':
        this.state.action = 'sleep'
        this.state.emotion = 'sleepy'
        this.hideBubble()
        break
      case 'wake':
      case 'idle':
      default:
        this.state.action = 'idle'
        this.state.emotion = 'neutral'
        if (this.state.bubbleVisible) this.hideBubble()
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

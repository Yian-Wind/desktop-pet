import type { PetEvent, PetPack, PetWindowState } from '../../shared/types'

export interface PetVisualAdapter {
  readonly kind: string
  load(pack: PetPack): Promise<void>
  play(state: PetWindowState): void
  handleEvent(event: PetEvent): void
  dispose(): void
}

export class GifPetAdapter implements PetVisualAdapter {
  readonly kind = 'gif'

  async load(_pack: PetPack): Promise<void> {
    // GIF 素材由 <img> 直接播放，这里保留加载钩子
  }

  play(_state: PetWindowState): void {
    // GIF 本身持续播放，动作通过 CSS 反馈表达
  }

  handleEvent(_event: PetEvent): void {
    // 事件由 BehaviorEngine 处理，视觉层只需响应当前 state
  }

  dispose(): void {}
}

export class Live2DPetAdapter implements PetVisualAdapter {
  readonly kind = 'live2d'

  async load(_pack: PetPack): Promise<void> {
    // Live2D Cubism SDK 接入点：后续在这里加载 model3.json / moc3 / textures
  }

  play(_state: PetWindowState): void {
    // 后续在这里绑定动作、表情、口型参数
  }

  handleEvent(_event: PetEvent): void {
    // 后续在这里处理点击/拖拽对 Live2D 参数的反馈
  }

  dispose(): void {
    // 释放 Cubism 模型资源
  }
}

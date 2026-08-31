import type { RefObject } from 'react'
import type { PetPack, PetWindowState } from '../../shared/types'
import { GifPetAdapter, Live2DPetAdapter } from './PetVisualAdapter'
import { SpinePetVisual } from './SpinePetVisual'

export interface PetHitTest {
  isPointOnPet: (clientX: number, clientY: number) => boolean
}

interface PetVisualProps {
  pack: PetPack
  state: PetWindowState
  blinkIntervalSeconds: number
  hitTestRef: RefObject<PetHitTest | null>
  onHitTestReady?: () => void
}

export function PetVisual({ pack, state, blinkIntervalSeconds, hitTestRef, onHitTestReady }: PetVisualProps) {
  if (pack.manifest.type === 'spine') {
    return (
      <SpinePetVisual
        pack={pack}
        state={state}
        blinkIntervalSeconds={blinkIntervalSeconds}
        hitTestRef={hitTestRef}
        onHitTestReady={onHitTestReady}
      />
    )
  }

  const adapter = pack.manifest.type === 'live2d' ? new Live2DPetAdapter() : new GifPetAdapter()
  adapter.load(pack)
  adapter.play(state)

  if (pack.manifest.type === 'live2d') {
    return (
      <div className={`pet-live2d pet-live2d--${state.emotion}`}>
        <span>Live2D 渲染接口已预留</span>
      </div>
    )
  }

  const sprite = pack.assets['sprite']
  const url = `pet-asset://pack/${sprite}`
  return (
    <img
      className={`pet-sprite pet-sprite--${state.action} pet-sprite--${state.emotion}`}
      src={url}
      alt={pack.manifest.name}
      draggable={false}
    />
  )
}

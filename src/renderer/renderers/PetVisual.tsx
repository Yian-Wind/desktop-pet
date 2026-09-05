import type { RefObject } from 'react'
import type { PetPack, PetWindowState } from '../../shared/types'
import { GifPetVisual } from './GifPetVisual'
import { SpinePetVisual } from './SpinePetVisual'

export interface PetVisualBounds {
  left: number
  top: number
  width: number
  height: number
  centerX: number
  centerY: number
}

export interface PetHitTest {
  isPointOnPet: (clientX: number, clientY: number) => boolean
  getVisualBounds: () => PetVisualBounds | null
}

interface PetVisualProps {
  pack: PetPack
  state: PetWindowState
  blinkIntervalSeconds: number
  coatOn?: boolean
  hitTestRef: RefObject<PetHitTest | null>
  onHitTestReady?: () => void
}

export function PetVisual({ pack, state, blinkIntervalSeconds, coatOn, hitTestRef, onHitTestReady }: PetVisualProps) {
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

  if (pack.manifest.type === 'live2d') {
    return (
      <div className={`pet-live2d pet-live2d--${state.emotion}`}>
        <span>Live2D 渲染接口已预留</span>
      </div>
    )
  }

  return (
    <GifPetVisual
      pack={pack}
      state={state}
      coatOn={coatOn}
      hitTestRef={hitTestRef}
      onHitTestReady={onHitTestReady}
    />
  )
}

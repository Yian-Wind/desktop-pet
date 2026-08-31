import { useCallback, useRef } from 'react'
import { usePet } from '../hooks/usePet'
import { PetVisual } from '../renderers/PetVisual'
import type { PetHitTest } from '../renderers/PetVisual'

export function PetWindow() {
  const { pack, state, blinkIntervalSeconds, onPointerDown, onPointerMove, onPointerUp, onPointerClick } = usePet()
  const hitTestRef = useRef<PetHitTest | null>(null)
  const clickThroughRef = useRef(false)
  const pointerDownRef = useRef(false)
  const lastHitTestAtRef = useRef(0)

  const handleHitTestReady = useCallback(() => {
    clickThroughRef.current = true
    void window.petApi.setPetClickThrough(true)
  }, [])

  if (!pack || !state) {
    return <div className="pet-loading">loading</div>
  }

  function isPointOnPet(event: React.PointerEvent | React.MouseEvent): boolean {
    return hitTestRef.current?.isPointOnPet(event.clientX, event.clientY) ?? true
  }

  function updateClickThrough(event: React.PointerEvent, forceActive = false): void {
    if (!forceActive) {
      const now = performance.now()
      if (now - lastHitTestAtRef.current < 32) return
      lastHitTestAtRef.current = now
    }
    const onPet = forceActive || isPointOnPet(event)
    if (clickThroughRef.current === onPet) return
    clickThroughRef.current = onPet
    void window.petApi.setPetClickThrough(!onPet)
  }

  function handlePointerDown(event: React.PointerEvent) {
    if (!isPointOnPet(event)) return
    pointerDownRef.current = true
    updateClickThrough(event, true)
    onPointerDown(event)
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (pointerDownRef.current) {
      onPointerMove(event)
      return
    }
    updateClickThrough(event)
    if (!clickThroughRef.current) onPointerMove(event)
  }

  function handlePointerUp(event: React.PointerEvent) {
    const wasDragging = pointerDownRef.current
    pointerDownRef.current = false
    if (!wasDragging) return
    updateClickThrough(event, true)
    onPointerUp(event)
  }

  function handlePointerClick(event: React.MouseEvent) {
    if (!isPointOnPet(event)) return
    onPointerClick(event)
  }

  function onContextMenu(event: React.MouseEvent) {
    if (!isPointOnPet(event)) return
    event.preventDefault()
    window.petApi.showContextMenu()
  }

  return (
    <div
      className={`pet-root pet-root--${state.action}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handlePointerClick}
      onContextMenu={onContextMenu}
    >
      <div className="pet-visual">
        <PetVisual
          pack={pack}
          state={state}
          blinkIntervalSeconds={blinkIntervalSeconds}
          hitTestRef={hitTestRef}
          onHitTestReady={handleHitTestReady}
        />
      </div>
      {state.bubbleVisible && state.bubble ? (
        <div className="pet-bubble">
          <span>{state.bubble}</span>
        </div>
      ) : null}
    </div>
  )
}

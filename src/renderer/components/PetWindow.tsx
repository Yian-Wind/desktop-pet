import { usePet } from '../hooks/usePet'
import { PetVisual } from '../renderers/PetVisual'

export function PetWindow() {
  const { pack, state, onPointerDown, onPointerMove, onPointerUp, onPointerClick } = usePet()

  if (!pack || !state) {
    return <div className="pet-loading">loading</div>
  }

  function onContextMenu(event: React.MouseEvent) {
    event.preventDefault()
    window.petApi.showContextMenu()
  }

  return (
    <div
      className={`pet-root pet-root--${state.action}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onPointerClick}
      onContextMenu={onContextMenu}
    >
      <div className="pet-visual">
        <PetVisual pack={pack} state={state} />
      </div>
      {state.bubbleVisible && state.bubble ? (
        <div className="pet-bubble">
          <span>{state.bubble}</span>
        </div>
      ) : null}
    </div>
  )
}

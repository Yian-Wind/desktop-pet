import { useState } from 'react'
import { Settings, PanelLeft, X } from 'lucide-react'
import { usePet } from '../hooks/usePet'
import { PetVisual } from '../renderers/PetVisual'

interface MenuState {
  x: number
  y: number
  visible: boolean
}

export function PetWindow() {
  const { pack, state, onPointerDown, onPointerMove, onPointerUp, onPointerClick } = usePet()
  const [menu, setMenu] = useState<MenuState>({ x: 0, y: 0, visible: false })

  if (!pack || !state) {
    return <div className="pet-loading">loading</div>
  }

  function onContextMenu(event: React.MouseEvent) {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, visible: true })
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
      {menu.visible ? (
        <div className="pet-context" style={{ left: menu.x, top: menu.y }}>
          <button onClick={() => { window.petApi.openPanel(); setMenu({ x: 0, y: 0, visible: false }) }}>
            <PanelLeft size={14} /> 打开面板
          </button>
          <button onClick={() => { window.petApi.openPanel(); setMenu({ x: 0, y: 0, visible: false }) }}>
            <Settings size={14} /> 设置
          </button>
          <button onClick={() => { window.petApi.quit(); setMenu({ x: 0, y: 0, visible: false }) }}>
            <X size={14} /> 退出
          </button>
        </div>
      ) : null}
    </div>
  )
}

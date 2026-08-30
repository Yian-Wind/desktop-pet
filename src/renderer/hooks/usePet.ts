import { useEffect, useMemo, useRef, useState } from 'react'
import type { PetEvent, PetPack, PetWindowState } from '../../shared/types'

export function usePet() {
  const [pack, setPack] = useState<PetPack | null>(null)
  const [state, setState] = useState<PetWindowState | null>(null)
  const draggingRef = useRef(false)
  const movedRef = useRef(false)
  const offsetRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    let disposed = false
    async function init() {
      const config = await window.petApi.getConfig()
      const packs = await window.petApi.listPacks()
      const current = packs.find((p) => p.manifest.id === config.currentPackId) ?? packs[0]
      if (!disposed) setPack(current ?? null)
      const petState = await window.petApi.getPetState()
      if (!disposed) setState(petState)
    }
    init()
    const unsubscribe = window.petApi.onPetState((next) => setState(next))
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const adapterLabel = useMemo(() => pack?.manifest.type ?? 'gif', [pack])

  function sendEvent(event: PetEvent) {
    void window.petApi.sendPetEvent(event)
  }

  function onPointerDown(event: React.PointerEvent) {
    draggingRef.current = true
    movedRef.current = false
    offsetRef.current = { x: event.clientX, y: event.clientY }
    sendEvent({ type: 'drag-start' })
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!draggingRef.current) return
    movedRef.current = true
    window.petApi.movePet(event.screenX - offsetRef.current.x, event.screenY - offsetRef.current.y)
  }

  function onPointerUp() {
    if (!draggingRef.current) return
    draggingRef.current = false
    sendEvent({ type: 'drag-end' })
  }

  function onPointerClick() {
    if (!movedRef.current) sendEvent({ type: 'click' })
  }

  return { pack, state, adapterLabel, onPointerDown, onPointerMove, onPointerUp, onPointerClick }
}

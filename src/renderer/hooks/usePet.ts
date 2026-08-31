import { useEffect, useMemo, useRef, useState } from 'react'
import type { PetEvent, PetPack, PetWindowState } from '../../shared/types'

export function usePet() {
  const [pack, setPack] = useState<PetPack | null>(null)
  const [state, setState] = useState<PetWindowState | null>(null)
  const [blinkIntervalSeconds, setBlinkIntervalSeconds] = useState(4)
  const packListRef = useRef<PetPack[]>([])
  const draggingRef = useRef(false)
  const movedRef = useRef(false)
  const offsetRef = useRef({ x: 0, y: 0 })
  const lastPointerXRef = useRef(0)
  const directionRef = useRef<'left' | 'right'>('right')

  useEffect(() => {
    let disposed = false
    async function init() {
      const config = await window.petApi.getConfig()
      const packs = await window.petApi.listPacks()
      packListRef.current = packs
      const petState = await window.petApi.getPetState()
      const configured = packs.find((p) => p.manifest.id === config.currentPackId) ?? packs[0]
      const current = packs.find((p) => p.manifest.id === petState.packId) ?? configured
      if (!disposed) {
        setPack(current ?? null)
        setState(petState)
        setBlinkIntervalSeconds(config.spine.blinkIntervalSeconds)
      }
    }
    void init()
    const unsubscribe = window.petApi.onPetState((next) => {
      setState(next)
      setPack((prev) => {
        if (prev?.manifest.id === next.packId) return prev
        return packListRef.current.find((p) => p.manifest.id === next.packId) ?? prev
      })
    })
    const unsubscribeConfig = window.petApi.onConfigChanged((next) => {
      setBlinkIntervalSeconds(next.spine.blinkIntervalSeconds)
    })
    return () => {
      disposed = true
      unsubscribe()
      unsubscribeConfig()
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
    lastPointerXRef.current = event.screenX
    sendEvent({ type: 'drag-start' })
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!draggingRef.current) return
    movedRef.current = true
    const deltaX = event.screenX - lastPointerXRef.current
    if (Math.abs(deltaX) >= 2) {
      const direction = deltaX > 0 ? 'right' : 'left'
      if (direction !== directionRef.current) {
        directionRef.current = direction
        sendEvent({ type: 'direction-change', payload: { direction } })
      }
      lastPointerXRef.current = event.screenX
    }
    window.petApi.movePet(event.screenX - offsetRef.current.x, event.screenY - offsetRef.current.y)
  }

  function onPointerUp(_event: React.PointerEvent) {
    if (!draggingRef.current) return
    draggingRef.current = false
    sendEvent({ type: 'drag-end' })
  }

  function onPointerClick(_event: React.MouseEvent) {
    if (!movedRef.current) sendEvent({ type: 'click' })
  }

  return { pack, state, adapterLabel, blinkIntervalSeconds, onPointerDown, onPointerMove, onPointerUp, onPointerClick }
}

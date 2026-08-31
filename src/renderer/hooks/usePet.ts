import { useEffect, useMemo, useRef, useState } from 'react'
import type { PetEvent, PetPack, PetWindowState } from '../../shared/types'

const DRAG_THRESHOLD_PX = 4

export function usePet() {
  const [pack, setPack] = useState<PetPack | null>(null)
  const [state, setState] = useState<PetWindowState | null>(null)
  const [blinkIntervalSeconds, setBlinkIntervalSeconds] = useState(4)
  const packListRef = useRef<PetPack[]>([])
  const pointerDownRef = useRef(false)
  const draggingRef = useRef(false)
  const movedRef = useRef(false)
  const offsetRef = useRef({ x: 0, y: 0 })
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null)
  const moveFrameRef = useRef<number | null>(null)

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
      flushPendingMove()
      unsubscribe()
      unsubscribeConfig()
    }
  }, [])

  const adapterLabel = useMemo(() => pack?.manifest.type ?? 'gif', [pack])

  function sendEvent(event: PetEvent) {
    void window.petApi.sendPetEvent(event)
  }

  function flushPendingMove() {
    if (moveFrameRef.current !== null) {
      cancelAnimationFrame(moveFrameRef.current)
      moveFrameRef.current = null
    }
    const move = pendingMoveRef.current
    if (!move) return
    pendingMoveRef.current = null
    void window.petApi.movePet(move.x, move.y)
  }

  function onPointerDown(event: React.PointerEvent) {
    pointerDownRef.current = true
    draggingRef.current = false
    movedRef.current = false
    offsetRef.current = { x: event.clientX, y: event.clientY }
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!pointerDownRef.current) return
    const distance = Math.hypot(
      event.clientX - offsetRef.current.x,
      event.clientY - offsetRef.current.y
    )
    if (!draggingRef.current) {
      if (distance < DRAG_THRESHOLD_PX) return
      draggingRef.current = true
      movedRef.current = true
      sendEvent({ type: 'drag-start' })
    }
    pendingMoveRef.current = {
      x: event.screenX - offsetRef.current.x,
      y: event.screenY - offsetRef.current.y
    }
    if (moveFrameRef.current === null) {
      moveFrameRef.current = requestAnimationFrame(() => {
        moveFrameRef.current = null
        flushPendingMove()
      })
    }
  }

  function onPointerUp(_event: React.PointerEvent) {
    pointerDownRef.current = false
    if (!draggingRef.current) return
    draggingRef.current = false
    flushPendingMove()
    void window.petApi.dropPet()
    sendEvent({ type: 'drag-end' })
  }

  function onPointerClick(_event: React.MouseEvent) {
    if (!movedRef.current) sendEvent({ type: 'click' })
  }

  return { pack, state, adapterLabel, blinkIntervalSeconds, onPointerDown, onPointerMove, onPointerUp, onPointerClick }
}

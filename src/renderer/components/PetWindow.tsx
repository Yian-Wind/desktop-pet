import { useCallback, useEffect, useRef, useState } from 'react'
import { AlarmClock, ListTodo, MoreHorizontal } from 'lucide-react'
import { usePet } from '../hooks/usePet'
import { PetVisual } from '../renderers/PetVisual'
import type { PetHitTest } from '../renderers/PetVisual'

const quickActionHideDelayMs = 240

export function PetWindow() {
  const { pack, state, blinkIntervalSeconds, onPointerDown, onPointerMove, onPointerUp, onPointerClick } = usePet()
  const hitTestRef = useRef<PetHitTest | null>(null)
  const clickThroughRef = useRef(false)
  const pointerDownRef = useRef(false)
  const lastHitTestAtRef = useRef(0)
  const pointerOnPetRef = useRef(false)
  const [quickActionsVisible, setQuickActionsVisible] = useState(false)
  const quickActionsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [alarmEditorVisible, setAlarmEditorVisible] = useState(false)
  const [alarmMinutes, setAlarmMinutes] = useState('5')

  function applyPetClickThrough(ignore: boolean): void {
    if (clickThroughRef.current === ignore) return
    clickThroughRef.current = ignore
    void window.petApi.setPetClickThrough(ignore)
  }

  const handleHitTestReady = useCallback(() => {
    applyPetClickThrough(true)
  }, [])

  useEffect(() => {
    if (pack?.manifest.type === 'spine') return
    hitTestRef.current = null
    applyPetClickThrough(false)
  }, [pack?.manifest.id, pack?.manifest.type])

  useEffect(() => {
    return () => {
      if (quickActionsHideTimerRef.current) clearTimeout(quickActionsHideTimerRef.current)
    }
  }, [])

  if (!pack || !state) {
    return <div className="pet-loading">loading</div>
  }

  function isPointOnPet(event: React.PointerEvent | React.MouseEvent): boolean {
    return hitTestRef.current?.isPointOnPet(event.clientX, event.clientY) ?? true
  }

  function updateClickThrough(event: React.PointerEvent, forceActive = false): void {
    if (pointerDownRef.current) {
      applyPetClickThrough(false)
      return
    }
    if (isQuickActionTarget(event)) {
      applyPetClickThrough(false)
      return
    }
    if (!forceActive) {
      const now = performance.now()
      if (now - lastHitTestAtRef.current < 32) return
      lastHitTestAtRef.current = now
    }
    const onPet = forceActive || isPointOnPet(event)
    applyPetClickThrough(!onPet)
  }

  function showQuickActions(): void {
    if (quickActionsHideTimerRef.current) {
      clearTimeout(quickActionsHideTimerRef.current)
      quickActionsHideTimerRef.current = null
    }
    setQuickActionsVisible(true)
  }

  function scheduleQuickActionsHide(): void {
    if (quickActionsHideTimerRef.current) return
    quickActionsHideTimerRef.current = setTimeout(() => {
      quickActionsHideTimerRef.current = null
      setQuickActionsVisible(false)
      setAlarmEditorVisible(false)
    }, quickActionHideDelayMs)
  }

  function isQuickActionTarget(event: React.PointerEvent | React.MouseEvent): boolean {
    return event.target instanceof Element && event.target.closest('.pet-quick-actions, .pet-alarm-editor') !== null
  }

  function isInsideQuickActionRetentionZone(event: React.PointerEvent | React.MouseEvent): boolean {
    const rect = event.currentTarget.getBoundingClientRect()
    const stageSize = rect.width * 0.588235
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height * 0.20588 + stageSize * 0.31
    const retentionRadius = stageSize * 0.42
    return Math.hypot(event.clientX - centerX, event.clientY - centerY) <= retentionRadius
  }

  function handlePointerDown(event: React.PointerEvent) {
    if (isQuickActionTarget(event)) {
      applyPetClickThrough(false)
      return
    }
    if (!isPointOnPet(event)) return
    setQuickActionsVisible(false)
    setAlarmEditorVisible(false)
    pointerDownRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    updateClickThrough(event, true)
    onPointerDown(event)
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (pointerDownRef.current) {
      setQuickActionsVisible(false)
      setAlarmEditorVisible(false)
      onPointerMove(event)
      return
    }
    const onPet = isPointOnPet(event)
    const wasOnPet = pointerOnPetRef.current
    const onQuickActionTarget = isQuickActionTarget(event)
    const insideRetentionZone = onPet || onQuickActionTarget || (
      quickActionsVisible && isInsideQuickActionRetentionZone(event)
    )

    if (quickActionsVisible) {
      if (insideRetentionZone) showQuickActions()
      else scheduleQuickActionsHide()
    } else if (onPet && !wasOnPet) {
      showQuickActions()
    } else {
      scheduleQuickActionsHide()
    }
    pointerOnPetRef.current = onPet
    updateClickThrough(event)
    if (!clickThroughRef.current && !quickActionsVisible) onPointerMove(event)
  }

  function handlePointerUp(event: React.PointerEvent) {
    finishPointerDrag(event)
  }

  function handlePointerCancel(event: React.PointerEvent) {
    finishPointerDrag(event)
  }

  function finishPointerDrag(event: React.PointerEvent) {
    if (!pointerDownRef.current) return
    pointerDownRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    updateClickThrough(event, true)
    onPointerUp(event)
  }

  function handlePointerClick(event: React.MouseEvent) {
    if (isQuickActionTarget(event)) return
    if (!isPointOnPet(event)) return
    onPointerClick(event)
  }

  async function recommendTodayTodo() {
    const result = await window.petApi.recommendTodo()
    await window.petApi.sendPetEvent({ type: 'cheer', payload: { text: result.text } })
  }

  function scheduleAlarm(): void {
    const minutes = Number(alarmMinutes)
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) return

    setAlarmEditorVisible(false)
    void window.petApi.scheduleAlarm(minutes)
    void window.petApi.sendPetEvent({
      type: 'alarm',
      payload: { text: `闹钟已设置：${minutes} 分钟后提醒` }
    })
  }

  function handlePointerEnter(event: React.PointerEvent) {
    const onPet = isPointOnPet(event)
    pointerOnPetRef.current = onPet
    if (onPet || isQuickActionTarget(event)) showQuickActions()
    else scheduleQuickActionsHide()
  }

  function handlePointerLeave() {
    pointerOnPetRef.current = false
    scheduleQuickActionsHide()
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
      onPointerCancel={handlePointerCancel}
      onClick={handlePointerClick}
      onContextMenu={onContextMenu}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <div
        className={`pet-quick-actions${quickActionsVisible && state.action !== 'drag' ? ' pet-quick-actions--visible' : ''}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="pet-quick-action pet-quick-action--todo"
          title="今日待办推荐"
          onClick={() => void recommendTodayTodo()}
        >
          <ListTodo size={16} />
        </button>
        <button
          type="button"
          className="pet-quick-action pet-quick-action--alarm"
          title="定时闹钟"
          onClick={() => setAlarmEditorVisible((visible) => !visible)}
        >
          <AlarmClock size={16} />
        </button>
        <span
          className="pet-quick-action pet-quick-action--reserved"
          title="预留功能"
          role="button"
          aria-disabled="true"
          tabIndex={-1}
        >
          <MoreHorizontal size={16} />
        </span>
      </div>
      {alarmEditorVisible ? (
        <form
          className="pet-alarm-editor"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault()
            scheduleAlarm()
          }}
        >
          <input
            type="number"
            min={1}
            max={1440}
            value={alarmMinutes}
            onChange={(event) => setAlarmMinutes(event.target.value)}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Escape') setAlarmEditorVisible(false)
            }}
          />
          <span>分钟</span>
          <button type="submit">确定</button>
        </form>
      ) : null}
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

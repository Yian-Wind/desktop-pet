import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { PetPack, PetWindowState } from '../../shared/types'
import type { PetHitTest, PetVisualBounds } from './PetVisual'

interface SourceBounds {
  left: number
  top: number
  right: number
  bottom: number
}

interface GifPetVisualProps {
  pack: PetPack
  state: PetWindowState
  coatOn?: boolean
  hitTestRef: RefObject<PetHitTest | null>
  onHitTestReady?: () => void
}

interface DisplayRect {
  left: number
  top: number
  width: number
  height: number
  scaleX: number
  scaleY: number
}

function getOpaqueSourceBounds(data: Uint8ClampedArray, width: number, height: number): SourceBounds | null {
  let left = -1
  let top = -1
  let right = -1
  let bottom = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3]
      if (alpha <= 8) continue
      if (left === -1 || x < left) left = x
      if (top === -1 || y < top) top = y
      if (x > right) right = x
      if (y > bottom) bottom = y
    }
  }

  if (left === -1) return null
  return { left, top, right, bottom }
}

function getDisplayRect(image: HTMLImageElement): DisplayRect | null {
  const naturalWidth = image.naturalWidth
  const naturalHeight = image.naturalHeight
  if (!naturalWidth || !naturalHeight) return null

  const rect = image.getBoundingClientRect()
  const scaleX = rect.width / naturalWidth
  const scaleY = rect.height / naturalHeight
  const scale = Math.min(scaleX, scaleY)
  const width = naturalWidth * scale
  const height = naturalHeight * scale
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
    scaleX: scale,
    scaleY: scale
  }
}

function getVisualBounds(image: HTMLImageElement, sourceBounds: SourceBounds): PetVisualBounds | null {
  const displayRect = getDisplayRect(image)
  if (!displayRect) return null
  const left = displayRect.left + sourceBounds.left * displayRect.scaleX
  const top = displayRect.top + sourceBounds.top * displayRect.scaleY
  const width = Math.max(1, (sourceBounds.right - sourceBounds.left + 1) * displayRect.scaleX)
  const height = Math.max(1, (sourceBounds.bottom - sourceBounds.top + 1) * displayRect.scaleY)
  return { left, top, width, height, centerX: left + width / 2, centerY: top + height / 2 }
}

export function GifPetVisual({ pack, state, coatOn, hitTestRef, onHitTestReady }: GifPetVisualProps) {
  const imageRef = useRef<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sourceBoundsRef = useRef<SourceBounds | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const sprite = pack.assets['sprite']
  const spriteEyeclosed = pack.assets['spriteEyeclosed']
  const coat = pack.assets['coat']
  const hasCoat = Boolean(coat)
  const baseUrl = `pet-asset://pack/${sprite}`
  const eyeclosedUrl = spriteEyeclosed ? `pet-asset://pack/${spriteEyeclosed}` : null
  const coatUrl = coat ? `pet-asset://pack/${coat}` : null
  const dragging = state.action === 'drag'
  const src = dragging && eyeclosedUrl ? eyeclosedUrl : baseUrl

  useEffect(() => {
    // Warm the variant caches so toggling (drag eyes, coat) never flashes.
    for (const url of [eyeclosedUrl, coatUrl]) {
      if (!url) continue
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.src = url
    }
  }, [eyeclosedUrl, coatUrl])

  useEffect(() => {
    if (hasCoat) return
    if (state.action !== 'click') return
    const image = imageRef.current
    if (!image) return
    const animation = image.animate(
      [
        { transform: 'translateY(0) scale(1)' },
        { transform: 'translateY(-18px) scale(1.06)', offset: 0.4 },
        { transform: 'translateY(2px) scale(0.98)', offset: 0.7 },
        { transform: 'translateY(0) scale(1)' }
      ],
      { duration: 500, easing: 'ease' }
    )
    return () => animation.cancel()
  }, [state.action, state.actionNonce, hasCoat])

  useEffect(() => {
    return () => {
      hitTestRef.current = null
      canvasRef.current = null
      sourceBoundsRef.current = null
      setImageLoaded(false)
    }
  }, [hitTestRef])

  function handleImageLoad(event: React.SyntheticEvent<HTMLImageElement>): void {
    const image = event.currentTarget
    imageRef.current = image
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })

    if (!context || !canvas.width || !canvas.height) {
      onHitTestReady?.()
      return
    }

    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0)
    sourceBoundsRef.current = getOpaqueSourceBounds(
      context.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width,
      canvas.height
    )
    canvasRef.current = canvas
    hitTestRef.current = {
      isPointOnPet(clientX, clientY) {
        const image = imageRef.current
        const hitCanvas = canvasRef.current
        const sourceBounds = sourceBoundsRef.current
        if (!image || !hitCanvas || !sourceBounds) return false

        const displayRect = getDisplayRect(image)
        if (!displayRect) return false
        const x = clientX - displayRect.left
        const y = clientY - displayRect.top
        if (x < 0 || y < 0 || x >= displayRect.width || y >= displayRect.height) return false

        const sourceX = Math.floor(x / displayRect.scaleX)
        const sourceY = Math.floor(y / displayRect.scaleY)
        if (
          sourceX < sourceBounds.left ||
          sourceX > sourceBounds.right ||
          sourceY < sourceBounds.top ||
          sourceY > sourceBounds.bottom
        ) return false

        const hitContext = hitCanvas.getContext('2d', { willReadFrequently: true })
        if (!hitContext) return false
        hitContext.clearRect(0, 0, hitCanvas.width, hitCanvas.height)
        hitContext.drawImage(image, 0, 0)
        return hitContext.getImageData(sourceX, sourceY, 1, 1).data[3] > 8
      },
      getVisualBounds() {
        const image = imageRef.current
        const sourceBounds = sourceBoundsRef.current
        if (!image || !sourceBounds) return null
        return getVisualBounds(image, sourceBounds)
      }
    }
    setImageLoaded(true)
    onHitTestReady?.()
  }

  // Float continuously except while being dragged or asleep; the behavior
  // engine only returns to 'idle' on its minute tick, so gating on 'idle'
  // alone would pause the float for up to a minute after any click.
  const floating = Boolean(pack.manifest.floating) && state.action !== 'drag' && state.action !== 'sleep'
  const actionClass = `pet-sprite pet-sprite--${state.action} pet-sprite--${state.emotion}${imageLoaded ? '' : ' pet-sprite--loading'}${floating ? ' pet-sprite--float' : ''}`

  if (!coatUrl) {
    return (
      <img
        ref={imageRef}
        className={actionClass}
        src={src}
        alt={pack.manifest.name}
        crossOrigin="anonymous"
        draggable={false}
        onLoad={handleImageLoad}
      />
    )
  }

  return (
    <div className={actionClass}>
      <img
        ref={imageRef}
        className="pet-sprite-layer"
        src={src}
        alt={pack.manifest.name}
        crossOrigin="anonymous"
        draggable={false}
        onLoad={handleImageLoad}
      />
      {coatOn ? (
        <img
          className="pet-sprite-layer pet-sprite-layer--coat"
          src={coatUrl}
          alt=""
          crossOrigin="anonymous"
          draggable={false}
        />
      ) : null}
    </div>
  )
}

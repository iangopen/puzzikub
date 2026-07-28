import type { DragState } from '../hooks/useDrag'
import type { TileStyle } from '../lib/themes'
import { tileMetrics } from '../lib/boardScale'
import { TileFace } from './TileFace'

interface Props {
  drag: DragState
  previewId?: string
  tileStyle: TileStyle
  /** Board-scale preference — the preview must match the tiles it came from. */
  scale?: number
}

/**
 * Extra lift for TOUCH drags, on top of the usual half-tile offset.
 *
 * A fingertip contact patch is roughly 40-50px across — wider than a 46px tile
 * and far wider than a 23px one at 50% scale — so the mouse's dead-centre
 * offset would park the preview entirely underneath the finger. Lifting it
 * clear of the contact patch keeps the dragged tile visible, which matters
 * doubly here because the preview is the only feedback showing WHICH tile is
 * in flight.
 */
const TOUCH_LIFT = 28

export function DragPreview({ drag, previewId, tileStyle, scale = 1 }: Props) {
  const m = tileMetrics(scale)
  const isTouch = drag.pointer === 'touch'
  return (
    <div id={previewId} style={{
      position: 'fixed',
      // Centre the preview on the cursor. Derived from the scaled tile size,
      // not the hardcoded 23/29, so it stays centred at every scale. This is
      // `position: fixed` off clientX/clientY and therefore sits outside the
      // board's layout entirely — one of the reasons scale is a real resize
      // rather than a transform (see src/lib/boardScale.ts).
      //
      // Touch lifts the tile ABOVE the contact point instead of centring on it.
      left: drag.x - m.w / 2,
      top: isTouch ? drag.y - m.h - TOUCH_LIFT : drag.y - m.h / 2,
      pointerEvents: 'none',
      zIndex: 9999,
      userSelect: 'none',
      touchAction: 'none',
    }}>
      <TileFace tile={drag.tile} tileStyle={tileStyle} scale={scale} />
    </div>
  )
}

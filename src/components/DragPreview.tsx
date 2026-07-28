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

export function DragPreview({ drag, previewId, tileStyle, scale = 1 }: Props) {
  const m = tileMetrics(scale)
  return (
    <div id={previewId} style={{
      position: 'fixed',
      // Centre the preview on the cursor. Derived from the scaled tile size,
      // not the hardcoded 23/29, so it stays centred at every scale. This is
      // `position: fixed` off clientX/clientY and therefore sits outside the
      // board's layout entirely — one of the reasons scale is a real resize
      // rather than a transform (see src/lib/boardScale.ts).
      left: drag.x - m.w / 2,
      top: drag.y - m.h / 2,
      pointerEvents: 'none',
      zIndex: 9999,
      userSelect: 'none',
      touchAction: 'none',
    }}>
      <TileFace tile={drag.tile} tileStyle={tileStyle} scale={scale} />
    </div>
  )
}

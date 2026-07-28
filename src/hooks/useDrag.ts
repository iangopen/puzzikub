import { useState } from 'react'
import type { Tile, DragSrc } from '../types'

/** Which input device started the drag. Drives DragPreview's offset only. */
export type PointerKind = 'mouse' | 'touch'

export interface DragState {
  tile: Tile
  src: DragSrc
  x: number
  y: number
  pointer: PointerKind
  /**
   * Touch.identifier of the finger that started this drag; undefined for mouse.
   *
   * ***Load-bearing: every later touchmove/touchend MUST locate this exact
   * identifier*** rather than indexing `touches[0]`. A second finger landing
   * mid-drag reorders those lists, and indexing [0] would then track the wrong
   * finger — the drag would jump to it and drop somewhere the player never
   * touched.
   */
  touchId?: number
}

export function useDrag() {
  const [drag, setDrag] = useState<DragState | null>(null)

  /**
   * The shared core — the only new logic in the mouse/touch split. Both
   * wrappers below funnel into this, so mouse and touch drags produce
   * byte-identical DragState apart from `pointer`/`touchId`.
   */
  const startDragAt = (
    tile: Tile,
    src: DragSrc,
    x: number,
    y: number,
    pointer: PointerKind = 'mouse',
    touchId?: number,
  ) => {
    setDrag({ tile, src, x, y, pointer, touchId })
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'
  }

  /** Mouse wrapper — behaviour deliberately UNCHANGED from before the split. */
  const startDrag = (e: React.MouseEvent, tile: Tile, src: DragSrc) => {
    e.preventDefault()
    e.stopPropagation()
    startDragAt(tile, src, e.clientX, e.clientY, 'mouse')
  }

  /**
   * Touch wrapper.
   *
   * ***Deliberately does NOT call preventDefault.*** Scroll suppression comes
   * from `touch-action: none` on the tile itself (established in the mobile
   * groundwork session), not from JS. Calling preventDefault here would also
   * suppress the tap-to-focus and accessibility behaviour the browser layers on
   * touchstart, for no gain.
   *
   * `changedTouches[0]` is correct HERE and only here: on touchstart that list
   * holds exactly the finger(s) that just landed, so it identifies the one that
   * began this drag. Everything afterwards matches on `identifier`.
   */
  const startDragTouch = (e: React.TouchEvent, tile: Tile, src: DragSrc) => {
    e.stopPropagation()
    const t = e.changedTouches[0]
    if (!t) return
    startDragAt(tile, src, t.clientX, t.clientY, 'touch', t.identifier)
  }

  const updatePos = (x: number, y: number) => {
    setDrag(d => d ? { ...d, x, y } : null)
  }

  const endDrag = () => {
    setDrag(null)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }

  return { drag, startDragAt, startDrag, startDragTouch, updatePos, endDrag }
}

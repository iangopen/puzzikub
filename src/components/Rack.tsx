import { useContext } from 'react'
import type { Tile, DragSrc } from '../types'
import type { DragState } from '../hooks/useDrag'
import { TileStyleContext } from '../lib/themes'
import { tileMetrics } from '../lib/boardScale'
import { TileFace } from './TileFace'

interface Props {
  tiles: Tile[]
  drag: DragState | null
  onTileMouseDown: (e: React.MouseEvent, tile: Tile, src: DragSrc) => void
  onTileTouchStart: (e: React.TouchEvent, tile: Tile, src: DragSrc) => void
  onRackEnter: () => void
  onRackLeave: () => void
  /** Board-scale preference — rack tiles must match board tiles exactly. */
  scale?: number
}

export function Rack({ tiles, drag, onTileMouseDown, onTileTouchStart, onRackEnter, onRackLeave, scale = 1 }: Props) {
  const tileStyle = useContext(TileStyleContext)
  const m = tileMetrics(scale)
  // m=2 migration Step 9 — POSITIONAL, and it must stay that way.
  //
  // This compares the dragged tile's rack INDEX to the index being rendered. Two
  // copies of a duplicate (value, colour) are visually identical, so if this ever
  // became a `tile.n === drag.tile.n && tile.c === drag.tile.c` comparison,
  // dragging ONE copy would dim BOTH — which looks broken AND leaks to the player
  // that the two tiles are "the same", something real Rummikub never reveals.
  // Comparing `tile.id === drag.tile.id` would also be correct (ids are unique per
  // puzzle); comparing value+colour is the bug. Do not "simplify" this.
  const draggingRackIdx = drag?.src.from === 'rack' ? drag.src.rackIdx : undefined

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>rack</div>
      <div
        // TOUCH DROP TARGET — the rack as a whole. Resolved by PlayScreen's
        // .closest('[data-cell],[data-rack]') hit-test; see Board.tsx for why
        // touch needs an attribute where mouse gets by with onMouseEnter.
        data-rack=""
        onMouseEnter={onRackEnter}
        onMouseLeave={onRackLeave}
        style={{
          background: 'var(--rack-bg)',
          borderRadius: m.radius(12),
          padding: m.radius(12),
          display: 'flex',
          gap: m.radius(8),
          flexWrap: 'wrap',
          minHeight: m.h + m.radius(12) * 2,
          transition: 'background 0.15s ease',
          // TOUCH GROUNDWORK — rack BACKGROUND is empty space, so it pans.
          // The tile wrappers below opt out individually.
          touchAction: 'pan-x pan-y',
        }}
      >
        {tiles.map((tile, i) => (
          <div
            // Keyed by stable tile id, not array index: the rack is spliced on
            // every RACK->GRID drop and appended on every displacement, so index
            // keys remount surviving tiles and restart their animations. Ids are
            // unique within a puzzle (builders mint copy 0/1; the editor caps at
            // TILE_COPIES; legacy migration mints distinct copies), so this is a
            // valid sibling key even with both copies of a duplicate in the rack.
            key={tile.id}
            data-tile-id={tile.id}
            // TOUCH GROUNDWORK — a rack tile is draggable, so like an occupied
            // board cell it opts out of native panning.
            style={{
              cursor: 'grab',
              userSelect: 'none',
              touchAction: 'none',
              WebkitTapHighlightColor: 'transparent',
            }}
            onMouseDown={e => onTileMouseDown(e, tile, { from: 'rack', rackIdx: i })}
            onTouchStart={e => onTileTouchStart(e, tile, { from: 'rack', rackIdx: i })}
          >
            <TileFace
              tile={tile}
              tileStyle={tileStyle}
              dimmed={draggingRackIdx === i}
              scale={scale}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

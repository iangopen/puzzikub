import { useContext } from 'react'
import type { Grid, DragSrc, Tile } from '../types'
import type { DragState } from '../hooks/useDrag'
import { TileStyleContext } from '../lib/themes'
import { tileMetrics } from '../lib/boardScale'
import { TileFace } from './TileFace'

interface Props {
  grid: Grid
  drag: DragState | null
  hoveredCell: { row: number; col: number } | null
  onTileMouseDown: (e: React.MouseEvent, tile: Tile, src: DragSrc) => void
  onCellEnter: (row: number, col: number) => void
  onCellLeave: () => void
  invalidCells: Set<string>
  lockInCells: Set<string>
  /** Board-scale preference; 1 = the original 46x58 rendering. */
  scale?: number
}

export function Board({ grid, drag, hoveredCell, onTileMouseDown, onCellEnter, onCellLeave, invalidCells, lockInCells, scale = 1 }: Props) {
  const tileStyle = useContext(TileStyleContext)
  const m = tileMetrics(scale)

  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  if (rows === 0 || cols === 0) return null

  const srcRow = drag?.src.from === 'grid' ? drag.src.row : undefined
  const srcCol = drag?.src.from === 'grid' ? drag.src.col : undefined
  const shakeKey = [...invalidCells].find(k => k.startsWith('__v:')) ?? '__v:0'

  const cells = []

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = grid[r][c]
      const hovered = hoveredCell?.row === r && hoveredCell?.col === c
      const isDraggingSrc = srcRow === r && srcCol === c
      const isInvalid = invalidCells.has(`${r},${c}`)
      const isLockIn = lockInCells.has(`${r},${c}`)

      if (tile) {
        cells.push(
          <div
            key={isInvalid ? `${r}-${c}-${shakeKey}` : `${r}-${c}`}
            // TOUCH GROUNDWORK — see the container comment below. An OCCUPIED
            // cell is reserved for dragging, so it opts out of native touch
            // panning entirely.
            style={{ cursor: 'grab', userSelect: 'none', touchAction: 'none' }}
            onMouseDown={e => onTileMouseDown(e, tile, { from: 'grid', row: r, col: c })}
            onMouseEnter={() => onCellEnter(r, c)}
            onMouseLeave={onCellLeave}
          >
            <TileFace
              tile={tile}
              tileStyle={tileStyle}
              invalid={isInvalid}
              lockIn={isLockIn}
              dimmed={isDraggingSrc}
              hovered={hovered && !isDraggingSrc}
              scale={scale}
            />
          </div>,
        )
      } else {
        cells.push(
          <div
            key={`empty-${r}-${c}`}
            className="cell-idle"
            style={{
              width: m.w,
              height: m.h,
              borderRadius: m.radius(8),
              background: hovered ? 'var(--cell-hover)' : 'var(--cell-empty)',
              outline: hovered ? '2px solid rgba(0,0,0,0.15)' : 'none',
              outlineOffset: -2,
              transition: 'background 0.15s ease',
              // TOUCH GROUNDWORK — an EMPTY cell is not draggable, so a touch
              // starting here must pan the board natively. Setting
              // `touchAction: 'none'` here would break panning outright.
              touchAction: 'auto',
            }}
            onMouseEnter={() => onCellEnter(r, c)}
            onMouseLeave={onCellLeave}
          />,
        )
      }
    }
  }

  return (
    /*
     * TOUCH GROUNDWORK — the scroll/pan container.
     *
     * Boards run 6-12 columns, i.e. 338px-650px at 100%, against roughly 350px
     * of usable width on a typical phone. This wrapper is what makes the wide
     * cases reachable: `overflow-x: auto` means the browser scrolls it natively
     * whenever the grid exceeds the available width, with no JS.
     *
     * ***THE TOUCH-ACTION SPLIT — the whole point of this container, and what
     * the FUTURE touch-drag session depends on.*** Panning and tile-dragging
     * need no competing gesture code, because they are separated by WHERE the
     * touch starts:
     *   - occupied tile cells (above) and rack tiles -> `touch-action: none`,
     *     so a future touchstart handler on a tile can drag without the browser
     *     stealing the gesture for a scroll;
     *   - empty cells (above) and this container -> pannable, so a touch on
     *     empty space scrolls the board natively.
     * If this container ever gets `touch-action: none`, native panning dies and
     * wide boards become unreachable on touch. `pan-x pan-y` is the explicit
     * spelling of "scroll me normally, both axes".
     *
     * NO touch event handlers are added in this session — that is the next
     * session's work. This is only the CSS foundation it needs.
     *
     * Only the X axis is constrained: vertical is left to normal page scroll,
     * because a nested vertical scroller here would fight the page's own.
     * (Per CSS, `overflow-y: visible` computes to `auto` when overflow-x is
     * `auto`; harmless, since no max-height is set, so the container is always
     * exactly as tall as its content and never scrolls vertically.)
     */
    <div
      style={{
        maxWidth: '100%',
        overflowX: 'auto',
        touchAction: 'pan-x pan-y',
        WebkitOverflowScrolling: 'touch',
        // Centre the grid while it fits, scroll once it doesn't.
        //
        // ***`safe center`, NOT plain `center` — measured, not stylistic.*** A
        // plain `center` on an overflowing flex container pushes HALF the
        // overflow past the LEFT edge, where scrolling cannot reach it: the
        // 12-column cut-point board on a 390px viewport reported scrollWidth
        // 500 instead of 650 and a 150px pan range instead of 300px, i.e. the
        // first three columns were permanently unreachable. `safe` falls back
        // to start-alignment exactly when centring would cause that overflow.
        display: 'flex',
        justifyContent: 'safe center',
      }}
    >
      <div
        style={{
          // `grid`, not `inline-grid`: this is a flex item now, and CSS
          // blockifies a flex item's display, so `inline-grid` would silently
          // compute to `grid` anyway. Declaring what it computes to keeps the
          // source honest. Natural width is preserved by `flexShrink: 0` below.
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, ${m.w}px)`,
          gridTemplateRows: `repeat(${rows}, ${m.h}px)`,
          gap: m.gap,
          background: 'var(--grid-bg)',
          borderRadius: m.radius(16),
          padding: m.pad,
          // Never shrink below the natural grid width — that is what gives the
          // container something to scroll instead of squashing the cells.
          flexShrink: 0,
          transition: 'background 0.15s ease',
          // Board background/padding is empty space: pannable, like empty cells.
          touchAction: 'pan-x pan-y',
        }}>
        {cells}
      </div>
    </div>
  )
}

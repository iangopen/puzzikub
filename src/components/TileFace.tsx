import type { Tile } from '../types'
import { NUM_COLOR } from '../types'
import type { TileStyle } from '../lib/themes'
import { tileMetrics } from '../lib/boardScale'

interface Props {
  tile: Tile
  tileStyle: TileStyle
  invalid?: boolean
  lockIn?: boolean
  dimmed?: boolean
  hovered?: boolean
  /**
   * Board-scale factor. Defaults to 1, so every existing call site renders at
   * exactly the original 46x58. Sizes are REAL pixel dimensions, never a
   * `transform: scale()` — see src/lib/boardScale.ts for why that matters.
   */
  scale?: number
}

// RGB components matching NUM_COLOR hex values
const COLOR_RGB: Record<Tile['c'], [number, number, number]> = {
  r: [163, 45,  45],
  b: [24,  95,  165],
  a: [186, 117, 23],
  k: [34,  34,  34],
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r},${g},${b},${a})`
}

const CERAMIC: Record<Tile['c'], { light: string; mid: string; text: string }> = {
  r: { light: '#f7d9d8', mid: '#eab5b4', text: '#791F1F' },
  b: { light: '#d4e6f7', mid: '#a8cbed', text: '#0C447C' },
  a: { light: '#faecd4', mid: '#f0d29a', text: '#633806' },
  k: { light: '#e3e3e3', mid: '#c4c4c4', text: '#2C2C2A' },
}

const NEON_COLOR: Record<Tile['c'], string> = {
  r: '#ff3b5c',
  b: '#3bb8ff',
  a: '#ffb23b',
  k: '#b8b8c8',
}

// neon color mixed with white at ~40%
const NEON_TEXT: Record<Tile['c'], string> = {
  r: '#ff899d',
  b: '#89d4ff',
  a: '#ffd089',
  k: '#d4d4de',
}

const PAPER_TEXT: Record<Tile['c'], string> = {
  r: '#9c3b3b',
  b: '#2e5577',
  a: '#8a6a2e',
  k: '#3a3a35',
}

export function TileFace({ tile, tileStyle, invalid = false, lockIn = false, dimmed = false, hovered = false, scale = 1 }: Props) {
  const [rr, gg, bb] = COLOR_RGB[tile.c]
  const m = tileMetrics(scale)

  const dimStyle: React.CSSProperties = dimmed ? { opacity: 0.35, transform: 'scale(0.93)' } : {}

  const hoverOutline: React.CSSProperties = hovered
    ? { outline: '2px solid #378ADD', outlineOffset: -2 }
    : {}

  // animation class — tile-land only when neither invalid nor lockIn nor dimmed
  const landAnim = !invalid && !lockIn && !dimmed ? 'tile-land 0.2s ease' : undefined

  const animClass = invalid ? 'tile-invalid'
    : lockIn
      ? (tileStyle === 'ceramic' ? 'tile-lockin-ceramic' : 'tile-lockin')
      : ''

  // ── PLAIN ──────────────────────────────────────────────────────────────────
  if (tileStyle === 'plain') {
    return (
      <div
        className={animClass}
        style={{
          width: m.w, height: m.h, borderRadius: m.radius(8),
          background: invalid ? 'var(--invalid-bg)' : 'var(--tile-bg)',
          boxShadow: lockIn ? undefined
            : invalid ? '0 0 0 1.5px var(--invalid-ring)'
            : 'var(--tile-shadow)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: m.font, fontWeight: 500,
          color: NUM_COLOR[tile.c],
          userSelect: 'none',
          transition: 'background 0.15s ease, opacity 0.1s ease',
          animation: landAnim,
          boxSizing: 'border-box',
          ...hoverOutline, ...dimStyle,
        }}
      >
        <span style={{ pointerEvents: 'none', userSelect: 'none' }}>{tile.n}</span>
      </div>
    )
  }

  // ── GLASS ──────────────────────────────────────────────────────────────────
  if (tileStyle === 'glass') {
    const bg = invalid
      ? `linear-gradient(160deg, ${rgba(200, 50, 50, 0.55)}, ${rgba(200, 50, 50, 0.28)})`
      : `linear-gradient(160deg, ${rgba(rr, gg, bb, 0.35)}, ${rgba(rr, gg, bb, 0.12)})`
    const border = invalid
      ? `1px solid ${rgba(200, 50, 50, 0.7)}`
      : `1px solid ${rgba(rr, gg, bb, 0.5)}`
    const shadow = invalid
      ? `0 4px 12px ${rgba(200, 50, 50, 0.4)}`
      : `0 4px 12px ${rgba(rr, gg, bb, 0.25)}`
    return (
      <div
        className={animClass}
        style={{
          width: m.w, height: m.h, borderRadius: m.radius(8),
          background: bg, border,
          boxShadow: lockIn ? undefined : shadow,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: m.font, fontWeight: 500, color: '#ffffff',
          userSelect: 'none', animation: landAnim, boxSizing: 'border-box',
          ...hoverOutline, ...dimStyle,
        }}
      >
        <span style={{ pointerEvents: 'none', userSelect: 'none' }}>{tile.n}</span>
      </div>
    )
  }

  // ── CERAMIC ────────────────────────────────────────────────────────────────
  if (tileStyle === 'ceramic') {
    const cd = CERAMIC[tile.c]
    const baseShadow = '0 3px 0 rgba(0,0,0,0.25), 0 4px 6px rgba(0,0,0,0.3)'
    const shadow = lockIn ? undefined
      : invalid ? `${baseShadow}, 0 0 0 1.5px rgba(180,40,40,0.6)`
      : baseShadow
    return (
      <div
        className={animClass}
        style={{
          width: m.w, height: m.h, borderRadius: m.radius(6),
          background: `linear-gradient(180deg, ${cd.light}, ${cd.mid})`,
          border: '1px solid rgba(0,0,0,0.08)',
          boxShadow: shadow,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: m.font, fontWeight: 500, color: cd.text,
          userSelect: 'none', animation: landAnim, boxSizing: 'border-box',
          ...hoverOutline, ...dimStyle,
        }}
      >
        <span style={{ pointerEvents: 'none', userSelect: 'none' }}>{tile.n}</span>
      </div>
    )
  }

  // ── NEON-OUTLINE ───────────────────────────────────────────────────────────
  if (tileStyle === 'neon-outline') {
    const nc = invalid ? '#ff3b5c' : NEON_COLOR[tile.c]
    const shadow = `0 0 8px ${nc}99, inset 0 0 4px ${nc}4d`
    const textColor = invalid ? '#ff899d' : NEON_TEXT[tile.c]
    return (
      <div
        className={animClass}
        style={{
          width: m.w, height: m.h, borderRadius: m.radius(6),
          background: '#0d0d14',
          border: `1px solid ${nc}`,
          boxShadow: lockIn ? undefined : shadow,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: m.font, fontWeight: 500, color: textColor,
          textShadow: `0 0 6px ${nc}cc`,
          userSelect: 'none', animation: landAnim, boxSizing: 'border-box',
          ...hoverOutline, ...dimStyle,
        }}
      >
        <span style={{ pointerEvents: 'none', userSelect: 'none' }}>{tile.n}</span>
      </div>
    )
  }

  // ── PAPER (default) ────────────────────────────────────────────────────────
  const paperBorder = invalid ? '1px solid rgba(160,60,60,0.5)' : '1px solid rgba(0,0,0,0.06)'
  const paperShadow = invalid
    ? '0 1px 2px rgba(0,0,0,0.15), 0 0 0 1.5px rgba(160,60,60,0.4)'
    : '0 1px 2px rgba(0,0,0,0.15)'
  return (
    <div
      className={animClass}
      style={{
        width: m.w, height: m.h, borderRadius: m.radius(2),
        background: '#fdfaf2',
        border: paperBorder,
        boxShadow: lockIn ? undefined : paperShadow,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: m.font, fontWeight: 500,
        fontFamily: 'Georgia, serif',
        color: PAPER_TEXT[tile.c],
        userSelect: 'none', animation: landAnim, boxSizing: 'border-box',
        ...hoverOutline, ...dimStyle,
      }}
    >
      <span style={{ pointerEvents: 'none', userSelect: 'none' }}>{tile.n}</span>
    </div>
  )
}

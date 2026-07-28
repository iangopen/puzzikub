/**
 * Board scale — the persisted "how big are the tiles" preference.
 *
 * MOBILE GROUNDWORK. Boards run 6-12 columns wide, which at 100% is
 * 338px-650px (`cols*46 + (cols-1)*6 + 32`), against roughly 350px of usable
 * width on a typical phone. Scaling down is what lets a board FIT; the
 * scrollable container in `Board.tsx` is what handles the cases that still
 * don't. Neither is a substitute for the other.
 *
 * ***SCALE IS APPLIED BY RESIZING REAL PIXEL DIMENSIONS, NEVER BY
 * `transform: scale()`.*** This is load-bearing, for two independent reasons:
 *
 * 1. A transform does not change LAYOUT size. The scroll container would keep
 *    reserving the full unscaled width, so scrolling extent and centring would
 *    both be computed against a box that no longer matches what is on screen —
 *    i.e. scaling down would not actually make the board fit, which is the
 *    entire point.
 * 2. `DragPreview` is `position: fixed` and positioned from `e.clientX/clientY`,
 *    so it lives OUTSIDE any board transform. Under a transform its tile would
 *    render at unscaled size while the board under it was scaled.
 *
 * Resizing real dimensions keeps layout, hit-testing and the drag preview in
 * one coordinate system, so the existing mouse drag math needs no changes at
 * all. Do not "simplify" this to a transform.
 *
 * Pure module: no React imports, per the architecture rule.
 */

export const BASE_TILE_W = 46
export const BASE_TILE_H = 58
export const BASE_GAP = 6
export const BASE_PAD = 16
export const BASE_FONT = 20

/** Presets, not a free slider — every other control in SettingsPanel is a pill group. */
export const BOARD_SCALES = [0.5, 0.75, 1, 1.25] as const
export type BoardScale = (typeof BOARD_SCALES)[number]

/** 100% — desktop players see no change unless they deliberately pick another. */
export const DEFAULT_BOARD_SCALE: BoardScale = 1

export const BOARD_SCALE_KEY = 'puzzikub_board_scale'

export function isBoardScale(v: unknown): v is BoardScale {
  return typeof v === 'number' && (BOARD_SCALES as readonly number[]).includes(v)
}

/** Parse a persisted value; anything unrecognised falls back to the default. */
export function parseBoardScale(raw: string | null): BoardScale {
  if (raw === null) return DEFAULT_BOARD_SCALE
  const n = Number(raw)
  return isBoardScale(n) ? n : DEFAULT_BOARD_SCALE
}

export function formatBoardScale(s: number): string {
  return `${Math.round(s * 100)}%`
}

export interface TileMetrics {
  w: number
  h: number
  gap: number
  pad: number
  font: number
  /** Scale a per-style corner radius (they differ: 8 / 8 / 6 / 6 / 2). */
  radius: (base: number) => number
}

/** All derived sizes in one place, rounded to whole pixels so tiles stay crisp. */
export function tileMetrics(scale: number): TileMetrics {
  return {
    w: Math.round(BASE_TILE_W * scale),
    h: Math.round(BASE_TILE_H * scale),
    gap: Math.max(2, Math.round(BASE_GAP * scale)),
    pad: Math.max(6, Math.round(BASE_PAD * scale)),
    font: Math.max(9, Math.round(BASE_FONT * scale)),
    radius: (base: number) => Math.max(1, Math.round(base * scale)),
  }
}

/** Total rendered width of a board, including gaps and container padding. */
export function boardWidth(cols: number, scale: number): number {
  const m = tileMetrics(scale)
  return cols * m.w + (cols - 1) * m.gap + m.pad * 2
}

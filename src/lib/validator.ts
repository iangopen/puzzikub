import type { Tile, Grid } from '../types'

export function isValidRun(tiles: Tile[]): boolean {
  if (tiles.length < 3) return false
  const color = tiles[0].c
  if (!tiles.every(t => t.c === color)) return false
  const sorted = [...tiles].sort((a, b) => a.n - b.n)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].n !== sorted[i - 1].n + 1) return false
  }
  return true
}

export function isValidGroup(tiles: Tile[]): boolean {
  if (tiles.length < 3 || tiles.length > 4) return false
  const num = tiles[0].n
  if (!tiles.every(t => t.n === num)) return false
  const colors = tiles.map(t => t.c)
  return new Set(colors).size === colors.length
}

// ── Shared scanning logic ─────────────────────────────────────────────────────

type GroupCell = { r: number; c: number }
type Group = { tiles: Tile[]; cells: GroupCell[] }
type GroupMaps = {
  hGroups: Group[]
  vGroups: Group[]
  hOf: (Group | null)[][]
  vOf: (Group | null)[][]
}

function buildGroups(grid: Grid): GroupMaps {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0

  const hGroups: Group[] = []
  const hOf: (Group | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null))

  for (let r = 0; r < rows; r++) {
    let c = 0
    while (c < cols) {
      if (!grid[r][c]) { c++; continue }
      let end = c
      while (end + 1 < cols && grid[r][end + 1]) end++
      const tiles: Tile[] = []
      const cells: GroupCell[] = []
      for (let i = c; i <= end; i++) { tiles.push(grid[r][i] as Tile); cells.push({ r, c: i }) }
      const g: Group = { tiles, cells }
      hGroups.push(g)
      for (let i = c; i <= end; i++) hOf[r][i] = g
      c = end + 1
    }
  }

  const vGroups: Group[] = []
  const vOf: (Group | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null))

  for (let c = 0; c < cols; c++) {
    let r = 0
    while (r < rows) {
      if (!grid[r][c]) { r++; continue }
      let end = r
      while (end + 1 < rows && grid[end + 1][c]) end++
      const tiles: Tile[] = []
      const cells: GroupCell[] = []
      for (let i = r; i <= end; i++) { tiles.push(grid[i][c] as Tile); cells.push({ r: i, c }) }
      const g: Group = { tiles, cells }
      vGroups.push(g)
      for (let i = r; i <= end; i++) vOf[i][c] = g
      r = end + 1
    }
  }

  return { hGroups, vGroups, hOf, vOf }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * A run AS LAID ON THE BOARD: one colour, values ascending by exactly one, left
 * to right ("3 4 5"; never "5 3 4" or "5 4 3"). The Tutorial says runs are in
 * "consecutive order" (src/components/Tutorial.tsx:11) and every example is
 * ascending; the direction is the Rummikub convention. `isValidRun` stays
 * order-free on purpose: the solver and builders reason about BAGS, which have
 * no order. Only the grid check below reads order. Pinned by runOrder.verify.ts.
 */
export function isOrderedRun(tiles: Tile[]): boolean {
  if (tiles.length < 3) return false
  for (let i = 1; i < tiles.length; i++) {
    if (tiles[i].c !== tiles[0].c || tiles[i].n !== tiles[i - 1].n + 1) return false
  }
  return true
}

function isCovered(hGroup: Group | null): boolean {
  return !!(hGroup && hGroup.cells.length >= 3 && (isOrderedRun(hGroup.tiles) || isValidGroup(hGroup.tiles)))
}

export function validateGrid(grid: Grid): boolean {
  if (!grid.some(row => row.some(t => t !== null))) return false

  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  const { hOf } = buildGroups(grid)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!grid[r][c]) continue
      if (!isCovered(hOf[r][c])) return false
    }
  }

  return true
}

export function getInvalidCells(grid: Grid): Set<string> {
  const invalid = new Set<string>()
  if (!grid.some(row => row.some(t => t !== null))) return invalid

  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  const { hOf } = buildGroups(grid)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!grid[r][c]) continue
      if (!isCovered(hOf[r][c])) invalid.add(`${r},${c}`)
    }
  }

  return invalid
}

export function getNewlyValidCells(prevGrid: Grid, newGrid: Grid): Set<string> {
  const result = new Set<string>()
  if (!prevGrid.length || !newGrid.length) return result

  const prevMaps = buildGroups(prevGrid)
  const newMaps = buildGroups(newGrid)

  const rows = newGrid.length
  const cols = newGrid[0]?.length ?? 0

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!newGrid[r][c]) continue
      const wasCovered = prevGrid[r]?.[c]
        ? isCovered(prevMaps.hOf[r]?.[c] ?? null)
        : false
      const nowCovered = isCovered(newMaps.hOf[r][c])
      if (nowCovered && !wasCovered) result.add(`${r},${c}`)
    }
  }

  return result
}

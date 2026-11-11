import type { Puzzle, Tile, Grid } from '../types'
import { makeTile, TILE_COPIES } from '../types'

const STORAGE_KEY = 'puzzikub_library'

const EMPTY_GRID = () => Array.from({ length: 6 }, () => Array(10).fill(null))

const SEED_PUZZLES: Puzzle[] = [
  {
    id: 'seed1',
    name: 'First steps',
    diff: 'easy',
    grid: EMPTY_GRID(),
    rack: [makeTile(6, 'r'), makeTile(9, 'k'), makeTile(4, 'r'), makeTile(5, 'r'), makeTile(9, 'b'), makeTile(9, 'r')],
    optimalMoves: 6,
    generated: false,
  },
  {
    id: 'seed2',
    name: 'Two fronts',
    diff: 'medium',
    grid: EMPTY_GRID(),
    rack: [makeTile(6, 'b'), makeTile(11, 'k'), makeTile(5, 'b'), makeTile(7, 'b'), makeTile(11, 'r'), makeTile(11, 'a')],
    optimalMoves: 6,
    generated: false,
  },
  {
    id: 'seed3',
    name: 'Triple threat',
    diff: 'hard',
    grid: EMPTY_GRID(),
    rack: [makeTile(4, 'r'), makeTile(10, 'k'), makeTile(8, 'k'), makeTile(3, 'r'), makeTile(5, 'r'), makeTile(10, 'b'), makeTile(10, 'a'), makeTile(7, 'k'), makeTile(9, 'k')],
    optimalMoves: 9,
    generated: false,
  },
]

// ---------------------------------------------------------------------------
// LEGACY MIGRATION (m=2 migration Step 8).
//
// THE TRAP: every puzzle already in a real user's `puzzikub_library` was saved
// BEFORE `Tile.id` existed. Its tiles are bare `{ n, c }` — `JSON.parse` hands
// them back with `id === undefined`, which then fails every downstream lookup
// that keys on id (goal maps, drag identity, par computation, React keys).
//
// The fix is a pure function, which is exactly what Step 1's STRUCTURED id
// scheme bought: id = `${n}_${c}_${copyIndex}`, and copyIndex is the tile's
// occurrence position among tiles of the same (n, c) within ITS OWN puzzle,
// scanned grid row-major then rack. Same blob in, same ids out, every time —
// no remap table, no counter, no dependence on load order.
//
// THREE RULES, each chosen because the alternative loses user data:
//
//  1. A tile that ALREADY has a valid id is left completely alone. A puzzle
//     saved after this migration must round-trip byte-identical; re-minting
//     would renumber copies and silently change which tile is which.
//  2. Nothing is ever dropped. A legacy puzzle holding MORE than TILE_COPIES
//     of one (n, c) — possible, since the old editor had no cap — still gets
//     every tile a unique id (copy index 2, 3, ...). Over-cap data is the
//     user's; refusing to load it, or quietly deleting the extras, would be
//     worse than carrying it. `countOverCap` reports it for diagnostics.
//  3. Mixed blobs are handled. If some tiles have ids and some do not, minting
//     skips copy indices already claimed inside that puzzle, so a migrated tile
//     can never collide with a surviving one.
//
// The migrated library is deliberately NOT written back on load. Migration is
// deterministic and idempotent, so re-running it costs nothing, and leaving the
// original blob untouched means a bug here cannot destroy the saved library —
// the user's real data survives until they save through the normal path.
// ---------------------------------------------------------------------------

/** A tile as it may arrive from `JSON.parse` — pre-migration blobs have no `id`. */
type StoredTile = { n: unknown; c: unknown; id?: unknown }

const COLORS: ReadonlyArray<Tile['c']> = ['r', 'b', 'a', 'k']

function isStoredTile(t: unknown): t is StoredTile {
  if (t === null || typeof t !== 'object') return false
  const o = t as StoredTile
  return typeof o.n === 'number' && typeof o.c === 'string' && COLORS.includes(o.c as Tile['c'])
}

const hasId = (t: StoredTile): boolean => typeof t.id === 'string' && t.id.length > 0

export interface MigrationStats {
  /** Puzzles that contained at least one id-less tile and were migrated. */
  puzzlesMigrated: number
  /** Individual tiles that had an id minted for them. */
  tilesMinted: number
  /** Tiles kept exactly as-is because they already carried an id. */
  tilesKept: number
  /** Tiles needing a copy index >= TILE_COPIES (legacy over-cap data, preserved). */
  countOverCap: number
  /** Entries skipped because they were not a recognisable puzzle at all. */
  puzzlesSkipped: number
}

const emptyStats = (): MigrationStats => ({
  puzzlesMigrated: 0, tilesMinted: 0, tilesKept: 0, countOverCap: 0, puzzlesSkipped: 0,
})

/**
 * Mint an id for one legacy tile, or return the tile unchanged if it has one.
 * `used` holds every id already claimed within this puzzle, so minting cannot
 * collide with a tile that survived from a partially-migrated blob.
 */
function resolveTile(raw: StoredTile, used: Set<string>, stats: MigrationStats): Tile {
  const n = raw.n as number
  const c = raw.c as Tile['c']
  if (hasId(raw)) {
    stats.tilesKept++
    used.add(raw.id as string)
    return { n, c, id: raw.id as string }
  }
  let copy = 0
  while (used.has(makeTile(n, c, copy).id)) copy++
  if (copy >= TILE_COPIES) stats.countOverCap++
  const tile = makeTile(n, c, copy)
  used.add(tile.id)
  stats.tilesMinted++
  return tile
}

/** Migrate one stored puzzle. Returns null only if the entry is not a puzzle. */
function migratePuzzle(raw: unknown, stats: MigrationStats): Puzzle | null {
  if (raw === null || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  if (!Array.isArray(p.grid) || !Array.isArray(p.rack)) return null

  const used = new Set<string>()
  const before = stats.tilesMinted

  // Grid first, row-major, then rack — a fixed scan order is what makes the
  // occurrence index (and therefore every minted id) deterministic.
  const grid: Grid = []
  for (const row of p.grid) {
    if (!Array.isArray(row)) return null
    const out: (Tile | null)[] = []
    for (const cell of row) {
      if (cell === null || cell === undefined) { out.push(null); continue }
      if (!isStoredTile(cell)) return null
      out.push(resolveTile(cell, used, stats))
    }
    grid.push(out)
  }

  const rack: Tile[] = []
  for (const t of p.rack) {
    if (!isStoredTile(t)) return null
    rack.push(resolveTile(t, used, stats))
  }

  const mintedHere = stats.tilesMinted - before
  if (mintedHere > 0) stats.puzzlesMigrated++

  // Everything except the tiles is carried across untouched.
  return { ...(raw as Puzzle), grid, rack }
}

/** Migrate a parsed library blob. Exported so the harness can test it directly. */
export function migrateLibrary(raw: unknown): { puzzles: Puzzle[]; stats: MigrationStats } {
  const stats = emptyStats()
  if (!Array.isArray(raw)) return { puzzles: [], stats }
  const puzzles: Puzzle[] = []
  for (const entry of raw) {
    const p = migratePuzzle(entry, stats)
    // A single unreadable entry must not cost the user the rest of the library.
    if (p) puzzles.push(p)
    else stats.puzzlesSkipped++
  }
  return { puzzles, stats }
}

export function loadLibrary(): Puzzle[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return seedLibrary()
    const { puzzles } = migrateLibrary(JSON.parse(raw))
    // Only fall back to seeds when the blob yielded nothing usable at all —
    // never because one puzzle failed to parse.
    if (puzzles.length === 0) return seedLibrary()
    return puzzles
  } catch {
    return seedLibrary()
  }
}

export function saveLibrary(puzzles: Puzzle[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(puzzles))
}

function seedLibrary(): Puzzle[] {
  saveLibrary(SEED_PUZZLES)
  return SEED_PUZZLES
}

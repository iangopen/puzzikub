import { type Tile, type Grid, type Difficulty, makeTile } from '../types'
// m=2 migration Step 7: every builder-side partition oracle call is solveBagM2.
// The m=1 `solveBag` is NOT deleted — it is still the independent oracle the
// verification harnesses check these builds against (verifyEngine, decoy,
// redherring, composed). Keeping the builders and the verifiers on DIFFERENT
// solvers is the point: an m=1-shaped bag is a strict subset of what solveBagM2
// handles, so the two must agree on every puzzle this file emits, and the
// harnesses would catch it if they ever didn't.
import { solveBagM2 } from './solver'
import { isValidRun, isValidGroup, validateGrid } from './validator'
import { type WindowSpec, type Drop, bindMinCostGoal } from './mixedGoalPlanner'
import { partitionCount } from './difficultyProxy'

/** The two directions of the same Latin-rectangle duality. */
export type ArchetypeType = 'groups-to-runs' | 'runs-to-groups'

const ALL_COLORS: Tile['c'][] = ['r', 'b', 'a', 'k']

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function combinations<T>(arr: T[], size: number): T[][] {
  if (size === 0) return [[]]
  if (size > arr.length) return []
  if (size === arr.length) return [arr]
  const [first, ...rest] = arr
  return [
    ...combinations(rest, size - 1).map(c => [first, ...c]),
    ...combinations(rest, size),
  ]
}

export interface ArchetypeResult {
  grid: Grid
  rack: Tile[]
  allTiles: Tile[]
  /** Length of the reference solution the builder knows: an upper bound on optimal. */
  minMoves: number
}

// ---------------------------------------------------------------------------
// Invariant (c): the rack must not be a puzzle on its own.
// ---------------------------------------------------------------------------

/** True if the rack, or any 3+ subset of it, is already a valid run or group. */
export function formsValidSetAlone(tiles: Tile[]): boolean {
  for (let size = 3; size <= tiles.length; size++) {
    for (const combo of combinations(tiles, size)) {
      if (isValidRun(combo) || isValidGroup(combo)) return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Invariant (d): no way to empty the rack into free cells without relocating a
// board tile. This is the gate that decides whether a puzzle is fill-in-the-
// blank, so it is searched exhaustively rather than guessed at.
//
// Coverage is HORIZONTAL-ONLY (see validator.ts): a tile is valid iff its
// maximal contiguous run of occupied cells *within its own row* is a valid run
// or group. Two consequences drive everything below:
//
//   - Rows are independent. Placing a tile at (r,c) can only change the
//     coverage of tiles in row r. Nothing above or below is affected.
//   - A tile's only hope of being covered is its own row, so a row that cannot
//     ever cover it — even given every unplaced tile — is a dead end.
//
// Completeness of the frontier-restricted search: given (c), a rack tile's
// covering segment in a winning grid can never be all-rack (that segment would
// be a valid run/group made of rack tiles alone). So every placed rack tile
// shares a row-segment with a board tile. Ordering the placements by horizontal
// distance from the nearest board tile in that segment always yields an order in
// which each tile lands adjacent to an already-occupied cell. The frontier below
// is the orthogonal neighbourhood, a superset of that horizontal one, so nothing
// is missed.
// ---------------------------------------------------------------------------

const NODE_BUDGET = 200_000

type Line = (Tile | null)[]

function row(grid: Grid, r: number): Line { return grid[r] }

/**
 * Could the tile at `idx` ever sit in a valid segment along this row, given we
 * may still place any of `remaining` into the row's empty cells?
 *
 * A final segment is a window [lo..hi] whose every empty cell gets filled and
 * whose two outside neighbours stay empty (or are walls). Over-approximates —
 * it lets the same spare tile serve several windows — which only ever makes the
 * prune weaker, never wrong.
 */
function lineCanCover(line: Line, idx: number, remaining: Tile[]): boolean {
  const n = line.length
  const spare = remaining.length

  for (let lo = idx; lo >= 0; lo--) {
    if (lo > 0 && line[lo - 1] !== null) continue // window would swallow that tile
    for (let hi = idx; hi < n; hi++) {
      if (hi < n - 1 && line[hi + 1] !== null) continue
      const len = hi - lo + 1
      if (len < 3 || len > 13) continue

      const fixed: Tile[] = []
      let holes = 0
      for (let i = lo; i <= hi; i++) {
        const t = line[i]
        if (t) fixed.push(t)
        else holes++
      }
      if (holes > spare) continue
      if (holes === 0) {
        if (isValidRun(fixed) || isValidGroup(fixed)) return true
        continue
      }
      for (const fill of combinations(remaining, holes)) {
        const merged = [...fixed, ...fill]
        if (isValidRun(merged) || isValidGroup(merged)) return true
      }
    }
  }
  return false
}

/** Horizontal-only: a column can no longer cover anything. */
function canEverBeCovered(grid: Grid, r: number, c: number, remaining: Tile[]): boolean {
  return lineCanCover(row(grid, r), c, remaining)
}

/** The maximal contiguous occupied cells through (r,c) in its row. */
function segmentCells(grid: Grid, r: number, c: number): [number, number][] {
  const cols = grid[0].length
  const out: [number, number][] = []

  let lo = c
  while (lo > 0 && grid[r][lo - 1]) lo--
  let hi = c
  while (hi < cols - 1 && grid[r][hi + 1]) hi++
  for (let i = lo; i <= hi; i++) out.push([r, i])

  return out
}

function frontier(grid: Grid): [number, number][] {
  const rows = grid.length
  const cols = grid[0].length
  const out: [number, number][] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c]) continue
      const touches =
        (r > 0 && grid[r - 1][c]) || (r < rows - 1 && grid[r + 1][c]) ||
        (c > 0 && grid[r][c - 1]) || (c < cols - 1 && grid[r][c + 1])
      if (touches) out.push([r, c])
    }
  }
  return out
}

export interface RelocationSearch {
  /** A no-relocation win exists: the rack can be dumped into free cells and the grid is valid. */
  win: boolean
  /** Search hit the node budget, so `win: false` is not proven. Callers must treat this as unsafe. */
  exhausted: boolean
  /** Cells the rack tiles landed on, in rack order, when `win`. */
  placement?: [number, number][]
}

export function existsNoRelocationWin(board: Grid, rack: Tile[]): RelocationSearch {
  const grid = board.map(rw => [...rw])
  const seen = new Set<string>()
  const placed: [number, number][] = []
  let nodes = 0
  let exhausted = false

  const search = (remaining: Tile[]): boolean => {
    if (++nodes > NODE_BUDGET) { exhausted = true; return false }
    if (remaining.length === 0) return validateGrid(grid)

    for (const [r, c] of frontier(grid)) {
      for (let i = 0; i < remaining.length; i++) {
        const tile = remaining[i]
        const rest = [...remaining.slice(0, i), ...remaining.slice(i + 1)]

        grid[r][c] = tile
        const key = `${r},${c},${tile.n}${tile.c}|${rest.map(t => `${t.n}${t.c}`).sort().join(',')}`
        if (!seen.has(key)) {
          seen.add(key)
          // The placed tile, and every tile whose row-segment it just joined,
          // must still have some route to being covered.
          let alive = canEverBeCovered(grid, r, c, rest)
          if (alive) {
            for (const [tr, tc] of segmentCells(grid, r, c)) {
              if (!canEverBeCovered(grid, tr, tc, rest)) { alive = false; break }
            }
          }
          if (alive) {
            placed.push([r, c])
            if (search(rest)) return true
            placed.pop()
          }
        }
        grid[r][c] = null
        if (exhausted) return false
      }
    }
    return false
  }

  const win = search(rack)
  return win
    ? { win: true, exhausted: false, placement: [...placed] }
    : { win: false, exhausted }
}

/**
 * Invariant (d), stated literally: send every rack tile to an "obvious" home —
 * an open run endpoint of matching colour and adjacent value, or a group of 3
 * missing exactly this tile — and see whether that wins. Horizontal only, since
 * a vertical arrangement is no longer a set. Strictly weaker than
 * existsNoRelocationWin; kept because it is the property the spec names, and it
 * names the failure when one occurs.
 */
export function obviousSpots(grid: Grid, tile: Tile): [number, number][] {
  const rows = grid.length
  const cols = grid[0].length
  const spots: [number, number][] = []

  const consider = (r: number, c: number) => {
    if (r < 0 || r >= rows || c < 0 || c >= cols || grid[r][c]) return
    const line = row(grid, r)
    let lo = c - 1
    while (lo >= 0 && line[lo]) lo--
    let hi = c + 1
    while (hi < line.length && line[hi]) hi++
    const seg = line.slice(lo + 1, hi).filter((t): t is Tile => t !== null)
    if (seg.length < 2) return
    if (isValidRun(seg) && isValidRun([...seg, tile])) { spots.push([r, c]); return }
    if (seg.length === 3 && isValidGroup(seg) && isValidGroup([...seg, tile])) { spots.push([r, c]); return }
  }

  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c]) { consider(r, c - 1); consider(r, c + 1) }

  return spots
}

export function obviousPlacementWins(board: Grid, rack: Tile[]): boolean {
  const grid = board.map(rw => [...rw])
  const rec = (i: number): boolean => {
    if (i === rack.length) return validateGrid(grid)
    for (const [r, c] of obviousSpots(grid, rack[i])) {
      if (grid[r][c]) continue
      grid[r][c] = rack[i]
      if (rec(i + 1)) return true
      grid[r][c] = null
    }
    return false
  }
  return rec(0)
}

/**
 * A puzzle is trivial if the rack solves itself (failure mode 2) or if it can be
 * emptied into free cells without moving a board tile (failure mode 1). A search
 * that ran out of budget counts as trivial: we never ship what we cannot prove.
 */
export function isTrivial(board: Grid, rack: Tile[]): boolean {
  if (formsValidSetAlone(rack)) return true
  const search = existsNoRelocationWin(board, rack)
  return search.win || search.exhausted
}

// ---------------------------------------------------------------------------
// Construction: "groups to runs", horizontal-only edition.
//
// The board shows the dual block D(4, L) — four colours over L consecutive
// values — laid out as its L GROUPS. Under the horizontal-only rule a group has
// to BE a horizontal strip, so each value gets its own row: four tiles of the
// same value in four different colours, side by side. That is what the player
// sees at move zero, and validateGrid accepts every one of them.
//
// WHY THE RACK IS HOMELESS — the replacement for the old spacing/derangement
// argument, which reasoned about vertical column adjacency and does not survive
// the transpose. Two structural facts do all the work now:
//
//   1. ONE MAXIMAL SEGMENT PER ROW. Each board row holds exactly one contiguous
//      strip and nothing else, so there is no interior gap between two board
//      tiles in a row. The old failure — a rack tile bridging two flanking board
//      tiles into a run — cannot even be expressed here. (Rows are separated
//      vertically only for looks; vertical adjacency has no meaning any more.)
//
//   2. EVERY STRIP IS A *FULL* FOUR-COLOUR GROUP. isValidGroup caps at 4, so the
//      strip cannot grow into a bigger group; and it holds four distinct colours,
//      so it can never be part of a run. Appending ANY tile to either end of any
//      board row therefore makes that row's segment invalid — whatever the tile
//      is. This is stronger than the old guarantee, which depended on the rack's
//      values; this one holds for every conceivable rack.
//
// So the only segment a rack tile can be covered by is one built entirely out of
// rack tiles — and invariant (c) forbids exactly that. Hence (d) follows from
// (c) on these boards. That implication is asserted, not assumed: the builder
// still runs the full exhaustive existsNoRelocationWin gate below, and
// verifyEngine.ts cross-checks the gate against a planted win and an unpruned
// brute force.
//
// The rack holds the block's run extensions: tiles at value s-1 and s+L, at most
// one per colour and at most two per value — so the rack contains no run (needs
// three consecutive values in one colour; it has two non-adjacent values) and no
// group (needs three colours at one value; it has at most two).
//
// The only way out is to see the block the other way round: break the L groups
// apart and rebuild the same tiles as 4 runs, one colour per row, which the rack
// tiles then extend. Same tiles, two structures — Latin-rectangle duality, used
// as the trap rather than as the scaffold.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// minMoves — the length of the reference solution under the REAL move model.
//
// usePlayState's DROP reducer, GRID→GRID branch:
//     grid[src.row][src.col] = grid[row][col]
//     grid[row][col]         = tile
// Dropping a grid tile on an OCCUPIED cell SWAPS the two, in one move (and
// Board.tsx fires onCellEnter on occupied cells, so the player can reach it).
// A move therefore relocates one tile (target empty) or two (target occupied).
//
// Fix a goal layout: an injective map tile → cell. Draw one edge per misplaced
// board tile, from the cell it sits on to the cell it belongs on. Goal cells are
// distinct, so every cell has in-degree ≤ 1; a cell holds one tile, so
// out-degree ≤ 1. The misplaced subgraph is therefore a disjoint union of simple
// paths and simple cycles, and:
//
//   - A path of k tiles ends at an empty cell (a cell with an outgoing edge
//     holds a tile; the last one does not). Walk it backwards — tail tile into
//     the empty cell, then each tile into the cell just vacated. k moves.
//   - A cycle of k tiles never touches an empty cell. Swap c1's tile with the
//     occupant of its goal: c1's tile is now home, and the displaced tile sits
//     at c1. Repeat. After k−1 swaps the last tile has landed on c1, its own
//     goal. k−1 moves — one fewer than the k the tiles would cost apart.
//   - Rack tiles have no cell, so they have out-degree 1 and in-degree 0: each
//     heads a path and can never lie on a cycle. One move each.
//
//   cost(goal) = boardTiles + rack − fixed(goal) − cycles(goal)
//
// So minimising cost means maximising fixed + cycles, and a cycle decomposition
// gets both in one O(tiles) pass. The goal family is "one colour's run per row";
// its free parameters are which colour owns which row (a permutation of the ≤ 4
// colours) plus where the block sits, so the whole minimisation is a few hundred
// linear passes. Measured at 0.02 ms on a real extreme puzzle.
//
// This is exact for that family, which is what `optimalMoves` has always meant
// here: the length of the solution the builder can prove, an upper bound on the
// true optimum over every conceivable winning layout.
// ---------------------------------------------------------------------------

// m=2 migration Step 5: identity is the tile's STABLE id, not its (value,colour)
// label — `{n,c}` alone cannot tell the two copies of a duplicate apart. Matches
// mixedGoalPlanner's `tileKey`, which every hybrid goal map is read through.
const tileKey = (t: Tile): string => t.id

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs]
  const out: T[][] = []
  for (let i = 0; i < xs.length; i++) {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)]
    for (const p of permutations(rest)) out.push([xs[i], ...p])
  }
  return out
}

export interface GoalPlan {
  /** Reference-solution length: exactly the moves `goal` costs to reach. */
  moves: number
  /** tile id → [row, col] it occupies in the goal layout. Covers board + rack. */
  goal: Map<string, [number, number]>
}

/**
 * The cost core, shared by every goal shape. Write each board tile's goal cell
 * into `goals`, call `cost()`, repeat — nothing is reallocated per candidate,
 * which is what keeps a few hundred thousand candidate layouts affordable.
 *
 * `goals` must stay injective and in-bounds; the enumerators guarantee both.
 */
interface CostCtx {
  rows: number
  cols: number
  board: { tile: Tile; cell: number }[]
  all: Tile[]
  goals: Int32Array
  cost(): number
}

function makeCostCtx(grid: Grid, rack: Tile[]): CostCtx | null {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  if (rows === 0 || cols === 0) return null

  const board: { tile: Tile; cell: number }[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const t = grid[r][c]
      if (t) board.push({ tile: t, cell: r * cols + c })
    }

  const all = [...board.map(b => b.tile), ...rack]
  if (all.length === 0) return null

  const n = board.length
  const rackCount = rack.length

  // cell → index of the board tile sitting on it, or -1.
  const occupant = new Int32Array(rows * cols).fill(-1)
  for (let i = 0; i < n; i++) occupant[board[i].cell] = i

  const goals = new Int32Array(n)
  const mark = new Uint8Array(n) // 0 unseen, 1 on the current walk, 2 retired, 3 fixed
  const walk = new Int32Array(n)

  return {
    rows, cols, board, all, goals,
    cost() {
      mark.fill(0)
      let fixed = 0
      for (let i = 0; i < n; i++) {
        if (board[i].cell === goals[i]) { fixed++; mark[i] = 3 }
      }

      let cycles = 0
      for (let i = 0; i < n; i++) {
        if (mark[i] !== 0) continue
        let len = 0
        let cur = i
        while (cur !== -1 && mark[cur] === 0) {
          mark[cur] = 1
          walk[len++] = cur
          cur = occupant[goals[cur]]
        }
        // Stopped on a node of this very walk ⇒ we closed a cycle. Stopping on
        // a retired node is impossible (in-degree ≤ 1), and stopping on a fixed
        // tile is impossible (it would share that tile's goal cell).
        if (cur !== -1 && mark[cur] === 1) cycles++
        for (let w = 0; w < len; w++) mark[walk[w]] = 2
      }

      return n + rackCount - fixed - cycles
    },
  }
}

function materialize(ctx: CostCtx, moves: number, cellOf: (t: Tile) => number): GoalPlan {
  const goal = new Map<string, [number, number]>()
  for (const t of ctx.all) {
    const cell = cellOf(t)
    goal.set(tileKey(t), [Math.floor(cell / ctx.cols), cell % ctx.cols])
  }
  return { moves, goal }
}

/**
 * Cheapest "one colour's run per row" layout — the goal of `groups-to-runs`.
 * A window is a colour-row needing L consecutive values, so the free parameters
 * are which colour owns which row and where the block sits.
 *
 * Returns null when the tiles cannot form that shape at all (a colour whose
 * values are not contiguous, fewer than 3 of a colour, or no room on the grid).
 * That null is exactly invariant (e) failing, and it is why the mirrored
 * archetype's tiles cannot be scored with this function by accident.
 */
export function planColorRunGoal(grid: Grid, rack: Tile[]): GoalPlan | null {
  const ctx = makeCostCtx(grid, rack)
  if (!ctx) return null
  const { rows, cols, board, all, goals } = ctx

  const vmin = Math.min(...all.map(t => t.n))
  const vmax = Math.max(...all.map(t => t.n))
  const width = vmax - vmin // column offset of the highest value

  const byColor = new Map<Tile['c'], number[]>()
  for (const t of all) byColor.set(t.c, [...(byColor.get(t.c) ?? []), t.n])
  for (const vals of byColor.values()) {
    const sorted = [...vals].sort((a, b) => a - b)
    if (sorted.length < 3) return null
    for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1] + 1) return null
  }

  const colors = [...byColor.keys()]
  if (colors.length > rows || width >= cols) return null

  const n = board.length
  let best = Infinity
  let bestCellOf: ((t: Tile) => number) | null = null

  for (const perm of permutations(colors)) {
    for (let rowStart = 0; rowStart + colors.length <= rows; rowStart++) {
      const rowOf = new Map<Tile['c'], number>()
      perm.forEach((c, i) => rowOf.set(c, rowStart + i))
      const boardRow = board.map(b => rowOf.get(b.tile.c)!)
      for (let colStart = 0; colStart + width < cols; colStart++) {
        for (let i = 0; i < n; i++)
          goals[i] = boardRow[i] * cols + colStart + (board[i].tile.n - vmin)
        const cost = ctx.cost()
        if (cost < best) {
          best = cost
          const rowSnap = new Map(rowOf)
          const cs = colStart
          bestCellOf = (t: Tile) => rowSnap.get(t.c)! * cols + cs + (t.n - vmin)
        }
      }
    }
  }

  return bestCellOf ? materialize(ctx, best, bestCellOf) : null
}

/** Ordered selections of `k` items from `xs` (k-permutations). */
function kPermutations<T>(xs: T[], k: number): T[][] {
  if (k === 0) return [[]]
  const out: T[][] = []
  for (let i = 0; i < xs.length; i++) {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)]
    for (const p of kPermutations(rest, k - 1)) out.push([xs[i], ...p])
  }
  return out
}

/**
 * Cheapest "one value's group per row" layout — the goal of `runs-to-groups`,
 * and the exact mirror of planColorRunGoal. A window is a value-row needing 3
 * or 4 distinct colours, so the free parameters are which value owns which row,
 * the left-to-right colour order inside the groups, and where the block sits.
 *
 * Ranking each row's colours *within the colours that value actually has* keeps
 * every group contiguous automatically, so a 3-colour row never leaves a hole
 * where the missing colour's column would have been.
 *
 * Returns null unless every value has 3 or 4 distinct colours — which is
 * invariant (e) for this shape, and is why `groups-to-runs` tiles (whose
 * boundary values carry only 1-2 colours) can never be scored here by accident.
 *
 * WHY THIS IS NOT AN L! SEARCH ANY MORE (generator-audit session). The cost is
 *     boardTiles + rack − fixed − cycles
 * and both `fixed` and `cycles` can only involve goal cells that currently HOLD
 * a tile: a tile is fixed when it already sits on its goal cell, and a cycle is
 * a closed walk through occupied goal cells. A value sent to a goal row with no
 * board tile on it therefore contributes nothing, whichever empty row it gets.
 * So only the values assigned to OCCUPIED goal rows matter — an ordered choice
 * of k values for the k occupied rows inside the block, L!/(L−k)! candidates
 * instead of L!. Builder boards occupy 3 rows, so L=7 drops from 5040 orders to
 * 210 and L=8 from 40320 to 336. The result is the same minimum, not an
 * approximation: valueGroupPlanner.verify.ts checks it against the exhaustive
 * original (kept below) on builder boards and on scrambled ones.
 */
export function planValueGroupGoal(grid: Grid, rack: Tile[]): GoalPlan | null {
  const ctx = makeCostCtx(grid, rack)
  if (!ctx) return null
  const { rows, cols, board, all, goals } = ctx

  const byValue = new Map<number, Tile['c'][]>()
  for (const t of all) byValue.set(t.n, [...(byValue.get(t.n) ?? []), t.c])
  for (const cs of byValue.values()) {
    if (cs.length < 3 || cs.length > 4) return null
    if (new Set(cs).size !== cs.length) return null
  }

  const values = [...byValue.keys()].sort((a, b) => a - b)
  const vmin = values[0]
  const vmax = values[values.length - 1]
  const maxWidth = Math.max(...[...byValue.values()].map(cs => cs.length))
  if (values.length > rows || maxWidth > cols) return null

  const rowOccupied = grid.map(rw => rw.some(t => t !== null))
  const colors = [...new Set(all.map(t => t.c))]
  const n = board.length
  const vOff = board.map(b => b.tile.n - vmin)
  const rowIdx = new Int32Array(vmax - vmin + 1)
  const boardRank = new Int32Array(n)
  const base = new Int32Array(n)

  // Value orders worth trying, per block position: one per ordered choice of
  // values for the occupied rows, the rest filling the empty rows in ascending
  // order (which empty row a value gets cannot change the cost).
  const ordersFor = (rowStart: number): number[][] => {
    const slots: number[] = []
    for (let i = 0; i < values.length; i++) if (rowOccupied[rowStart + i]) slots.push(i)
    return kPermutations(values, slots.length).map(chosen => {
      const order = new Array<number>(values.length).fill(-1)
      slots.forEach((slot, j) => { order[slot] = chosen[j] })
      const rest = values.filter(v => !chosen.includes(v))
      let r = 0
      for (let i = 0; i < order.length; i++) if (order[i] === -1) order[i] = rest[r++]
      return order
    })
  }
  const orders: number[][][] = []
  for (let rowStart = 0; rowStart + values.length <= rows; rowStart++) orders.push(ordersFor(rowStart))

  let best = Infinity
  let bestCellOf: ((t: Tile) => number) | null = null

  for (const pi of permutations(colors)) {
    const piIndex = new Map(pi.map((c, i) => [c, i]))
    // `rank` maps a tile to its column inside its value's group. Keyed by minted
    // copy-0 ids, which is safe here precisely because this planner rejects any
    // value carrying a colour twice (the distinct-colour check above), so every
    // tile it ever sees is the sole copy of its (value, colour).
    const rank = new Map<string, number>()
    for (const [v, cs] of byValue) {
      const ordered = [...cs].sort((a, b) => piIndex.get(a)! - piIndex.get(b)!)
      ordered.forEach((c, i) => rank.set(tileKey(makeTile(v, c)), i))
    }
    for (let i = 0; i < n; i++) boardRank[i] = rank.get(tileKey(board[i].tile))!

    for (let rowStart = 0; rowStart + values.length <= rows; rowStart++) {
      const rowShift = rowStart * cols
      for (const vp of orders[rowStart]) {
        for (let i = 0; i < vp.length; i++) rowIdx[vp[i] - vmin] = i
        for (let i = 0; i < n; i++) base[i] = rowIdx[vOff[i]] * cols + boardRank[i]
        for (let colStart = 0; colStart + maxWidth <= cols; colStart++) {
          const shift = rowShift + colStart
          for (let i = 0; i < n; i++) goals[i] = base[i] + shift
          const cost = ctx.cost()
          if (cost < best) {
            best = cost
            const rowOf = new Map(vp.map((v, i) => [v, rowStart + i]))
            const rankSnap = new Map(rank)
            const cs = colStart
            bestCellOf = (t: Tile) => rowOf.get(t.n)! * cols + cs + rankSnap.get(tileKey(t))!
          }
        }
      }
    }
  }

  return bestCellOf ? materialize(ctx, best, bestCellOf) : null
}

/**
 * The ORIGINAL exhaustive planner: every one of the L! value orders. Kept, like
 * solveBag, purely as an independent differential oracle for
 * planValueGroupGoal (see valueGroupPlanner.verify.ts). No builder calls it.
 */
export function planValueGroupGoalExhaustive(grid: Grid, rack: Tile[]): GoalPlan | null {
  const ctx = makeCostCtx(grid, rack)
  if (!ctx) return null
  const { rows, cols, board, all, goals } = ctx

  const byValue = new Map<number, Tile['c'][]>()
  for (const t of all) byValue.set(t.n, [...(byValue.get(t.n) ?? []), t.c])
  for (const cs of byValue.values()) {
    if (cs.length < 3 || cs.length > 4) return null
    if (new Set(cs).size !== cs.length) return null
  }

  const values = [...byValue.keys()].sort((a, b) => a - b)
  const vmin = values[0]
  const vmax = values[values.length - 1]
  const maxWidth = Math.max(...[...byValue.values()].map(cs => cs.length))
  if (values.length > rows || maxWidth > cols) return null

  const colors = [...new Set(all.map(t => t.c))]
  const valuePerms = permutations(values)
  const n = board.length
  const vOff = board.map(b => b.tile.n - vmin)
  const rowIdx = new Int32Array(vmax - vmin + 1)
  const boardRank = new Int32Array(n)
  const base = new Int32Array(n)

  let best = Infinity
  let bestCellOf: ((t: Tile) => number) | null = null

  for (const pi of permutations(colors)) {
    const piIndex = new Map(pi.map((c, i) => [c, i]))
    // `rank` maps a tile to its column inside its value's group. Keyed by minted
    // copy-0 ids, which is safe here precisely because this planner rejects any
    // value carrying a colour twice (the distinct-colour check above), so every
    // tile it ever sees is the sole copy of its (value, colour).
    const rank = new Map<string, number>()
    for (const [v, cs] of byValue) {
      const ordered = [...cs].sort((a, b) => piIndex.get(a)! - piIndex.get(b)!)
      ordered.forEach((c, i) => rank.set(tileKey(makeTile(v, c)), i))
    }
    for (let i = 0; i < n; i++) boardRank[i] = rank.get(tileKey(board[i].tile))!

    for (const vp of valuePerms) {
      for (let i = 0; i < vp.length; i++) rowIdx[vp[i] - vmin] = i
      // Everything that does not depend on where the block sits, hoisted out of
      // the two innermost loops: goal = base + rowStart * cols + colStart.
      for (let i = 0; i < n; i++) base[i] = rowIdx[vOff[i]] * cols + boardRank[i]

      for (let rowStart = 0; rowStart + values.length <= rows; rowStart++) {
        const rowShift = rowStart * cols
        for (let colStart = 0; colStart + maxWidth <= cols; colStart++) {
          const shift = rowShift + colStart
          for (let i = 0; i < n; i++) goals[i] = base[i] + shift
          const cost = ctx.cost()
          if (cost < best) {
            best = cost
            const rowOf = new Map(vp.map((v, i) => [v, rowStart + i]))
            const rankSnap = new Map(rank)
            const cs = colStart
            bestCellOf = (t: Tile) => rowOf.get(t.n)! * cols + cs + rankSnap.get(tileKey(t))!
          }
        }
      }
    }
  }

  return bestCellOf ? materialize(ctx, best, bestCellOf) : null
}

interface Params { L: number; rackSize: number }

function paramsFor(diff: Difficulty): Params {
  switch (diff) {
    case 'easy': return { L: 3, rackSize: 2 }
    case 'medium': return { L: 4, rackSize: 3 }
    case 'hard': return { L: 5, rackSize: 4 }
    case 'extreme': return { L: 6, rackSize: 4 }
  }
}

/**
 * A permutation of the 4 colours sharing no position with `prev`. Purely
 * cosmetic now — it keeps vertically adjacent rows from lining up a colour into
 * a visible column, which would read as a meaningful structure when it is not.
 * Correctness no longer depends on it.
 */
function derangedFrom(prev: Tile['c'][] | null): Tile['c'][] | null {
  for (let attempt = 0; attempt < 100; attempt++) {
    const p = shuffle(ALL_COLORS)
    if (!prev || p.every((c, i) => c !== prev[i])) return p
  }
  return null
}

export function buildGroupsToRuns(diff: Difficulty): ArchetypeResult | null {
  const { L, rackSize } = paramsFor(diff)

  // Need s-1 and s+L to exist inside 1..13.
  const s = randomInt(2, 13 - L)

  // Board needs L rows; the goal layout needs 4 (one run per colour).
  const rows = Math.max(L, 4) + 2
  // Board strips are 4 wide, all starting at the same colStart; the goal runs
  // span L+2 values from colStart. cols = L + 5 clears both with a margin.
  const cols = L + 5
  const rowStart = 1
  const colStart = 1

  // Which value lands on which row, and the colour order inside each strip.
  const values = shuffle(Array.from({ length: L }, (_, i) => s + i))
  const perms: Tile['c'][][] = []
  for (let i = 0; i < L; i++) {
    const p = derangedFrom(i === 0 ? null : perms[i - 1])
    if (!p) return null
    perms.push(p)
  }

  const grid: Grid = Array.from({ length: rows }, () => Array(cols).fill(null))
  for (let i = 0; i < L; i++) {
    for (let k = 0; k < 4; k++) grid[rowStart + i][colStart + k] = makeTile(values[i], perms[i][k])
  }

  // (a) the board the player is shown is already fully valid.
  if (!validateGrid(grid)) return null

  // Rack: run extensions, <=1 per colour (no run inside the rack) and <=2 per
  // value (no group inside the rack).
  const lowCount = rackSize === 2 ? 1 : rackSize === 3 ? (Math.random() < 0.5 ? 1 : 2) : 2
  const highCount = rackSize - lowCount
  if (lowCount > 2 || highCount > 2) return null
  const pick = shuffle(ALL_COLORS)
  const rack: Tile[] = [
    ...pick.slice(0, lowCount).map(c => makeTile(s - 1, c)),
    ...pick.slice(lowCount, lowCount + highCount).map(c => makeTile(s + L, c)),
  ]

  // (c) the rack is not already a puzzle on its own.
  if (formsValidSetAlone(rack)) return null

  // (b) board + rack really is partitionable.
  const boardTiles = grid.flat().filter((t): t is Tile => t !== null)
  const allTiles = [...boardTiles, ...rack]
  if (!solveBagM2(allTiles).solvable) return null

  // (d) the obvious move must fail — exhaustively, not heuristically.
  const search = existsNoRelocationWin(grid, rack)
  if (search.win || search.exhausted) return null

  // Reference solution: the same tiles rebuilt as 4 runs, one colour per row.
  // Which colour takes which row, and where the block sits, are free — so pick
  // the layout the player can reach in the fewest moves. See planColorRunGoal.
  const plan = planColorRunGoal(grid, rack)
  if (!plan) return null

  return { grid, rack: shuffle(rack), allTiles, minMoves: plan.moves }
}

// ---------------------------------------------------------------------------
// Construction: "runs to groups" — the mirror image of the above.
//
// The board shows N=3 colours over L consecutive values, laid out as its 3 RUNS:
// one colour per row, values ascending. The hidden goal is the same tiles as L
// GROUPS: one value per row, distinct colours side by side. Same duality, walked
// the other way, so recognising one direction does not hand you the other.
//
// WHY N IS FORCED TO 3. The goal is groups, and isValidGroup caps a group at 4
// tiles of distinct colours. Every value on the board already carries N colours,
// so the rack can only add a colour a value does not have yet. With N=4 there is
// no such colour, and boundary-value rack tiles (at s-1 or s+L) could only ever
// group with each other — which invariant (c) forbids. So the board takes 3 of
// the 4 colours, and the rack is made entirely of the 4th.
//
// WHY THE RACK IS HOMELESS — the mirror of the group-board argument:
//
//   1. ONE MAXIMAL SEGMENT PER ROW. Each board row is one gapless run and
//      nothing else, so no rack tile can bridge two flanking board tiles.
//
//   2. EVERY STRIP IS A RUN IN A COLOUR THE RACK DOES NOT HAVE. Append a rack
//      tile to either end of any board row and that row's segment holds two
//      colours — so it is not a run — while its values stay distinct — so it is
//      not a group. Whatever the tile is, the row breaks. Note this is why the
//      rack's colour must be off-board: a rack tile at s-1 or s+L in a board
//      colour would simply extend that run, which is failure mode 1 exactly.
//
// So a rack tile can only be covered by an all-rack segment. The rack is one
// colour, so such a segment is never a group, and it is a run only if it holds
// 3 consecutive values — which the value picker below refuses to produce. Hence
// (d) follows from (c) here too, and as before the implication is asserted, not
// assumed: the exhaustive existsNoRelocationWin gate still runs on every board.
//
// The only way out is to break the 3 runs apart and rebuild the same tiles as L
// groups, one value per row, which the rack's 4th colour then completes.
// ---------------------------------------------------------------------------

/**
 * `k` distinct offsets in [0, L) with no 3 consecutive — so the rack, which is
 * all one colour, can never be a run on its own. (It can never be a group
 * either: a group needs distinct colours.)
 */
function pickRackOffsets(L: number, k: number): number[] | null {
  const hasThreeConsecutive = (xs: number[]) => {
    for (let i = 0; i + 2 < xs.length; i++)
      if (xs[i + 1] === xs[i] + 1 && xs[i + 2] === xs[i] + 2) return true
    return false
  }
  for (let attempt = 0; attempt < 200; attempt++) {
    const picked = shuffle(Array.from({ length: L }, (_, i) => i)).slice(0, k).sort((a, b) => a - b)
    if (!hasThreeConsecutive(picked)) return picked
  }
  return null
}

/**
 * L/rackSize-per-difficulty for `runs-to-groups`. Deliberately separate from
 * `paramsFor` (which still governs `groups-to-runs` only): par for this
 * direction is a deterministic function of (L, rackSize) alone — measured as
 * exactly `3L + rackSize - 6`, since every 3×L block's transpose has identical
 * cycle structure regardless of which colours/values are drawn — so it needs
 * its own table to land in the same par range as the other direction at each
 * difficulty label.
 *
 * PERFORMANCE WALL, measured directly (buildRunsToGroupsAt, real wall-clock):
 *   L=5    10.7ms   L=6    63.7ms   L=7   503.3ms   L=8  5335.0ms
 * planValueGroupGoal enumerates L! value-permutations, so cost is O(L!) and
 * L=8 already costs 5+ seconds per build. rackSize barely moves the needle
 * (it only adds O(1) work per cost() call) — L is what must stay small.
 *
 * Consequence: L=8 (~5s/build) was tried for extreme to chase a higher par
 * but reverted — the 10x generation-time cost wasn't worth the calibration
 * gain over L=7 (~0.5s/build, same as hard). Every tier now stays at L<=7.
 * This trade was an explicit, discussed choice — see CLAUDE.md session notes
 * — not an oversight. rackSize is chosen at each L to land par as close to
 * (and, per that choice, slightly above rather than below) the measured
 * groups-to-runs average at the same label; ceiling is bounded by
 * pickRackOffsets' no-3-consecutive constraint, roughly ceil(2L/3).
 */
function runsToGroupsParamsFor(diff: Difficulty): Params {
  switch (diff) {
    case 'easy': return { L: 5, rackSize: 2 }   // par 11  (target avg 10.6, range 10-11)
    case 'medium': return { L: 6, rackSize: 4 } // par 16  (target avg 13.4, range 12-15)
    case 'hard': return { L: 7, rackSize: 5 }   // par 20  (target avg 20.0, range 18-21)
    // DELIBERATE RECALIBRATION (generator-audit session): extreme was identical
    // to hard (L=7 / par 20) only because the old L! planner made L=8 cost ~5s.
    // With the occupied-row planner L=8 builds in ~0.1s, so extreme is its own
    // tier again. rackSize 5 (par 23), not 6 (par 24): six offsets out of eight
    // admit a single no-three-consecutive pattern, i.e. one board shape.
    case 'extreme': return { L: 8, rackSize: 5 } // par 23  (groups-to-runs extreme: 24-25 typical)
  }
}

export function buildRunsToGroups(diff: Difficulty): ArchetypeResult | null {
  const { L, rackSize } = runsToGroupsParamsFor(diff)
  return buildRunsToGroupsAt(L, rackSize)
}

/** L-parameterized core, exported for tuning/verification — see buildRunsToGroups. */
export function buildRunsToGroupsAt(L: number, rackSize: number): ArchetypeResult | null {
  if (rackSize > L) return null

  // Board values s..s+L-1 all sit inside 1..13; no boundary values are needed.
  const s = randomInt(1, 14 - L)

  // Board needs 3 rows; the goal layout needs L (one group per value).
  const rows = Math.max(3, L) + 2
  // Board runs are L wide; goal groups are at most 4 wide. Both start at
  // colStart, so max(L, 4) + 2 clears either with a margin on each side.
  const cols = Math.max(L, 4) + 2
  const rowStart = 1
  const colStart = 1

  // Three colours go on the board, one run each; the fourth is the whole rack.
  const picked = shuffle(ALL_COLORS)
  const boardColors = picked.slice(0, 3)
  const rackColor = picked[3]

  const grid: Grid = Array.from({ length: rows }, () => Array(cols).fill(null))
  boardColors.forEach((c, i) => {
    for (let k = 0; k < L; k++) grid[rowStart + i][colStart + k] = makeTile(s + k, c)
  })

  // (a) the board the player is shown is already fully valid.
  if (!validateGrid(grid)) return null

  // Rack: the off-board colour, at values inside the block, never 3 in a row.
  const offsets = pickRackOffsets(L, rackSize)
  if (!offsets) return null
  const rack: Tile[] = offsets.map(o => makeTile(s + o, rackColor))

  // (c) the rack is not already a puzzle on its own.
  if (formsValidSetAlone(rack)) return null

  // (b) board + rack really is partitionable.
  const boardTiles = grid.flat().filter((t): t is Tile => t !== null)
  const allTiles = [...boardTiles, ...rack]
  if (!solveBagM2(allTiles).solvable) return null

  // UNIQUENESS GATE (generator-audit session). When three consecutive values
  // carry no rack tile, those nine board tiles can simply stay as three short
  // runs: a second, much cheaper solution that never dismantles the board, so
  // par overstates it and the intended insight is optional. Measured at 29% of
  // easy builds (rack {s,s+1}, {s+3,s+4} or {s,s+4} at L=5); 0% at medium and
  // above. Gated on the real partition count rather than on that pattern.
  if (partitionCount(allTiles, 2) !== 1) return null

  // (d) the obvious move must fail — exhaustively, not heuristically.
  const search = existsNoRelocationWin(grid, rack)
  if (search.win || search.exhausted) return null

  // Reference solution: the same tiles rebuilt as L groups, one value per row.
  const plan = planValueGroupGoal(grid, rack)
  if (!plan) return null

  return { grid, rack: shuffle(rack), allTiles, minMoves: plan.moves }
}

// ---------------------------------------------------------------------------
// DECOY archetype (runs-to-groups only) — see DECOY_DESIGN.md.
//
// Board: three colour runs at values s..s+L-1 (a runs-to-groups board). The rack
// carries ONE tempting decoy tile D = {s+L, c} in a *board* colour c: it visibly
// extends c's run (obviousSpots recognises it), so the "obvious" move is to drop
// it on the run's high end. That move is a DEAD END — committing D to the run
// strands the rest (verified: solveBagM2 on the remainder is UNSOLVABLE).
//
// D's genuine, non-obvious home is a HYBRID layout the pure planners cannot
// represent: a short run {s+L-2, s+L-1, s+L} of colour c, which pulls c out of
// values s+L-2 and s+L-1 so those two become {other-two-board-colours, kColour}
// groups — reachable only because the rack carries kColour at exactly those two
// values (the "supports"). A few interior kColour "fillers" complete other
// values as 4-colour groups; their placement is what makes the trap bite (see
// decoyFillerOffsets). Par + witness come from mixedLayoutMoves against this
// deterministically-built goal — never planMixedGoal's factorial search.
//
// kColour is simply the 4th colour (not necessarily literal 'k'); it lives only
// in groups, never in a run, so it can never extend a board run.
// ---------------------------------------------------------------------------

/**
 * Interior filler offsets (into values s..) for a run of length L. Chosen so
 * that after the run steals values s+L-2 and s+L-1, the two remaining board
 * colours' leftover values [s..s+L-3] minus these fillers contain NO three
 * consecutive values — which is exactly what makes the run-extension a dead end
 * (the leftover 2-colour tiles can then form neither a run nor a group). Fillers
 * are drawn from [0, L-4] only, so they never sit adjacent to the two supports
 * at L-2/L-1 and therefore never form a 3-consecutive kColour run themselves.
 * Deterministic: returns the first (smallest, lexicographically least) such set.
 */
function decoyFillerOffsets(L: number): number[] | null {
  const M = L - 3 // leftover interval is [0..M]
  if (M < 2) return null
  const hasThreeConsecutive = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    for (let i = 0; i + 2 < s.length; i++) if (s[i + 1] === s[i] + 1 && s[i + 2] === s[i] + 2) return true
    return false
  }
  const universe = Array.from({ length: M }, (_, i) => i) // [0, L-4]
  const kept = Array.from({ length: M + 1 }, (_, i) => i) // [0, L-3]
  for (let size = 0; size <= universe.length; size++)
    for (const combo of combinations(universe, size)) {
      const remaining = kept.filter(x => !combo.includes(x))
      if (!hasThreeConsecutive(remaining)) return combo
    }
  return null
}

// ---------------------------------------------------------------------------
// VARIANT MACHINERY shared by the three trap layers (trap-variety session).
//
// Each layer used to build exactly one puzzle up to colour and value shift.
// Each now has ONE core that takes a variant (mirror, filler set, which colours
// carry the tempting tiles); the original puzzle is the default variant, so the
// pre-existing harnesses still exercise the same code path and their pinned
// pars still hold.
//
// Arguments do NOT transfer between variants (red herring leaks an alternate
// win at L>=7 without a filler; decoy L=7 fillers {1} has a dead trap but ten
// solutions). So nothing here is argued: every build runs its own named proof
// steps against the real solver and is rejected at the first one that fails.
// The variant tables below only list what a probe measured as passing — they
// limit rejections, they are never what makes a build sound.
// ---------------------------------------------------------------------------

/** One named step of a construction's proof, in the order it was checked. */
export interface ProofLine { name: string; ok: boolean }
interface Proved<T> { build: T | null; proof: ProofLine[] }

/** Runs proof steps in order; nothing after the first failure is evaluated. */
class Proof {
  lines: ProofLine[] = []
  failed = false
  step(name: string, test: () => boolean): void {
    if (this.failed) return
    const ok = test()
    this.lines.push({ name, ok })
    if (!ok) this.failed = true
  }
}

/**
 * A block of L consecutive values addressed by OFFSET 0..L-1, with -1 and L the
 * two values just outside it. `mirror` reflects the offsets, so a construction
 * written once in offsets yields both its high-end and its low-end form. Boards
 * are always laid out by ascending value: mirroring changes which tiles exist,
 * never the reading direction.
 */
interface Frame {
  s: number
  L: number
  val(o: number): number
  off(t: Tile): number
}

function makeFrame(L: number, mirror: boolean, usesBelow: boolean, usesAbove: boolean): Frame | null {
  const needLowValue = mirror ? usesAbove : usesBelow
  const needHighValue = mirror ? usesBelow : usesAbove
  const sMin = needLowValue ? 2 : 1
  const sMax = needHighValue ? 13 - L : 14 - L
  if (sMax < sMin) return null
  const s = randomInt(sMin, sMax)
  return {
    s, L,
    val: o => (mirror ? s + L - 1 - o : s + o),
    off: t => (mirror ? s + L - 1 - t.n : t.n - s),
  }
}

/** Three full colour runs, one per row, every row starting at column 1. */
function layRuns(f: Frame, boardColors: Tile['c'][], rows: number, cols: number): Grid {
  const grid: Grid = Array.from({ length: rows }, () => Array(cols).fill(null))
  boardColors.forEach((col, i) => { for (let v = f.s; v < f.s + f.L; v++) grid[i][1 + (v - f.s)] = makeTile(v, col) })
  return grid
}

const runWindow = (f: Frame, color: Tile['c'], a: number, b: number): WindowSpec =>
  ({ type: 'run', color, start: Math.min(f.val(a), f.val(b)), length: b - a + 1 })

/** Committing the tiles matching `pred` leaves a remainder no partition covers. */
function commitIsDead(all: Tile[], pred: (t: Tile) => boolean): boolean {
  const rest = all.filter(t => !pred(t))
  return rest.length > 0 && !solveBagM2(rest).solvable
}

/** Every non-empty combination of the tempting commitments is a dead end. */
function everyCombinationDead(all: Tile[], commits: ((t: Tile) => boolean)[]): boolean {
  for (let mask = 1; mask < (1 << commits.length); mask++)
    if (!commitIsDead(all, t => commits.some((p, i) => ((mask >> i) & 1) === 1 && p(t)))) return false
  return true
}

/** Invariants (a)-(d), as proof steps. */
function proveInvariants(p: Proof, grid: Grid, rack: Tile[], allTiles: Tile[]): void {
  p.step('(a) board valid at move zero', () => validateGrid(grid))
  p.step('(c) rack is not a set on its own', () => !formsValidSetAlone(rack))
  p.step('(b) bag solvable under solveBagM2', () => solveBagM2(allTiles).solvable)
  p.step('(d) no no-relocation win (exhaustive)', () => {
    const search = existsNoRelocationWin(grid, rack)
    return !search.win && !search.exhausted
  })
}

const pickOne = <T,>(xs: readonly T[]): T => xs[randomInt(0, xs.length - 1)]

/** L per difficulty for decoys. Hard/extreme ONLY (null elsewhere) — decoys must
 * never appear on easy/medium, per DECOY_DESIGN.md. */
function decoyParamsFor(diff: Difficulty): { L: number } | null {
  switch (diff) {
    case 'hard': return { L: 6 }
    case 'extreme': return { L: 7 }
    default: return null
  }
}

/**
 * `mirror` puts the decoy below the block (value s-1, short run {s-1,s,s+1})
 * instead of above it. `fillers` are offsets of the extra kColour tiles.
 */
export interface DecoyVariant { mirror: boolean; fillers: number[] }

/**
 * Filler sets measured as UNIQUE with a DEAD trap, per L (probe output is in
 * GENERATOR_AUDIT.md). The first entry of each row is what decoyFillerOffsets
 * returns, i.e. the original puzzle. Sets the probe rejected, for the record:
 * L=6 {0} leaks (leftover 1,2,3 is a run); L=7 {1} and {3} have a dead trap but
 * 10 and 5 solutions.
 */
const DECOY_FILLERS: Record<number, number[][]> = {
  6: [[1], [0, 1], [2], [0, 2], [1, 2]],
  7: [[2], [0, 2], [1, 2], [0, 3], [1, 3], [0, 1, 3], [2, 3], [0, 2, 3]],
}

/** Every shipped decoy variant at this difficulty. */
export function decoyVariants(diff: Difficulty): { L: number; variant: DecoyVariant }[] {
  const p = decoyParamsFor(diff)
  if (!p) return []
  return [false, true].flatMap(mirror =>
    (DECOY_FILLERS[p.L] ?? []).map(fillers => ({ L: p.L, variant: { mirror, fillers } })))
}

/** Superset of ArchetypeResult exposing the internals a decoy needs verified:
 * the deterministic hybrid goal, the decoy tile, and the tempting run-extension
 * set S. The generator only reads the ArchetypeResult fields. */
export interface DecoyBuild extends ArchetypeResult {
  goal: Map<string, [number, number]>
  decoy: Tile
  /** The tempting run-extension set — committing to it strands the remainder. */
  runExtension: Tile[]
  s: number
  L: number
  variant: DecoyVariant
  witness: Drop[]
}

/** The ORIGINAL decoy for this difficulty (high end, smallest filler set). */
export function buildDecoy(diff: Difficulty): DecoyBuild | null {
  const p = decoyParamsFor(diff)
  if (!p) return null
  return buildDecoyAt(p.L)
}

/** A random shipped variant, optionally restricted (dev force types). */
export function buildDecoyVariant(diff: Difficulty, only?: (v: DecoyVariant) => boolean): DecoyBuild | null {
  const pool = decoyVariants(diff).filter(x => !only || only(x.variant))
  if (pool.length === 0) return null
  const pick = pickOne(pool)
  return buildDecoyAt(pick.L, pick.variant)
}

/** L-parameterized decoy core. With no variant it builds the original puzzle. */
export function buildDecoyAt(L: number, variant?: DecoyVariant): DecoyBuild | null {
  return decoyCore(L, variant).build
}

/** The named proof steps for one variant, up to and including the first failure. */
export function proveDecoyAt(L: number, variant?: DecoyVariant): ProofLine[] {
  return decoyCore(L, variant).proof
}

function decoyCore(L: number, variantIn?: DecoyVariant): Proved<DecoyBuild> {
  const none: Proved<DecoyBuild> = { build: null, proof: [] }
  if (L < 5) return none // need a length-3 run plus at least one interior filler
  const canonical = decoyFillerOffsets(L)
  const variant = variantIn ?? (canonical ? { mirror: false, fillers: canonical } : null)
  if (!variant) return none
  const F = variant.fillers

  // The decoy sits at offset L, just outside the block.
  const f = makeFrame(L, variant.mirror, false, true)
  if (!f) return none
  const s = f.s

  const colors = shuffle(ALL_COLORS)
  const boardColors = colors.slice(0, 3)
  const kColor = colors[3]
  const c = boardColors[randomInt(0, 2)]                 // decoy / short-run colour
  const others = boardColors.filter(x => x !== c)        // the two colours that stay whole

  // Goal has L+1 windows (one short run + one group per value), one per row.
  const rows = L + 1
  const cols = L + 3
  const grid = layRuns(f, boardColors, rows, cols)

  // Rack: the decoy, two supports (kColour at offsets L-2 / L-1), and fillers.
  const decoy: Tile = makeTile(f.val(L), c)
  const rack: Tile[] = [
    decoy,
    makeTile(f.val(L - 2), kColor),
    makeTile(f.val(L - 1), kColor),
    ...F.map(o => makeTile(f.val(o), kColor)),
  ]
  const boardTiles = grid.flat().filter((t): t is Tile => t !== null)
  const allTiles = [...boardTiles, ...rack]

  const p = new Proof()
  proveInvariants(p, grid, rack, allTiles)

  // The decoy must actually have a visible, tempting board placement.
  p.step('OBVIOUS the decoy visibly extends a board run', () => obviousSpots(grid, decoy).length > 0)

  // TRAP PROPERTY: commit the decoy to its obvious run-extension (all of colour
  // c, offsets 0..L) and the remainder must be UNSOLVABLE.
  const inRunExtension = (t: Tile) => t.c === c
  p.step('TRAP extending the run is a dead end', () => commitIsDead(allTiles, inRunExtension))

  // UNIQUENESS: the hybrid goal below must be the only partition, otherwise a
  // different (possibly cheaper) answer exists and par is not what it claims.
  p.step('UNIQUE exactly one partition', () => partitionCount(allTiles, 2) === 1)

  // Deterministic hybrid goal: the short run of c on row 0, then one group per
  // value, ascending, on the following rows.
  const windows: WindowSpec[] = [runWindow(f, c, L - 2, L)]
  for (let v = s; v < s + L; v++) {
    const o = f.off(makeTile(v, c))
    let groupColors: Tile['c'][]
    if (o >= L - 2) groupColors = [...others, kColor] // c was pulled into the run
    else groupColors = F.includes(o) ? [...boardColors, kColor] : [...boardColors]
    windows.push({ type: 'group', value: v, colors: groupColors })
  }

  // (e) par + witness for the hybrid goal, via the proven mixed planner core.
  // Binds each window slot to the CONCRETE tile already in grid+rack (never a
  // freshly-minted one) and takes the CHEAPEST copy-pairing (Step 6b).
  const box: { res: ReturnType<typeof bindMinCostGoal> } = { res: null }
  p.step('HOME the hybrid goal is reached, valid, with a par witness', () => {
    box.res = bindMinCostGoal(windows, grid, rack, (wi, i) => [wi, 1 + i])
    return !!box.res && box.res.reachedGoal && box.res.validGoal
  })
  if (p.failed || !box.res) return { build: null, proof: p.lines }
  const done = box.res

  return {
    proof: p.lines,
    build: {
      grid, rack: shuffle(rack), allTiles, minMoves: done.moves, goal: done.goal, witness: done.witness,
      decoy, runExtension: allTiles.filter(inRunExtension), s, L, variant,
    },
  }
}

// ---------------------------------------------------------------------------
// RED HERRING archetype (runs-to-groups only) — see RED_HERRING_DESIGN.md.
//
// A strict superset of the decoy machinery: instead of ONE tempting tile, the
// rack carries TWO, at OPPOSITE ends of the same board run of colour c —
//     Lo = {s-1, c}  (visibly extends c's run at the bottom)
//     H  = {s+L, c}  (visibly extends c's run at the top)
// Both score as obvious run-extensions (OBVIOUS ×2), so the player faces a real
// discrimination task, not a single thing to be suspicious of.
//
// THE INTERACTION (this is what makes it a red herring, not two glued decoys):
// both extenders' true homes come from the SAME hybrid reorganization — c splits
// into a LOW short run {s-1,s,s+1} and a HIGH short run {s+L-2,s+L-1,s+L}, its
// middle values stay as {c, o1, o2} groups, and the four vacated end-values
// (s, s+1, s+L-2, s+L-1) become {o1, o2, kColour} groups (the four kColour
// "supports"). Committing EITHER extender to its obvious append makes c one
// contiguous block again, which destroys the OTHER extender's short-run home:
// the other extender is orphaned and the remainder is UNSOLVABLE. So getting one
// wrong provably makes the other's true home unreachable — the two tiles are
// coupled through one reorganization, and neither obvious move is safe.
//
// TRAP scoping (verified with the real solver, both directions):
//   commit H  → solveBagM2(allTiles \ {c at s..s+L})    is UNSOLVABLE  (Lo orphaned)
//   commit Lo → solveBagM2(allTiles \ {c at s-1..s+L-1}) is UNSOLVABLE (H orphaned)
// while the correct hybrid goal (both extenders in their short runs) wins.
//
// L is capped at 6: with L≥7 the c-middle is ≥3 values wide, so "extend BOTH
// ends fully" leaves o1/o2 middle RUNS and becomes an alternate win — the trap
// would leak (measured directly: L=7 extendBoth-dead=false). L=5/6 keep the
// middle at 1/2 values, too short to run, so extend-both is a genuine dead end.
// ---------------------------------------------------------------------------

/** L per difficulty for the ORIGINAL red herring. Hard/extreme ONLY. */
function redHerringParamsFor(diff: Difficulty): { L: number } | null {
  switch (diff) {
    case 'hard': return { L: 5 }
    case 'extreme': return { L: 6 }
    default: return null
  }
}

/**
 * `split` puts the two extenders on DIFFERENT board colours (low extender on
 * one run, high extender on another) instead of both ends of one run.
 * `fillers` are offsets, inside the middle [2..L-3], of extra kColour tiles.
 */
export interface HerringVariant { split: boolean; fillers: number[] }

/**
 * Sizes and filler sets shipped per tier, all measured (GENERATOR_AUDIT.md).
 *
 * THE L>=7 WALL AND WHAT GETS PAST IT. With no filler, L>=7 leaves a middle of
 * three or more values, so "extend both ends" strands nothing: the two other
 * colours simply stay as middle runs (7 solutions at L=7, 14 at L=8). A kColour
 * filler in the middle forces a group there, which cuts those leftover runs
 * below length 3 and makes extend-both a dead end again — and it is exactly
 * that extra forced step which lifts the technique level from L1 (stranding)
 * to L2 (chain). At L<=6 no filler is possible: any middle kColour tile makes
 * three consecutive kColour tiles with the supports, a set in the rack alone.
 * So L<=6 is L1 and cannot be strengthened this way; L=7 admits exactly {3};
 * L=8 admits {3}, {4} and {3,4}.
 *
 * Hard keeps the small sizes (L1). Extreme ships only the L2 sizes.
 */
const HERRING_SHIPPED: Partial<Record<Difficulty, { L: number; fillers: number[] }[]>> = {
  hard: [{ L: 5, fillers: [] }, { L: 6, fillers: [] }],
  extreme: [{ L: 7, fillers: [3] }, { L: 8, fillers: [3] }, { L: 8, fillers: [4] }, { L: 8, fillers: [3, 4] }],
}

/** Every shipped red-herring variant at this difficulty. */
export function redHerringVariants(diff: Difficulty): { L: number; variant: HerringVariant }[] {
  return (HERRING_SHIPPED[diff] ?? []).flatMap(x =>
    [false, true].map(split => ({ L: x.L, variant: { split, fillers: x.fillers } })))
}

/** Superset of ArchetypeResult exposing the internals a red herring needs
 * verified: the hybrid goal, both tempting extenders, and the trap sets. */
export interface RedHerringBuild extends ArchetypeResult {
  goal: Map<string, [number, number]>
  lowExtender: Tile
  highExtender: Tile
  /** Committing the LOW obvious extension strands the rest. */
  trapLow: Tile[]
  /** Committing the HIGH obvious extension strands the rest. */
  trapHigh: Tile[]
  /** Committing BOTH obvious extensions strands the rest. */
  trapBoth: Tile[]
  cLow: Tile['c']
  cHigh: Tile['c']
  s: number
  L: number
  variant: HerringVariant
  witness: Drop[]
}

/** The ORIGINAL red herring for this difficulty (one colour, no filler). */
export function buildRedHerring(diff: Difficulty): RedHerringBuild | null {
  const p = redHerringParamsFor(diff)
  if (!p) return null
  return buildRedHerringAt(p.L)
}

/** A random shipped variant, optionally restricted (dev force types). */
export function buildRedHerringVariant(diff: Difficulty, only?: (v: HerringVariant) => boolean): RedHerringBuild | null {
  const pool = redHerringVariants(diff).filter(x => !only || only(x.variant))
  if (pool.length === 0) return null
  const pick = pickOne(pool)
  return buildRedHerringAt(pick.L, pick.variant)
}

/** L-parameterized red-herring core. With no variant it builds the original. */
export function buildRedHerringAt(L: number, variant?: HerringVariant): RedHerringBuild | null {
  return redHerringCore(L, variant).build
}

/** The named proof steps for one variant, up to and including the first failure. */
export function proveRedHerringAt(L: number, variant?: HerringVariant): ProofLine[] {
  return redHerringCore(L, variant).proof
}

function redHerringCore(L: number, variantIn?: HerringVariant): Proved<RedHerringBuild> {
  const none: Proved<RedHerringBuild> = { build: null, proof: [] }
  if (L < 5) return none // <5: no middle group, and the four supports would be a run
  const variant = variantIn ?? { split: false, fillers: [] }
  const F = variant.fillers

  // Low extender at offset -1, high extender at offset L. Symmetric under value
  // reflection, so there is no mirror variant: split covers both orientations.
  const f = makeFrame(L, false, true, true)
  if (!f) return none
  const s = f.s

  const colors = shuffle(ALL_COLORS)
  const boardColors = colors.slice(0, 3)
  const kColor = colors[3]
  const trapColors = shuffle(boardColors)
  const cLow = trapColors[0]
  const cHigh = variant.split ? trapColors[1] : cLow
  // Group column order: trap colour(s) first, then the rest in board order.
  const order = [cLow, ...(cHigh !== cLow ? [cHigh] : []), ...boardColors.filter(x => x !== cLow && x !== cHigh)]

  // Goal has L+2 windows (two short runs + one group per value), one per row.
  const rows = L + 2
  const cols = L + 3
  const grid = layRuns(f, boardColors, rows, cols)

  const lowExtender: Tile = makeTile(s - 1, cLow)
  const highExtender: Tile = makeTile(s + L, cHigh)
  const supports = [0, 1, L - 2, L - 1]
  const rack: Tile[] = [lowExtender, highExtender, ...[...supports, ...F].map(o => makeTile(s + o, kColor))]
  const boardTiles = grid.flat().filter((t): t is Tile => t !== null)
  const allTiles = [...boardTiles, ...rack]

  const p = new Proof()
  proveInvariants(p, grid, rack, allTiles)

  // OBVIOUS x2: both extenders must have a visible, tempting board placement.
  p.step('OBVIOUS the low extender visibly extends a board run', () => obviousSpots(grid, lowExtender).length > 0)
  p.step('OBVIOUS the high extender visibly extends a board run', () => obviousSpots(grid, highExtender).length > 0)

  // TRAP: each obvious extension, and both together, strands the rest.
  const inLow = (t: Tile) => t.c === cLow && t.n <= s + L - 1
  const inHigh = (t: Tile) => t.c === cHigh && t.n >= s
  p.step('TRAP the low extension is a dead end', () => commitIsDead(allTiles, inLow))
  p.step('TRAP the high extension is a dead end', () => commitIsDead(allTiles, inHigh))
  p.step('TRAP every combination of extensions is a dead end', () => everyCombinationDead(allTiles, [inLow, inHigh]))
  p.step('UNIQUE exactly one partition', () => partitionCount(allTiles, 2) === 1)

  // Deterministic hybrid goal: a short run at each end, then one group per
  // value. A colour is absent from a group where its short run pulled it out;
  // kColour steps in at the four supports and at every filler.
  const windows: WindowSpec[] = [
    { type: 'run', color: cLow, start: s - 1, length: 3 },
    { type: 'run', color: cHigh, start: s + L - 2, length: 3 },
  ]
  for (let o = 0; o < L; o++) {
    const groupColors = order.filter(col => !(col === cLow && o <= 1) && !(col === cHigh && o >= L - 2))
    if (supports.includes(o) || F.includes(o)) groupColors.push(kColor)
    windows.push({ type: 'group', value: s + o, colors: groupColors })
  }

  const box: { res: ReturnType<typeof bindMinCostGoal> } = { res: null }
  p.step('HOME the hybrid goal is reached, valid, with a par witness', () => {
    box.res = bindMinCostGoal(windows, grid, rack, (wi, i) => [wi, 1 + i])
    return !!box.res && box.res.reachedGoal && box.res.validGoal
  })
  if (p.failed || !box.res) return { build: null, proof: p.lines }
  const done = box.res

  return {
    proof: p.lines,
    build: {
      grid, rack: shuffle(rack), allTiles, minMoves: done.moves, goal: done.goal, witness: done.witness,
      lowExtender, highExtender,
      trapLow: allTiles.filter(inLow), trapHigh: allTiles.filter(inHigh),
      trapBoth: allTiles.filter(t => inLow(t) || inHigh(t)),
      cLow, cHigh, s, L, variant,
    },
  }
}

// ---------------------------------------------------------------------------
// COMPOSED archetype — decoy AND red herring on ONE board, different colours.
//
// The goal is a multi-step deductive chain: the player must resolve a one-ended
// trap on colour cD *and* a two-ended trap on colour cH to win. Neither mechanic
// in isolation, and not two independent puzzles side by side — see the coupling
// note below.
//
// WHY THE NAIVE SUPERPOSITION IS IMPOSSIBLE (probed with the real solver before
// building, not assumed). Simply putting buildDecoy's rack on colour cD and
// buildRedHerring's rack on colour cH fails twice over:
//
//   1. TILE COLLISION. decoy wants kColour supports at {s+L-2, s+L-1}; red
//      herring wants them at {s, s+1, s+L-2, s+L-1}. The 4th colour has exactly
//      ONE tile per value, so the two demands collide on 2 tiles at every L.
//   2. The deeper, unfixable-by-retuning wall — GROUP BUDGET. Both modifiers'
//      high traps end in a short run containing s+L, and *any* valid run
//      containing s+L also contains s+L-1 and s+L-2. So both cD and cH vacate
//      those two values, leaving only {third board colour, kColour} = 2 colours
//      there — below isValidGroup's minimum of 3. No choice of value range or
//      grid size repairs this, because it is forced by run contiguity.
//
// THE FIX — make the high end a RUN-ONLY ZONE. Rather than fight for a group at
// s+L-2 / s+L-1, the layout gives up on having one: the third board colour cC
// also runs across the high end, so all three board colours are in runs there
// and no group is needed at all. kColour simply carries no tile at those values.
//
//   board  : three colour runs at s..s+L-1 (a runs-to-groups board)
//   rack   : D  = {s+L, cD}          one-ended  decoy   (extends cD's run, top)
//            Lo = {s-1, cH}          two-ended  herring (extends cH's run, bottom)
//            H  = {s+L, cH}          two-ended  herring (extends cH's run, top)
//            kColour supports at s, s+1 (cH's low run pulls cH from there) and
//            at s+L-3 (cC's run pulls cC from there)
//   goal   : run cD {s+L-2 .. s+L}      <- D's genuine home
//            run cH {s-1 .. s+1}        <- Lo's genuine home
//            run cH {s+L-2 .. s+L}      <- H's genuine home
//            run cC {s+L-3 .. s+L-1}    <- the run-only zone's third leg
//            one group per value s..s+L-3, colours per pullsAt() below
//
// THE COUPLING (why this is a chain, not two puzzles sharing a grid): cC's run
// {s+L-3..s+L-1} exists ONLY because cD and cH both vacate the high end. Take
// away either trap's short run and cC's tiles at those values need a group that
// no longer has three colours. So the two traps are load-bearing for each other
// through a single shared reorganisation of the high end — and, measured in the
// harness, resolving one correctly leaves the other's obvious move still a
// provable dead end (solveBag on the reduced bag), so no trap is defused by
// progress on the other.
//
// L >= 6 (measured): at L=5 the three kColour supports land on s, s+1, s+2 —
// three consecutive, a valid run on their own, breaking invariant (c) — and the
// decoy append is not yet a dead end. Verified directly in composed.verify.ts.
// ---------------------------------------------------------------------------

/** L per difficulty for the ORIGINAL composed puzzle. Hard/extreme ONLY. */
function composedParamsFor(diff: Difficulty): { L: number } | null {
  switch (diff) {
    case 'hard': return { L: 6 }
    case 'extreme': return { L: 7 }
    default: return null
  }
}

/**
 * `mirror` reflects the whole layout (the run-only zone moves to the low end).
 * `lowOnClean` puts the single opposite-end extender on the THIRD colour (the
 * one whose run fills the run-only zone) instead of on the herring colour — so
 * all three board colours carry a tempting tile.
 * `fillers` are offsets of extra kColour tiles among the pure-group values.
 */
export interface ComposedVariant { mirror: boolean; lowOnClean: boolean; fillers: number[] }

/**
 * Sizes and filler sets shipped per tier, all measured (GENERATOR_AUDIT.md).
 * Composed is the tightest of the three: L=6 and L=7 are unique only with NO
 * filler (L=7 {3} has 2 solutions), and L=8 is unique only WITH filler {3}
 * (no filler: 5-7 solutions and the third-colour low trap leaks; {4}: 2).
 */
const COMPOSED_SHIPPED: Partial<Record<Difficulty, { L: number; fillers: number[] }[]>> = {
  hard: [{ L: 6, fillers: [] }],
  extreme: [{ L: 7, fillers: [] }, { L: 8, fillers: [3] }],
}

/** Every shipped composed variant at this difficulty. */
export function composedVariants(diff: Difficulty): { L: number; variant: ComposedVariant }[] {
  return (COMPOSED_SHIPPED[diff] ?? []).flatMap(x =>
    [false, true].flatMap(mirror => [false, true].map(lowOnClean =>
      ({ L: x.L, variant: { mirror, lowOnClean, fillers: x.fillers } }))))
}

/** Superset of ArchetypeResult exposing everything the composition needs
 * verified: the tempting tiles, the trap sets, and the correct short runs used
 * to test cross-trap independence. */
export interface ComposedBuild extends ArchetypeResult {
  goal: Map<string, [number, number]>
  /** One-ended decoy tile, colour cD. */
  decoy: Tile
  /** The opposite-end extender (colour cH, or cC when `lowOnClean`). */
  lowExtender: Tile
  /** The second same-end extender, colour cH. */
  highExtender: Tile
  /** Committing cD's obvious append strands the rest. */
  trapDecoy: Tile[]
  /** Committing cH's obvious same-end append strands the rest. */
  trapHigh: Tile[]
  /** Committing the opposite-end extender's obvious append strands the rest. */
  trapLow: Tile[]
  /** Committing both of the last two strands the rest. */
  trapBoth: Tile[]
  /** cD's genuine short run — "the decoy trap, correctly resolved". */
  decoyResolved: Tile[]
  /** The other two genuine short runs — "the herring trap, correctly resolved". */
  herringResolved: Tile[]
  cDecoy: Tile['c']
  cHerring: Tile['c']
  cClean: Tile['c']
  s: number
  L: number
  variant: ComposedVariant
  witness: Drop[]
}

/** The ORIGINAL composed puzzle for this difficulty. */
export function buildComposed(diff: Difficulty): ComposedBuild | null {
  const p = composedParamsFor(diff)
  if (!p) return null
  return buildComposedAt(p.L)
}

/** A random shipped variant, optionally restricted (dev force types). */
export function buildComposedVariant(diff: Difficulty, only?: (v: ComposedVariant) => boolean): ComposedBuild | null {
  const pool = composedVariants(diff).filter(x => !only || only(x.variant))
  if (pool.length === 0) return null
  const pick = pickOne(pool)
  return buildComposedAt(pick.L, pick.variant)
}

/** L-parameterized composed core. With no variant it builds the original. */
export function buildComposedAt(L: number, variant?: ComposedVariant): ComposedBuild | null {
  return composedCore(L, variant).build
}

/** The named proof steps for one variant, up to and including the first failure. */
export function proveComposedAt(L: number, variant?: ComposedVariant): ProofLine[] {
  return composedCore(L, variant).proof
}

function composedCore(L: number, variantIn?: ComposedVariant): Proved<ComposedBuild> {
  const none: Proved<ComposedBuild> = { build: null, proof: [] }
  if (L < 6) return none // L=5: k supports would be 3-consecutive, and decoy append survives
  const variant = variantIn ?? { mirror: false, lowOnClean: false, fillers: [] }
  const F = variant.fillers

  // Offsets -1 and L are both used, whichever way round the block is read.
  const f = makeFrame(L, variant.mirror, true, true)
  if (!f) return none
  const s = f.s

  const colors = shuffle(ALL_COLORS)
  const boardColors = colors.slice(0, 3)
  const kColor = colors[3]
  const [cDecoy, cHerring, cClean] = shuffle(boardColors) as [Tile['c'], Tile['c'], Tile['c']]
  const cLow = variant.lowOnClean ? cClean : cHerring // colour of the opposite-end extender

  // Goal has 4 runs + (L-2) groups = L+2 windows, one per row.
  const rows = L + 2
  const cols = L + 3
  const grid = layRuns(f, boardColors, rows, cols)

  const decoy: Tile = makeTile(f.val(L), cDecoy)
  const lowExtender: Tile = makeTile(f.val(-1), cLow)
  const highExtender: Tile = makeTile(f.val(L), cHerring)
  const supports = [0, 1, L - 3] // cLow's short run vacates 0,1; cClean's run vacates L-3
  const rack: Tile[] = [decoy, lowExtender, highExtender, ...[...supports, ...F].map(o => makeTile(f.val(o), kColor))]
  const boardTiles = grid.flat().filter((t): t is Tile => t !== null)
  const allTiles = [...boardTiles, ...rack]

  const p = new Proof()
  // (c) is the check that rejects L=5, where the three supports are consecutive.
  proveInvariants(p, grid, rack, allTiles)

  // OBVIOUS x3: all three tempting tiles must read as plausible run-extensions.
  p.step('OBVIOUS the decoy visibly extends a board run', () => obviousSpots(grid, decoy).length > 0)
  p.step('OBVIOUS the opposite-end extender visibly extends a board run', () => obviousSpots(grid, lowExtender).length > 0)
  p.step('OBVIOUS the second same-end extender visibly extends a board run', () => obviousSpots(grid, highExtender).length > 0)

  // TRAP: every obvious append, and every combination of them, is a dead end.
  const isDecoyTrap = (t: Tile) => t.c === cDecoy
  const isHighTrap = (t: Tile) => t.c === cHerring && f.off(t) >= 0
  const isLowTrap = (t: Tile) => t.c === cLow && f.off(t) <= L - 1
  const isBothTrap = (t: Tile) => isHighTrap(t) || isLowTrap(t)
  p.step("TRAP the decoy's extension is a dead end", () => commitIsDead(allTiles, isDecoyTrap))
  p.step('TRAP the same-end extension is a dead end', () => commitIsDead(allTiles, isHighTrap))
  p.step('TRAP the opposite-end extension is a dead end', () => commitIsDead(allTiles, isLowTrap))
  p.step('TRAP both of those together are a dead end', () => commitIsDead(allTiles, isBothTrap))
  p.step('TRAP every combination of extensions is a dead end',
    () => everyCombinationDead(allTiles, [isDecoyTrap, isHighTrap, isLowTrap]))
  p.step('UNIQUE exactly one partition', () => partitionCount(allTiles, 2) === 1)

  // Deterministic hybrid goal — never planMixedGoal's factorial search. Four
  // short runs, then one group per pure-group value (offsets 0..L-3), ascending.
  const windows: WindowSpec[] = [
    runWindow(f, cDecoy, L - 2, L),
    runWindow(f, cLow, -1, 1),
    runWindow(f, cHerring, L - 2, L),
    runWindow(f, cClean, L - 3, L - 1),
  ]
  const groupOffsets = Array.from({ length: L - 2 }, (_, o) => o).sort((a, b) => f.val(a) - f.val(b))
  for (const o of groupOffsets) {
    // Which board colour has been pulled into a run at this value decides who
    // fills the group; kColour steps in at the supports and the fillers.
    const groupColors = [cDecoy, cHerring, cClean].filter(col => !(col === cLow && o <= 1) && !(col === cClean && o === L - 3))
    if (supports.includes(o) || F.includes(o)) groupColors.push(kColor)
    windows.push({ type: 'group', value: f.val(o), colors: groupColors })
  }

  const box: { res: ReturnType<typeof bindMinCostGoal> } = { res: null }
  p.step('HOME the hybrid goal is reached, valid, with a par witness', () => {
    box.res = bindMinCostGoal(windows, grid, rack, (wi, i) => [wi, 1 + i])
    return !!box.res && box.res.reachedGoal && box.res.validGoal
  })
  if (p.failed || !box.res) return { build: null, proof: p.lines }
  const done = box.res

  // Select the CONCRETE tiles from the bag rather than minting fresh ones, so the
  // reported spans carry the same ids (and objects) the grid/rack hold.
  const span = (col: Tile['c'], a: number, b: number): Tile[] =>
    allTiles.filter(t => t.c === col && f.off(t) >= a && f.off(t) <= b)
  return {
    proof: p.lines,
    build: {
      grid, rack: shuffle(rack), allTiles, minMoves: done.moves, goal: done.goal, witness: done.witness,
      decoy, lowExtender, highExtender,
      trapDecoy: allTiles.filter(isDecoyTrap),
      trapHigh: allTiles.filter(isHighTrap),
      trapLow: allTiles.filter(isLowTrap),
      trapBoth: allTiles.filter(isBothTrap),
      decoyResolved: span(cDecoy, L - 2, L),
      herringResolved: [...span(cLow, -1, 1), ...span(cHerring, L - 2, L)],
      cDecoy, cHerring, cClean, s, L, variant,
    },
  }
}

// ---------------------------------------------------------------------------
// CUT-POINT ARCHETYPE (m=2 Step 11) — the archetype the whole m=2 migration
// existed for. It is the FIRST construction that genuinely REQUIRES duplicate
// tiles: the board shows one already-valid run per colour, and the rack holds
// SECOND COPIES of interior values. The player must break each apparently
// finished run at the cut points, leaving every piece a valid run (length >= 3).
//
// Why this is a different puzzle from every other archetype here:
//   - The starting board is a set of COMPLETE, VALID runs. It looks finished.
//     There is nothing to "fill in" — obviousSpots() is 0 for every rack tile,
//     because a duplicate can never legally extend the run it duplicates.
//   - The only way to win is to DISMANTLE something that already validates.
//
// THREE MEASURED FACTS THAT FIX THE DESIGN (see cutpoint.verify.ts for output):
//
// 1. SPREAD, NEVER ADJACENT. With duplicates at d1<d2, the migration doc's
//    prototype found two solution shapes: adjacent (d2=d1+1) admits a TWO-run
//    answer, spread (d2>=d1+2) a THREE-run answer. Measured across L=8..13, the
//    adjacent shape is essentially NEVER uniquely solvable (0 unique instances
//    at every L>=10); the spread shape is. Only spread ships. This resolves the
//    doc's explicit "one archetype or two?" question by measurement: it is ONE
//    archetype, because the other shape is structurally inferior, not merely
//    different.
//
// 2. UNIQUENESS IS THE TRAP. A bag of ONE colour admits no group at all
//    (isValidGroup needs >=3 distinct colours), so every part of the answer is
//    a run — and a uniquely-partitionable bag therefore makes EVERY wrong cut
//    fatal: commit any run that is not one of the true parts and the remainder
//    is unsolvable. That is a stronger trap than decoy/red-herring/composed,
//    which each verify a handful of specific tempting commitments. The builder
//    gates on uniqueness; the harness proves the trap exhaustively over every
//    candidate run on real builds.
//
// 3. AT MOST TWO COLOUR BLOCKS — load-bearing, not a tuning knob. Two colours
//    can never form a group, so the bag stays runs-only and the whole puzzle's
//    solution count is the PRODUCT of the per-colour counts. A third colour
//    sharing values would make groups available, exploding the solution space
//    and destroying uniqueness (and with only 13 values, three blocks of the
//    length this needs cannot avoid sharing). buildCutPointAt REFUSES
//    blockCount > 2 rather than clamping it.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CHAIN ARCHETYPE — a DEDUCTIVE chain (m=1; duplicates deliberately not used).
//
// ***READ THIS BEFORE TOUCHING IT — a chain mechanic failed TWICE here before,
// and both failures came from the same misunderstanding.***
//
// The DELETED `buildDominoChain` modelled "placing tile A physically pushes
// tile B out of its set, which pushes C". That is impossible in this game, for
// two independent reasons, both re-confirmed by reading the code:
//   1. usePlayState's DROP reducer makes GRID→GRID an UNRESTRICTED SWAP between
//      ANY two cells. Nothing is ever physically blocked, so no move can ever
//      require another move first.
//   2. Its premise was a misread rule: it assumed a run maxes out at length 4,
//      so adding a tile would force one out. `isValidRun` has NO upper bound —
//      the 4-cap belongs to `isValidGroup` (4 colours). Nothing ever gets
//      pushed out. (It also punched holes in complete runs, so its starting
//      boards failed validateGrid outright.)
//
// THE CORRECT FRAMING, and what this archetype actually builds: the chain is
// DEDUCTIVE, not physical. The player may execute moves in any order; what is
// sequential is the REASONING. You cannot work out where a tile belongs until
// you have worked out where an earlier one belongs.
//
// ***A THEOREM THAT CONSTRAINS THE WHOLE DESIGN (probed, not assumed):*** if a
// bag has a UNIQUE partition, then a globally-reasoning solver determines every
// tile's block in ONE step — any second globally-consistent block for a tile
// would itself extend to a complete partition, i.e. a second partition. So
// depth is always 1 under global reasoning, and a chain CANNOT be defined that
// way. The chain therefore lives in the LOCAL (myopic) model: a tile is
// determined when exactly ONE valid set containing it can still be formed from
// the remaining bag, ignoring whether the remainder stays solvable. That is how
// a player actually reasons ("where can this tile even go?"), it is fully
// computable, and — because the true partition is always among the locally
// possible ones — a locally-forced deduction is always CORRECT.
//
// THE LADDER. Alternating run → group, where each block consumes a HINGE tile
// that collapses the next block's options:
//     run(c0 over [s..s+2]) → group at s+2 → run(c1 over [s+3..s+5]) → ...
// Each run colour also owns a tile at the PREVIOUS hinge; that extra tile is
// what keeps its run ambiguous until the group there consumes it. Measured:
// links=4 gives 24 tiles, a UNIQUE partition, and a local cascade of DEPTH 8
// with 7 genuine steps (a step is genuine only when the tile it determines had
// ≥2 candidates at move zero — otherwise it was obvious from the start).
//
// KNOWN LIMITATION, stated plainly: par understates this archetype badly. A
// legal starting board is necessarily "close" to the goal (board rows are valid
// sets, and valid arrangements of these tiles are largely the goal blocks ±
// their hinge tile), so `fixed` is high and par lands at 9 — the same
// structural low-par wall the cut-point archetype hit. Difficulty here is
// reasoning DEPTH, not move count.
// ---------------------------------------------------------------------------

/** L per difficulty. `links` is the number of run→group rungs. links=4 is the
 * deepest the 13-value range allows (hinges 3 apart, last hinge ≤ 13). */
function chainParamsFor(diff: Difficulty): { links: number } | null {
  switch (diff) {
    case 'medium': return { links: 4 }
    default: return null
  }
}

export interface ChainBuild extends ArchetypeResult {
  goal: Map<string, [number, number]>
  /** The unique partition, in ladder order (run, group, run, group, …). */
  blocks: Tile[][]
  hinges: number[]
  runCols: Tile['c'][]
  witness: Drop[]
}

export function buildChain(diff: Difficulty): ChainBuild | null {
  const p = chainParamsFor(diff)
  if (!p) return null
  return buildChainAt(p.links)
}

/**
 * `mirror` reflects the ladder, so it descends: the first run sits at the top
 * of the value range and each hinge is BELOW its run. `rowOrder` permutes the
 * board rows (indices into the default order: the runs in ladder order, then
 * the final group). Mirror changes which tiles exist; row order is layout only
 * — it hides where the ladder starts, it does not change the deduction.
 */
export interface ChainVariant { mirror: boolean; rowOrder?: number[] }

/** A random shipped variant: either direction, board rows in random order. */
export function buildChainVariant(diff: Difficulty, only?: (v: ChainVariant) => boolean): ChainBuild | null {
  const p = chainParamsFor(diff)
  if (!p) return null
  const pool = [false, true].map(mirror => ({ mirror })).filter(v => !only || only(v))
  if (pool.length === 0) return null
  const rowOrder = shuffle(Array.from({ length: p.links + 1 }, (_, i) => i))
  return buildChainAt(p.links, undefined, undefined, { mirror: pickOne(pool).mirror, rowOrder })
}

/** links-parameterized chain core, exported for verification. */
export function buildChainAt(links: number, startIn?: number, colsIn?: Tile['c'][], variant?: ChainVariant): ChainBuild | null {
  if (links < 2 || links > 4) return null // 4 colours, and hinges are 3 apart
  const runCols = (colsIn ?? shuffle(ALL_COLORS)).slice(0, links)
  if (new Set(runCols).size !== links) return null
  // last hinge = start + 2 + 3*(links-1) must fit in 1..13
  const maxStart = 13 - (2 + 3 * (links - 1))
  if (maxStart < 1) return null
  const s = startIn ?? randomInt(1, maxStart)
  if (s < 1 || s > maxStart) return null

  const blocks: Tile[][] = []
  const hinges: number[] = []
  const used = new Set<string>()
  const claim = (ts: Tile[]): boolean => {
    for (const t of ts) if (used.has(`${t.n}_${t.c}`)) return false
    ts.forEach(t => used.add(`${t.n}_${t.c}`))
    blocks.push(ts)
    return true
  }

  if (!claim([0, 1, 2].map(o => makeTile(s + o, runCols[0])))) return null
  hinges.push(s + 2)
  for (let i = 1; i < links; i++) {
    const h = hinges[i - 1]
    // group at h = the three colours OTHER than the one that just ran into h.
    // The next run colour is one of them, so its hinge tile sits in this group —
    // that is exactly what delays the next run's determination.
    const groupCols = ALL_COLORS.filter(c => c !== runCols[i - 1])
    if (!groupCols.includes(runCols[i])) return null
    if (!claim(groupCols.map(c => makeTile(h, c)))) return null
    if (!claim([1, 2, 3].map(o => makeTile(h + o, runCols[i])))) return null
    hinges.push(h + 3)
  }
  const lastH = hinges[hinges.length - 1]
  if (!claim(ALL_COLORS.filter(c => c !== runCols[links - 1]).map(c => makeTile(lastH, c)))) return null

  // MIRROR: reflect every value about the middle of the ladder. Runs stay runs
  // and groups stay groups, so the partition is the same partition read
  // downwards — but the gates below are still run on the reflected bag.
  if (variant?.mirror) {
    const span = s + lastH
    for (let i = 0; i < blocks.length; i++)
      blocks[i] = blocks[i].map(t => makeTile(span - t.n, t.c)).sort((a, b) => a.n - b.n)
    for (let i = 0; i < hinges.length; i++) hinges[i] = span - hinges[i]
  }

  // ---- the board: every run block EXTENDED by its hinge tile (a longer, still
  // valid run — this is what hides the ladder), plus the FINAL group as a row.
  // The final group must sit on the board: left in the rack it would be a valid
  // set on its own and break invariant (c).
  const isRun = (b: Tile[]) => b.every(t => t.c === b[0].c)
  const boardRows: Tile[][] = []
  const onBoard = new Set<string>()
  for (const b of blocks) {
    if (!isRun(b)) continue
    const c = b[0].c
    const lo = Math.min(...b.map(t => t.n))
    const hi = Math.max(...b.map(t => t.n))
    // The hinge is the one same-colour tile touching the run: below it on the
    // ascending ladder, above it on the mirrored one.
    const hinge = blocks.flat().find(t => t.c === c && (t.n === lo - 1 || t.n === hi + 1))
    const row = hinge ? [hinge, ...b].sort((x, y) => x.n - y.n) : [...b]
    if (!isValidRun(row)) return null
    boardRows.push(row)
    row.forEach(t => onBoard.add(`${t.n}_${t.c}`))
  }
  const finalGroup = blocks[blocks.length - 1]
  if (finalGroup.some(t => onBoard.has(`${t.n}_${t.c}`))) return null
  boardRows.push(finalGroup)
  finalGroup.forEach(t => onBoard.add(`${t.n}_${t.c}`))

  // ROW ORDER: every row still starts at column 1; only which row is which moves.
  if (variant?.rowOrder) {
    const order = variant.rowOrder
    if (order.length !== boardRows.length || new Set(order).size !== order.length || order.some(i => !boardRows[i])) return null
    const original = [...boardRows]
    order.forEach((from, to) => { boardRows[to] = original[from] })
  }

  const allTiles = blocks.flat()
  const rack = allTiles.filter(t => !onBoard.has(`${t.n}_${t.c}`))

  // ---- the defining gates, in the order that fails cheapest first
  if (chainPartitionCount(allTiles, 2) !== 1) return null           // must be UNIQUE
  const chain = localChainDepth(allTiles)
  if (chain.stalled) return null                                    // must be fully solvable by local reasoning
  if (chain.depth < 2 * links) return null                          // the ladder's full depth
  if (chain.genuine < 2 * links - 1) return null                    // and genuinely non-obvious steps

  const freshRows = blocks.filter(b => !isRun(b)).length - 1        // final group is on the board
  const rows = 1 + boardRows.length + freshRows + 1
  const cols = Math.max(...boardRows.map(r => r.length)) + 2
  const grid: Grid = Array.from({ length: rows }, () => Array(cols).fill(null))
  boardRows.forEach((row, r) => row.forEach((t, i) => { grid[1 + r][1 + i] = t }))

  if (!validateGrid(grid)) return null                              // (a)
  if (formsValidSetAlone(rack)) return null                         // (c)
  if (!solveBagM2(allTiles).solvable) return null                   // (b)
  const search = existsNoRelocationWin(grid, rack)
  if (search.win || search.exhausted) return null                   // (d)

  // ---- goal layout: every block that already sits contiguously on a board row
  // keeps those cells; the remaining groups are assembled on fresh rows.
  const windows: WindowSpec[] = blocks.map(b => isRun(b)
    ? { type: 'run', color: b[0].c, start: Math.min(...b.map(t => t.n)), length: b.length }
    : { type: 'group', value: b[0].n, colors: b.map(t => t.c) })
  const cells: [number, number][][] = []
  let fresh = boardRows.length
  for (const b of blocks) {
    const rowIdx = boardRows.findIndex(row => b.every(t => row.some(x => x.n === t.n && x.c === t.c)))
    if (rowIdx >= 0) {
      const row = boardRows[rowIdx]
      const off = row.findIndex(t => t.n === b[0].n && t.c === b[0].c)
      cells.push(b.map((_, i): [number, number] => [1 + rowIdx, 1 + off + i]))
    } else {
      const r = ++fresh
      cells.push(b.map((_, i): [number, number] => [r, 1 + i]))
    }
  }
  const res = bindMinCostGoal(windows, grid, rack, (wi, i) => cells[wi][i])
  if (!res || !res.reachedGoal || !res.validGoal) return null       // (e)

  return { grid, rack, allTiles, minMoves: res.moves, goal: res.goal, witness: res.witness, blocks, hinges, runCols }
}

/** Every valid set (run or group) inside `bag` containing `t`. m=1 only — the
 * chain archetype builds no duplicates, so a (value,colour) map is exact. */
function chainCandidateBlocks(bag: Tile[], t: Tile): Tile[][] {
  const out: Tile[][] = []
  const sameColour = new Map<number, Tile>()
  for (const x of bag) if (x.c === t.c) sameColour.set(x.n, x)
  let lo = t.n; while (sameColour.has(lo - 1)) lo--
  let hi = t.n; while (sameColour.has(hi + 1)) hi++
  for (let a = lo; a <= t.n; a++) for (let b = t.n; b <= hi; b++) {
    if (b - a + 1 < 3) continue
    const run: Tile[] = []
    for (let v = a; v <= b; v++) run.push(sameColour.get(v)!)
    if (isValidRun(run)) out.push(run)
  }
  const others = bag.filter(x => x.n === t.n && x.c !== t.c)
  for (const size of [2, 3]) {
    for (const rest of combinations(others, size)) {
      const g = [t, ...rest]
      if (isValidGroup(g)) out.push(g)
    }
  }
  return out
}

const chainWithout = (bag: Tile[], block: Tile[]): Tile[] => {
  const ids = new Set(block.map(t => `${t.n}_${t.c}`))
  return bag.filter(x => !ids.has(`${x.n}_${x.c}`))
}

/** Number of distinct run/group partitions, capped (we only need "exactly 1"). */
function chainPartitionCount(bag: Tile[], cap = 2): number {
  let found = 0
  const rec = (rest: Tile[]) => {
    if (found >= cap) return
    if (rest.length === 0) { found++; return }
    for (const b of chainCandidateBlocks(rest, rest[0])) {
      rec(chainWithout(rest, b))
      if (found >= cap) return
    }
  }
  rec(bag)
  return found
}

/**
 * The LOCAL (myopic) deduction cascade. Each round, every tile with exactly ONE
 * remaining candidate set is determined and its block committed; removing those
 * tiles is what unlocks the next round. `genuine` counts rounds after the first
 * that determined at least one tile which had ≥2 candidates at move zero — a
 * round that only resolves already-obvious tiles is not a chain link.
 */
function localChainDepth(bag: Tile[]): { depth: number; stalled: boolean; genuine: number } {
  const initial = new Map<string, number>()
  for (const t of bag) initial.set(`${t.n}_${t.c}`, chainCandidateBlocks(bag, t).length)
  let rest = [...bag]
  const rounds: number[][] = []
  let guard = 0
  while (rest.length > 0 && guard++ < 60) {
    const forced: Tile[][] = []
    const amb: number[] = []
    for (const t of rest) {
      const c = chainCandidateBlocks(rest, t)
      if (c.length === 1) { forced.push(c[0]); amb.push(initial.get(`${t.n}_${t.c}`)!) }
    }
    const genuineOf = (rs: number[][]) => rs.slice(1).filter(r => r.some(n => n >= 2)).length
    if (forced.length === 0) return { depth: rounds.length, stalled: true, genuine: genuineOf(rounds) }
    const rm = new Set<string>()
    for (const b of forced) for (const x of b) rm.add(`${x.n}_${x.c}`)
    rounds.push(amb)
    rest = rest.filter(x => !rm.has(`${x.n}_${x.c}`))
  }
  return { depth: rounds.length, stalled: false, genuine: rounds.slice(1).filter(r => r.some(n => n >= 2)).length }
}

/**
 * Cut offsets (1-based, relative to the run's first value) that are UNIQUELY
 * solvable AND hit the target par, per run length L. Verified exhaustively by
 * cutpoint.verify.ts, which re-derives uniqueness with its own independent
 * partitioner rather than trusting this table.
 *
 * L is capped at 10 by the UI, not by the maths: Board.tsx renders a fixed
 * `repeat(cols, 46px)` grid with no responsive scaling, so cols = L+2 = 12 is
 * already the widest board this game has shipped (650px, vs 546px previously).
 * Longer runs verify clean and reach higher par — L=13/k=3 gives par 8 per
 * block, and two such blocks would reach par 16 — but they need 15-16 columns
 * (~860px) and would overflow. Revisit only alongside a responsive Board.
 */
const CUTPOINT_TUPLES: Record<number, number[][]> = {
  10: [[3, 5, 7], [3, 5, 8], [3, 6, 8], [4, 6, 8]],
}

/**
 * How many distinct run-partitions does this single-colour value multiset
 * admit? Stops as soon as `cap` is reached — the builder only ever needs
 * "exactly one or more than one", so this never enumerates the full space.
 */
function countRunPartitions(values: number[], cap = 2): number {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let found = 0
  const recurse = (): boolean => {
    let lo = Infinity
    for (const [v, n] of counts) if (n > 0 && v < lo) lo = v
    if (lo === Infinity) { found++; return found >= cap }
    // The smallest remaining value must start its run — nothing below it exists.
    for (let len = 3; ; len++) {
      let ok = true
      for (let i = 0; i < len; i++) if ((counts.get(lo + i) ?? 0) <= 0) { ok = false; break }
      if (!ok) break
      for (let i = 0; i < len; i++) counts.set(lo + i, counts.get(lo + i)! - 1)
      const stop = recurse()
      for (let i = 0; i < len; i++) counts.set(lo + i, counts.get(lo + i)! + 1)
      if (stop) return true
    }
    return false
  }
  recurse()
  return found
}

/**
 * Which pieces keep their board cells. Consecutive pieces SHARE the duplicated
 * column (piece i ends on the value piece i+1 starts on), so no two adjacent
 * pieces can both stay — the cheapest layout is a maximum-weight independent
 * set on a path, weights = piece lengths. Solved exactly by DP, so par is
 * deterministic. Non-adjacent kept pieces are always separated by >=1 empty
 * column (cuts are >=2 apart), so each stays its own valid row segment.
 */
function maxWeightKeep(lens: number[]): number[] {
  const n = lens.length
  const dp = new Array<number>(n + 2).fill(0)
  for (let i = n - 1; i >= 0; i--) dp[i] = Math.max(dp[i + 1], lens[i] + dp[i + 2])
  const keep: number[] = []
  for (let i = 0; i < n;) {
    if (lens[i] + dp[i + 2] >= dp[i + 1]) { keep.push(i); i += 2 } else i++
  }
  return keep
}

export interface CutPointBlock { color: Tile['c']; s: number; L: number; cuts: number[] }

export interface CutPointBuild extends ArchetypeResult {
  goal: Map<string, [number, number]>
  blocks: CutPointBlock[]
  /** Per block, the value-intervals of the unique correct partition. */
  pieces: [number, number][][]
}

/** Cut-point puzzles ship at MEDIUM only — see the par discussion in CLAUDE.md.
 * par is 12 here against medium's base 16; hard/extreme are structurally out of
 * reach (they would need 3+ colour blocks, which destroys uniqueness). */
function cutPointParamsFor(diff: Difficulty): { L: number; blocks: number } | null {
  switch (diff) {
    case 'medium': return { L: 10, blocks: 2 }
    default: return null
  }
}

export function buildCutPoint(diff: Difficulty): CutPointBuild | null {
  const p = cutPointParamsFor(diff)
  if (!p) return null
  return buildCutPointAt(p.L, p.blocks)
}

/** L/blockCount-parameterized cut-point core, exported for verification. */
export function buildCutPointAt(L: number, blockCount: number): CutPointBuild | null {
  const tuples = CUTPOINT_TUPLES[L]
  // blockCount > 2 is REFUSED, not clamped: a third colour at shared values
  // makes groups possible, which voids the uniqueness argument this whole
  // archetype's trap rests on. See fact 3 above.
  if (!tuples || blockCount < 1 || blockCount > 2) return null
  if (L > 13 || L < 5) return null

  const colors = shuffle(ALL_COLORS).slice(0, blockCount)
  const blocks: CutPointBlock[] = colors.map(color => {
    const s = randomInt(1, 13 - L + 1)
    const offsets = tuples[randomInt(0, tuples.length - 1)]
    return { color, s, L, cuts: offsets.map(o => s + o - 1) }
  })

  // Per block: the pieces of the intended partition, and which of them stay put.
  const plans = blocks.map(b => {
    const pieces: [number, number][] = []
    let prev = b.s
    for (const c of b.cuts) { pieces.push([prev, c]); prev = c }
    pieces.push([prev, b.s + b.L - 1])
    const lens = pieces.map(([a, z]) => z - a + 1)
    return { b, pieces, keep: maxWeightKeep(lens) }
  })

  // THE GATE THIS ARCHETYPE LIVES OR DIES ON: each colour must admit EXACTLY
  // one run-partition. Two colours cannot interact (no group is possible), so
  // the whole puzzle's solution count is the product — and must also be 1.
  for (const plan of plans) {
    const values = [
      ...Array.from({ length: plan.b.L }, (_, i) => plan.b.s + i),
      ...plan.b.cuts,
    ]
    if (countRunPartitions(values, 2) !== 1) return null
  }

  const rebuiltCount = plans.reduce((n, plan) => n + (plan.pieces.length - plan.keep.length), 0)
  const rows = 1 + blockCount + rebuiltCount + 1
  const cols = L + 2

  const grid: Grid = Array.from({ length: rows }, () => Array(cols).fill(null))
  plans.forEach((plan, bi) => {
    for (let o = 0; o < L; o++) grid[1 + bi][1 + o] = makeTile(plan.b.s + o, plan.b.color, 0)
  })

  // (a) every board row is a complete, already-valid run.
  if (!validateGrid(grid)) return null

  const rack: Tile[] = []
  for (const plan of plans) for (const c of plan.b.cuts) rack.push(makeTile(c, plan.b.color, 1))

  // (c) the rack is not a puzzle on its own. Cuts are >=2 apart so no three
  // rack values are consecutive, and 2 colours can never form a group.
  if (formsValidSetAlone(rack)) return null

  const boardTiles = grid.flat().filter((t): t is Tile => t !== null)
  const allTiles = [...boardTiles, ...rack]

  // (b) board + rack really is partitionable.
  if (!solveBagM2(allTiles).solvable) return null

  // (d) the obvious move must fail. Here that is stronger than usual: no rack
  // tile has ANY tempting board placement, since a duplicate cannot extend the
  // run it duplicates. Searched exhaustively rather than argued.
  const search = existsNoRelocationWin(grid, rack)
  if (search.win || search.exhausted) return null

  // Goal layout: kept pieces hold their board cells (gaps open between them);
  // every other piece is rebuilt on its own fresh row.
  const windows: WindowSpec[] = []
  const cells: [number, number][][] = []
  let freshRow = 1 + blockCount
  plans.forEach((plan, bi) => {
    plan.pieces.forEach(([a, z], pi) => {
      windows.push({ type: 'run', color: plan.b.color, start: a, length: z - a + 1 })
      if (plan.keep.includes(pi)) {
        cells.push(Array.from({ length: z - a + 1 }, (_, i): [number, number] => [1 + bi, 1 + (a - plan.b.s) + i]))
      } else {
        const r = freshRow++
        cells.push(Array.from({ length: z - a + 1 }, (_, i): [number, number] => [r, 1 + i]))
      }
    })
  })

  // (e) par + witness. Every duplicated value has one copy on the board and one
  // in the rack, so this is the first SHIPPED archetype where Step 6b's pairing
  // minimisation does real work — it decides which copy keeps the board cell.
  const res = bindMinCostGoal(windows, grid, rack, (wi, i) => cells[wi][i])
  if (!res || !res.reachedGoal || !res.validGoal) return null

  return {
    grid,
    rack,
    allTiles,
    minMoves: res.moves,
    goal: res.goal,
    blocks,
    pieces: plans.map(plan => plan.pieces),
  }
}

// ---------------------------------------------------------------------------
// mixedGoalPlanner.ts — goal planning for MIXED final layouts.
//
// The existing planners (planColorRunGoal / planValueGroupGoal in archetypes.ts)
// each represent one PURE goal shape: EVERY destination row is a run, or EVERY
// row is a group. Three independent design briefs (DECOY_DESIGN.md,
// COUPLED_DESIGN.md, RED_HERRING_DESIGN.md) all hit the same wall — the genuinely
// interesting puzzles need a HYBRID final layout: some rows are runs (a colour,
// consecutive values), others are groups (a value, distinct colours), together
// in one solution.
//
// THE CRUX CLAIM this file rests on: the proven move-cost model
//     cost(goal) = totalTiles − fixed(goal) − cycles(goal)
// (makeCostCtx in archetypes.ts, verified against real move-BFS on 250+ instances
// in a prior session) does NOT depend on the destination windows sharing a type.
// Its graph argument uses only that each tile has exactly one current location
// and one target CELL, giving a functional graph of disjoint paths and cycles
// (cell out-degree ≤ 1, target-cell in-degree ≤ 1). Window shape never enters it.
// So the same formula scores an injective tile→cell goal whether the cells spell
// runs, groups, or any mixture. mixedGoalPlanner.verify.ts confirms this
// empirically against unrestricted move-BFS, including cycles that pass through
// both a run window and a group window.
//
// This file is deliberately STANDALONE (no import from archetypes.ts) so it can
// be upgraded independently as decoy / coupled / red-herring modifiers adopt it.
// The move model it targets is usePlayState.ts's DROP reducer, re-read at build
// time: RACK→GRID (displaced tile → rack), GRID→GRID onto an occupied cell SWAPS
// in one move, GRID→GRID onto empty relocates in one move.
// ---------------------------------------------------------------------------

import type { Tile, Grid } from '../types'
import { makeTile, TILE_COPIES } from '../types'
import { isValidRun, isValidGroup, validateGrid } from './validator'
import { solveBagM2 } from './solver'

export type WindowSpec =
  | { type: 'run'; color: Tile['c']; start: number; length: number }
  | { type: 'group'; value: number; colors: Tile['c'][] }

/** A window placed on the grid: its leftmost cell is (row, col); tiles fill
 * col..col+len-1 left to right, in the order `windowTiles` returns. */
export interface PlacedWindow {
  spec: WindowSpec
  row: number
  col: number
}

export type Drop =
  | { from: 'grid'; r: number; c: number; tr: number; tc: number }
  | { from: 'rack'; key: string; tr: number; tc: number }

// ---------------------------------------------------------------------------
// TWO distinct keys, because m=2 forces them apart (Step 4 of MIGRATION_M2.md):
//
//  • `tileKey` = the tile's STABLE id (`${n}_${c}_${copy}`). This is the key for
//    every CONCRETE-tile path: the goal cell map, the reducer/witness, the cost
//    graph. Two copies of a (value,colour) have different ids, so they map to
//    different cells and are moved independently — exactly what m=2 needs and
//    what the old `${n}_${c}` key silently collided.
//
//  • `labelKey` = `${n}_${c}` (value+colour, copy-agnostic). This keys the
//    SPEC-level multiset in `windowsPartitionBag`: a window spec says "red 4",
//    which is a (value,colour) demand, not a demand for a specific copy. Feasi-
//    bility is a multiset question ("do the windows' (value,colour) demands match
//    the bag's (value,colour) supply, ≤ TILE_COPIES each?"); binding a spec slot
//    to a SPECIFIC copy id is a separate step handled by `bindWindowTiles`.
// ---------------------------------------------------------------------------
export const tileKey = (t: Tile): string => t.id
const labelKey = (t: { n: number; c: Tile['c'] }): string => `${t.n}_${t.c}`

/** The (value,colour) SPEC slots a window contains, left-to-right in placed
 * column order. These are minted at copy 0 for validation and length only; they
 * are NOT the concrete tiles that fill the goal — under m=2 the goal must bind to
 * the real copy ids present in the bag, which is `bindWindowTiles`' job, NOT this
 * function's. (A caller that keys a goal map off `windowTiles` directly would
 * silently pin every slot to copy 0 — the exact "whichever is first" trap the
 * migration warns about. Route goal binding through `bindWindowTiles`.) */
export function windowTiles(w: WindowSpec): Tile[] {
  if (w.type === 'run') {
    const out: Tile[] = []
    for (let i = 0; i < w.length; i++) out.push(makeTile(w.start + i, w.color))
    return out
  }
  return w.colors.map(c => makeTile(w.value, c))
}

// ---------------------------------------------------------------------------
// Resolver (Step 4): bind each window's ordered spec slots to CONCRETE tiles
// drawn from `bag` (grid+rack), by (value,colour). Returns, per window, the
// concrete Tile[] (real ids) in column order — it NEVER mints a fresh id.
//
// AMBIGUITY — the subtle part the doc warns about. When a (value,colour) has two
// copies in the bag (m=2) and both are demanded, which copy fills which window is
// a genuine choice (a single window never repeats a (value,colour): runs have
// distinct values, groups distinct colours — so the two copies always land in two
// DIFFERENT windows). This resolver's rule is DELIBERATE and DETERMINISTIC:
//
//   Default (design (b)): consume copies of a label in ASCENDING id order,
//   in window-encounter order (windows left→right, slots left→right). Because the
//   pool bucket is explicitly sorted by id, the choice depends ONLY on tile ids —
//   never on Map iteration order or grid-scan order. It is safe in the sense that
//   MATTERS for Step 4: it always yields a VALID injective binding (every concrete
//   tile bound to exactly one slot, no collisions) whose move cost `mixedLayoutMoves`
//   then computes exactly (verified === move-BFS for that binding). It does NOT
//   claim to be the MIN-cost pairing when a duplicate has a copy already on the
//   board — choosing the cheapest pairing is Step 6's minimisation, which drives
//   this resolver via `pinned` to enumerate the 2^d candidate pairings.
//
//   Override (design (a)): pass `pinned` mapping a labelKey to an explicit ordered
//   list of ids; those ids fill that label's demand in the given order, ahead of
//   the ascending-id default. This lets a caller pin exactly which copy goes to
//   which window rather than accept the default.
//
// Returns null if a window demands a (value,colour) the bag cannot supply.
// ---------------------------------------------------------------------------
export function bindWindowTiles(windows: WindowSpec[], bag: Tile[], pinned?: Map<string, string[]>): Tile[][] | null {
  const pool = new Map<string, Tile[]>()
  for (const t of bag) {
    const k = labelKey(t)
    const arr = pool.get(k)
    if (arr) arr.push(t)
    else pool.set(k, [t])
  }
  // Deterministic tie-break: ascending id within each (value,colour) bucket.
  for (const arr of pool.values()) arr.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  if (pinned) {
    for (const [k, ids] of pinned) {
      const arr = pool.get(k)
      if (!arr) return null
      const byId = new Map(arr.map(t => [t.id, t]))
      const picked: Tile[] = []
      for (const id of ids) {
        const t = byId.get(id)
        if (!t) return null
        picked.push(t)
        byId.delete(id)
      }
      pool.set(k, [...picked, ...byId.values()])
    }
  }

  const cursor = new Map<string, number>()
  const out: Tile[][] = []
  for (const w of windows) {
    const row: Tile[] = []
    for (const slot of windowTiles(w)) {
      const k = labelKey(slot)
      const arr = pool.get(k) ?? []
      const i = cursor.get(k) ?? 0
      if (i >= arr.length) return null
      row.push(arr[i])
      cursor.set(k, i + 1)
    }
    out.push(row)
  }
  return out
}

function windowIsValid(w: WindowSpec): boolean {
  const tiles = windowTiles(w)
  if (w.type === 'run') {
    if (w.length < 3 || w.length > 13) return false
    if (w.start < 1 || w.start + w.length - 1 > 13) return false
    return isValidRun(tiles)
  }
  if (new Set(w.colors).size !== w.colors.length) return false
  return isValidGroup(tiles)
}

// ---------------------------------------------------------------------------
// Feasibility: do the given windows form a valid, complete, duplicate-free
// partition of the current board + rack? Bag-level solvability is delegated to
// solveBag as the brief suggested; the windows are then confirmed to BE one such
// partition (every tile placed exactly once, each window a valid set).
// ---------------------------------------------------------------------------
export interface Feasibility {
  feasible: boolean
  reason?: string
}

export function windowsPartitionBag(currentGrid: Grid, rack: Tile[], windows: WindowSpec[]): Feasibility {
  const bag: Tile[] = [...currentGrid.flat().filter((t): t is Tile => t !== null), ...rack]

  for (const w of windows) if (!windowIsValid(w)) return { feasible: false, reason: `invalid window ${JSON.stringify(w)}` }

  // Supply: how many copies of each (value,colour) the bag holds. m=2 allows up
  // to TILE_COPIES; a COUNT check (was a presence check that rejected any repeat).
  const supply = new Map<string, number>()
  for (const t of bag) supply.set(labelKey(t), (supply.get(labelKey(t)) ?? 0) + 1)
  for (const [k, count] of supply) {
    if (count > TILE_COPIES) return { feasible: false, reason: `(value,colour) ${k} appears ${count}× in bag, > TILE_COPIES(${TILE_COPIES})` }
  }

  // Demand: how many slots the windows ask for of each (value,colour). A single
  // window never repeats a (value,colour), so demand > 1 for a label simply means
  // two different windows each want a copy — legal under m=2 when supply matches.
  const demand = new Map<string, number>()
  for (const w of windows) for (const t of windowTiles(w)) {
    const k = labelKey(t)
    demand.set(k, (demand.get(k) ?? 0) + 1)
  }

  // Exact multiset match: every window slot backed by a bag copy, every bag copy
  // claimed by exactly one slot.
  for (const [k, d] of demand) {
    const s = supply.get(k) ?? 0
    if (d > s) return { feasible: false, reason: `windows demand ${d}× ${k} but bag has ${s}` }
  }
  for (const [k, s] of supply) {
    const d = demand.get(k) ?? 0
    if (d !== s) return { feasible: false, reason: `bag has ${s}× ${k} but windows cover ${d}` }
  }

  // Concrete bindability: the resolver must place every copy on a distinct window
  // slot (a stronger check than the multiset match — it exercises the id binding).
  if (!bindWindowTiles(windows, bag)) return { feasible: false, reason: 'windows are not concretely bindable to the bag tiles' }

  // Sanity: a valid partition into valid sets means the bag is solvable. Uses
  // solveBagM2 (Step 2) rather than the m=1 solveBag — required so a genuine
  // duplicate-bearing bag (which m=1 solveBag rejects outright) can pass. On
  // duplicate-free bags solveBagM2 agrees with solveBag (Step 10 probe: 5,400
  // bags, 0 mismatches), so m=1 feasibility verdicts are unchanged.
  if (!solveBagM2(bag).solvable) return { feasible: false, reason: 'solveBagM2 says bag is not partitionable' }

  return { feasible: true }
}

// ---------------------------------------------------------------------------
// Core: exact move count + concrete witness for a CONCRETE goal layout
// (tileKey → [row, col]). Shape-agnostic — this is the whole point.
// ---------------------------------------------------------------------------
export interface MoveResult {
  moves: number
  fixed: number
  cycles: number
  witness: Drop[]
  /** Witness executed under faithful reducer semantics lands every tile on its
   * goal cell with an empty rack. If false, the witness generator is buggy. */
  reachedGoal: boolean
  /** validateGrid of the goal layout (a real win, not just a permutation). */
  validGoal: boolean
}

/** Analytic cost via the functional-graph argument, mirroring makeCostCtx. */
function analyticCost(boardCells: number[], goalCells: number[], rackCount: number): { moves: number; fixed: number; cycles: number } {
  const n = boardCells.length
  const occupant = new Map<number, number>()
  for (let i = 0; i < n; i++) occupant.set(boardCells[i], i)

  const mark = new Uint8Array(n) // 0 unseen, 1 on-walk, 2 retired, 3 fixed
  let fixed = 0
  for (let i = 0; i < n; i++) if (boardCells[i] === goalCells[i]) { fixed++; mark[i] = 3 }

  let cycles = 0
  const walk = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    if (mark[i] !== 0) continue
    let len = 0
    let cur = i
    while (cur !== -1 && mark[cur] === 0) {
      mark[cur] = 1
      walk[len++] = cur
      const nextCell = goalCells[cur]
      cur = occupant.has(nextCell) ? occupant.get(nextCell)! : -1
    }
    if (cur !== -1 && mark[cur] === 1) cycles++
    for (let w = 0; w < len; w++) mark[walk[w]] = 2
  }

  return { moves: n + rackCount - fixed - cycles, fixed, cycles }
}

/** Faithful transcription of usePlayState's DROP reducer, for building/replaying
 * a witness. GRID→GRID onto occupied swaps; RACK→GRID displaced → rack. */
function applyDrop(grid: Grid, rack: Tile[], d: Drop): void {
  if (d.from === 'rack') {
    // d.key is a concrete tile id, so this finds the SPECIFIC copy even when the
    // rack holds both copies of a duplicate (the old ${n}_${c} key could not).
    const idx = rack.findIndex(t => tileKey(t) === d.key)
    const tile = rack[idx]
    rack.splice(idx, 1)
    const displaced = grid[d.tr][d.tc]
    grid[d.tr][d.tc] = tile
    if (displaced) rack.push(displaced)
  } else {
    const tile = grid[d.r][d.c]
    grid[d.r][d.c] = grid[d.tr][d.tc]
    grid[d.tr][d.tc] = tile
  }
}

export function mixedLayoutMoves(currentGrid: Grid, rack: Tile[], goal: Map<string, [number, number]>): MoveResult | null {
  const curRows = currentGrid.length
  const curCols = currentGrid[0]?.length ?? 0
  if (curRows === 0 || curCols === 0) return null

  let maxR = curRows - 1
  let maxC = curCols - 1
  for (const [r, c] of goal.values()) { maxR = Math.max(maxR, r); maxC = Math.max(maxC, c) }
  const cols = maxC + 1
  const rows = maxR + 1
  const flat = (r: number, c: number) => r * cols + c

  // Board tiles at their current cells.
  const boardKeys: string[] = []
  const boardCells: number[] = []
  for (let r = 0; r < curRows; r++)
    for (let c = 0; c < curCols; c++) {
      const t = currentGrid[r][c]
      if (t) { boardKeys.push(tileKey(t)); boardCells.push(flat(r, c)) }
    }

  // Every board + rack tile needs a goal cell, all distinct.
  const goalCellSet = new Set<number>()
  const goalCells: number[] = []
  for (const k of boardKeys) {
    const g = goal.get(k)
    if (!g) return null
    const cell = flat(g[0], g[1])
    if (goalCellSet.has(cell)) return null
    goalCellSet.add(cell)
    goalCells.push(cell)
  }
  for (const t of rack) {
    const g = goal.get(tileKey(t))
    if (!g) return null
    const cell = flat(g[0], g[1])
    if (goalCellSet.has(cell)) return null
    goalCellSet.add(cell)
  }

  const analytic = analyticCost(boardCells, goalCells, rack.length)

  // ---- Witness: drain paths (tile whose goal cell is empty) then unwind cycles
  // (swap into goal cell), then drop rack onto the now-free goal cells.
  const grid: Grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (r < curRows && c < curCols ? currentGrid[r][c] : null)),
  )
  const rackArr = [...rack]
  const witness: Drop[] = []
  const goalOf = (t: Tile) => goal.get(tileKey(t))!

  const misplaced = (): [number, number][] => {
    const out: [number, number][] = []
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const t = grid[r][c]
        if (!t) continue
        const [gr, gc] = goalOf(t)
        if (gr !== r || gc !== c) out.push([r, c])
      }
    return out
  }

  const budget = rows * cols * 4
  let moves = 0
  for (let guard = 0; guard <= budget; guard++) {
    const bad = misplaced()
    if (bad.length === 0) break
    if (guard === budget) return { ...analytic, moves, witness, reachedGoal: false, validGoal: false }
    const drain = bad.find(([r, c]) => {
      const [gr, gc] = goalOf(grid[r][c]!)
      return grid[gr][gc] === null
    })
    const [r, c] = drain ?? bad[0]
    const [tr, tc] = goalOf(grid[r][c]!)
    const d: Drop = { from: 'grid', r, c, tr, tc }
    applyDrop(grid, rackArr, d)
    witness.push(d)
    moves++
  }
  while (rackArr.length > 0) {
    const t = rackArr[0]
    const [tr, tc] = goalOf(t)
    if (grid[tr][tc] !== null) return { ...analytic, moves, witness, reachedGoal: false, validGoal: false }
    const d: Drop = { from: 'rack', key: tileKey(t), tr, tc }
    applyDrop(grid, rackArr, d)
    witness.push(d)
    moves++
  }

  const reachedGoal = rackArr.length === 0 && misplaced().length === 0
  return { moves: analytic.moves, fixed: analytic.fixed, cycles: analytic.cycles, witness, reachedGoal, validGoal: reachedGoal && validateGrid(grid) }
}

// ---------------------------------------------------------------------------
// STEP 6b — PAIRING MINIMISATION.
//
// `bindWindowTiles` yields ONE valid binding (ascending-id default). Under m=2
// that choice is not free: when a (value,colour) has two copies and one already
// sits on the board, swapping which copy fills which window slot can change the
// move count. MIGRATION_M2.md §6a measured this against move-BFS and settled the
// design — treated here as ground truth, not re-derived:
//
//   Finding 1  pairing matters: spread > 0 in 121/150, naive strictly suboptimal
//              in 76/150. So an arbitrary binding cannot be trusted.
//   Finding 2  the cost model itself is unchanged and exact PER BINDING; the only
//              missing piece is a minimisation wrapper. That is this function.
//   Finding 3  plain 2^d enumeration suffices — the naive-vs-optimal error is
//              bounded by d, and realistic constructions have d = 1-2 (2-4
//              candidates). Min-cost bipartite matching is deliberately NOT built.
//   Bonus      when BOTH copies start in the RACK the pairing is provably free
//              (spread 0 in 400/400): rack tiles have no cell, so they can be
//              neither `fixed` nor on a cycle, making the copies interchangeable.
//              Those labels are skipped outright rather than enumerated.
//
// Candidate 0 is always the ascending-id default, so with d = 0 there is exactly
// ONE candidate and an empty `pinned` — byte-identical to calling
// `bindWindowTiles(windows, bag)` directly. That is the structural reason an
// m=1-shaped build (every existing archetype) cannot change par by adopting this.
// ---------------------------------------------------------------------------

/** Enumeration is 2^d. d is 1-2 in any realistic construction; anything past this
 * means the caller built something the migration never analysed, so fail loudly
 * rather than quietly burning 64+ candidate layouts. */
export const MAX_ENUMERATED_DUPLICATES = 6

/** Thrown (never returned) when d exceeds MAX_ENUMERATED_DUPLICATES — a loud
 * failure is the point: silently degrading to a 128-candidate search would hide
 * a construction bug behind a performance cliff. */
export class PairingBlowupError extends Error {
  // Declared explicitly rather than as a constructor parameter property:
  // tsconfig sets `erasableSyntaxOnly`, which forbids that form.
  duplicates: string[]
  constructor(duplicates: string[]) {
    super(
      `pairing enumeration refused: ${duplicates.length} board-touching duplicate labels ` +
      `(max ${MAX_ENUMERATED_DUPLICATES}) would need 2^${duplicates.length} candidate bindings. ` +
      `labels=[${duplicates.join(', ')}]`,
    )
    this.name = 'PairingBlowupError'
    this.duplicates = duplicates
  }
}

export interface MinPairingResult extends MoveResult {
  /** The winning binding's goal map (tile id → [row, col]). */
  goal: Map<string, [number, number]>
  /** The winning binding, per window, in column order. */
  bound: Tile[][]
  /** Candidate bindings actually scored. 1 when nothing needed enumerating. */
  candidates: number
  /** Duplicate labels enumerated (≥1 copy on the board). */
  enumerated: string[]
  /** Duplicate labels skipped as provably free (both copies in the rack, §6a). */
  skippedRackOnly: string[]
  /** Best − worst over the candidates scored. 0 when the pairing did not matter. */
  spread: number
}

/**
 * Bind `windows` to the concrete grid+rack tiles and return the CHEAPEST binding.
 *
 * `cellOf(windowIndex, slotIndex)` places the goal — the caller owns the layout;
 * this function only chooses which COPY fills which slot.
 *
 * Selection rule: among candidates that produce a real, reachable, valid goal,
 * the minimum `moves` wins; ties go to the earliest candidate, which is the
 * ascending-id default. If no candidate reaches a valid goal, the default's
 * result is returned unchanged so the caller's existing `reachedGoal`/`validGoal`
 * rejection fires exactly as it did before this wrapper existed.
 *
 * @throws PairingBlowupError when d > MAX_ENUMERATED_DUPLICATES.
 */
export function bindMinCostGoal(
  windows: WindowSpec[],
  currentGrid: Grid,
  rack: Tile[],
  cellOf: (windowIndex: number, slotIndex: number) => [number, number],
): MinPairingResult | null {
  const boardTiles = currentGrid.flat().filter((t): t is Tile => t !== null)
  const bag: Tile[] = [...boardTiles, ...rack]

  // Group the bag by (value,colour); ids ascending, matching bindWindowTiles.
  const byLabel = new Map<string, Tile[]>()
  for (const t of bag) {
    const arr = byLabel.get(labelKey(t))
    if (arr) arr.push(t)
    else byLabel.set(labelKey(t), [t])
  }
  for (const arr of byLabel.values()) arr.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const onBoard = new Set(boardTiles.map(t => t.id))
  const enumerated: string[] = []
  const skippedRackOnly: string[] = []
  // Sorted label order keeps candidate ordering deterministic across runs.
  for (const label of [...byLabel.keys()].sort()) {
    const copies = byLabel.get(label)!
    if (copies.length < 2) continue
    if (copies.some(t => onBoard.has(t.id))) enumerated.push(label)
    else skippedRackOnly.push(label) // §6a bonus fact: provably free, do not enumerate
  }

  if (enumerated.length > MAX_ENUMERATED_DUPLICATES) throw new PairingBlowupError(enumerated)

  // Cartesian product of each enumerated label's copy orderings. permutations()
  // emits the identity first, so candidate 0 is the ascending-id default.
  let pinnedCandidates: Map<string, string[]>[] = [new Map()]
  for (const label of enumerated) {
    const orders = permutations(byLabel.get(label)!.map(t => t.id))
    const grown: Map<string, string[]>[] = []
    for (const base of pinnedCandidates)
      for (const order of orders) {
        const next = new Map(base)
        next.set(label, order)
        grown.push(next)
      }
    pinnedCandidates = grown
  }

  let best: { res: MoveResult; goal: Map<string, [number, number]>; bound: Tile[][] } | null = null
  let fallback: { res: MoveResult; goal: Map<string, [number, number]>; bound: Tile[][] } | null = null
  let bestMoves = Infinity
  let worstMoves = -Infinity
  let scored = 0

  for (const pinned of pinnedCandidates) {
    const bound = bindWindowTiles(windows, bag, pinned.size > 0 ? pinned : undefined)
    if (!bound) continue
    const goal = new Map<string, [number, number]>()
    bound.forEach((row, wi) => row.forEach((t, i) => goal.set(tileKey(t), cellOf(wi, i))))
    const res = mixedLayoutMoves(currentGrid, rack, goal)
    if (!res) continue
    if (!fallback) fallback = { res, goal, bound }
    if (!res.reachedGoal || !res.validGoal) continue
    scored++
    if (res.moves > worstMoves) worstMoves = res.moves
    if (res.moves < bestMoves) { bestMoves = res.moves; best = { res, goal, bound } }
  }

  const chosen = best ?? fallback
  if (!chosen) return null
  return {
    ...chosen.res,
    goal: chosen.goal,
    bound: chosen.bound,
    candidates: pinnedCandidates.length,
    enumerated,
    skippedRackOnly,
    spread: scored > 0 ? worstMoves - bestMoves : 0,
  }
}

// ---------------------------------------------------------------------------
// Convenience optimizer: given window SHAPES (not placements), search placements
// (which row each window owns, its colStart) for the minimum-move layout.
//
// WARNING — combinatorial cost. Assigning W windows to distinct rows is P(rows,W)
// = factorial-ish, the same L! wall that planValueGroupGoal hit (see CLAUDE.md).
// This is fine for small W and MEASURED in the verify harness. Callers that
// already know their intended layout (decoy does) should build the goal map and
// call mixedLayoutMoves directly, bypassing this search entirely.
// ---------------------------------------------------------------------------
export interface PlanResult extends MoveResult {
  layout: PlacedWindow[]
  goal: Map<string, [number, number]>
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs]
  const out: T[][] = []
  for (let i = 0; i < xs.length; i++) {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)]
    for (const p of permutations(rest)) out.push([xs[i], ...p])
  }
  return out
}

export function planMixedGoal(currentGrid: Grid, rack: Tile[], windows: WindowSpec[], rows: number, cols: number): PlanResult | null {
  const feas = windowsPartitionBag(currentGrid, rack, windows)
  if (!feas.feasible) return null
  if (windows.length > rows) return null

  // Bind each window's slots to the CONCRETE bag tiles (real ids) ONCE, up front —
  // the goal map is keyed by those ids, never by freshly-minted copy-0 tiles.
  const bag: Tile[] = [...currentGrid.flat().filter((t): t is Tile => t !== null), ...rack]
  const bound = bindWindowTiles(windows, bag)
  if (!bound) return null

  const rowChoices = Array.from({ length: rows }, (_, i) => i)
  let best: { moves: number; goal: Map<string, [number, number]>; layout: PlacedWindow[] } | null = null

  // Each window can start at cols 0..cols-len; enumerate rows (as an ordered
  // choice of distinct rows) × colStart per window.
  for (const rowPerm of permutations(rowChoices).map(p => p.slice(0, windows.length))) {
    // Dedup: permutations() over all rows repeats the first-W slice; cheap guard.
    const colOptions = windows.map(w => {
      const len = windowTiles(w).length
      const opts: number[] = []
      for (let cs = 0; cs + len <= cols; cs++) opts.push(cs)
      return opts
    })

    // Enumerate colStart combinations (product). Kept modest by small `cols`.
    const idx = new Array(windows.length).fill(0)
    for (;;) {
      const goal = new Map<string, [number, number]>()
      const ok = true
      for (let wi = 0; wi < windows.length && ok; wi++) {
        const row = rowPerm[wi]
        const cs = colOptions[wi][idx[wi]]
        bound[wi].forEach((t, i) => {
          const cell: [number, number] = [row, cs + i]
          goal.set(t.id, cell)
        })
      }
      if (ok) {
        const res = mixedLayoutMoves(currentGrid, rack, goal)
        if (res && res.reachedGoal && (!best || res.moves < best.moves)) {
          best = { moves: res.moves, goal, layout: windows.map((w, wi) => ({ spec: w, row: rowPerm[wi], col: colOptions[wi][idx[wi]] })) }
        }
      }
      // advance colStart odometer
      let k = windows.length - 1
      while (k >= 0) { idx[k]++; if (idx[k] < colOptions[k].length) break; idx[k] = 0; k-- }
      if (k < 0) break
    }
  }

  if (!best) return null
  const final = mixedLayoutMoves(currentGrid, rack, best.goal)!
  return { ...final, layout: best.layout, goal: best.goal }
}

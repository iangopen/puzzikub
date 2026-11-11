// ---------------------------------------------------------------------------
// pairingMin.verify.ts — verification harness for MIGRATION_M2.md Step 6b/6c:
// the duplicate-copy PAIRING MINIMISATION (`bindMinCostGoal` in
// mixedGoalPlanner.ts). Run via `npx tsx src/lib/pairingMin.verify.ts`.
//
// WHAT MUST BE PROVEN, and how each link is actually established here — stated up
// front because 6c's honesty requirement is the whole point of this file:
//
//   LINK 1  "min over pairings == the true move-BFS optimum"
//           -> section 3, unrestricted move-BFS over the real reducer semantics,
//           run to EVERY candidate pairing's goal (BFS-ing only the chosen one
//           would re-test Step 4, not this step). What actually limits BFS is
//           SEARCH DEPTH, not tile count — branching is ~tiles x cells per ply —
//           so instances are generated at full size and perturbed a bounded
//           number of drops from the goal. Measured, not assumed: at 6/9/10 tiles
//           the node cap is never hit (BFS-refused = 0); section 3 prints the
//           real size distribution of every check and every refusal.
//
//   LINK 2  "the wrapper finds the min over pairings, at REALISTIC tile counts"
//           -> section 4, at 19-30 tiles (real builder scale), cross-checked
//           against an INDEPENDENT exhaustive enumeration of ALL 2^D pairings —
//           including the both-copies-in-rack labels the wrapper deliberately
//           skips, so the skip itself is re-proven at scale rather than assumed.
//
//   LINK 3  "the chosen binding's cost is realisable by real drops"
//           -> section 4, every winning witness replayed through a faithful
//           transcription of usePlayState's DROP reducer, landing a validateGrid
//           win in exactly `moves`. This is the same standard decoy/composed par
//           is held to.
//
// Together: 1 anchors the cost identity against ground truth, 2 shows the search
// is exhaustive-equivalent where the game actually lives, 3 shows the answer is
// a real playable line. Claiming BFS itself at 19-30 tiles would be a fabrication:
// a 27-tile scramble sits ~27 plies deep with ~300 successors per ply, which is
// not reachable by any BFS. This file does not pretend otherwise — it says which
// link each section proves and at what size.
// ---------------------------------------------------------------------------

import type { Tile, Grid } from '../types'
import { makeTile } from '../types'
import { validateGrid } from './validator'
import {
  type WindowSpec,
  type Drop,
  windowTiles,
  tileKey,
  bindWindowTiles,
  bindMinCostGoal,
  mixedLayoutMoves,
  MAX_ENUMERATED_DUPLICATES,
  PairingBlowupError,
} from './mixedGoalPlanner'
import { buildRunsToGroups, buildDecoy, buildRedHerring, buildComposed } from './archetypes'

const T = (n: number, c: Tile['c'], copy = 0): Tile => makeTile(n, c, copy)
const ALL: Tile['c'][] = ['r', 'b', 'a', 'k']

let pass = 0, fail = 0
const check = (label: string, ok: boolean) => { if (ok) pass++; else { fail++; console.log(`  FAIL  ${label}`) } }

const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1))
function shuffle<X>(xs: readonly X[]): X[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

const labelOf = (t: Tile) => `${t.n}_${t.c}`
function gridOf(rows: number, cols: number, at: Map<number, Tile>): Grid {
  const g: Grid = Array.from({ length: rows }, () => Array(cols).fill(null))
  for (const [cell, t] of at) g[Math.floor(cell / cols)][cell % cols] = t
  return g
}

// ---------------------------------------------------------------------------
// Unrestricted move-BFS over the REAL reducer semantics (GRID->GRID move/swap,
// GRID->RACK, RACK->GRID with displaced->rack). Same routine the m=1 cost model
// and the mixed planner were held to. Distinguishes tiles by id, so a goal built
// from a SPECIFIC pairing yields exactly that pairing's true optimum.
// ---------------------------------------------------------------------------
function moveBFS(boardAt: Map<number, Tile>, rack: Tile[], goalFlat: Map<string, number>, cells: number[], nodeCap = 250_000): number | null {
  const tiles: Tile[] = [...boardAt.values(), ...rack]
  const id = new Map<string, number>()
  tiles.forEach((t, i) => id.set(tileKey(t), i))
  const N = tiles.length
  const goalCellById = new Int32Array(N)
  for (const t of tiles) {
    const g = goalFlat.get(tileKey(t))
    if (g === undefined) return null
    goalCellById[id.get(tileKey(t))!] = g
  }

  const pos = cells.slice()
  const posIndex = new Map<number, number>()
  pos.forEach((cell, i) => posIndex.set(cell, i))
  const C = pos.length

  const startSlot = new Int32Array(C).fill(-1)
  for (const [cell, t] of boardAt) {
    const p = posIndex.get(cell)
    if (p === undefined) return null
    startSlot[p] = id.get(tileKey(t))!
  }
  const startRack = rack.map(t => id.get(tileKey(t))!).sort((a, b) => a - b)

  const goalSlot = new Int32Array(C).fill(-1)
  for (let i = 0; i < N; i++) {
    const p = posIndex.get(goalCellById[i])
    if (p === undefined) return null
    goalSlot[p] = i
  }

  const enc = (slot: Int32Array, rk: number[]) => `${slot.join(',')}|${rk.join(',')}`
  const goalKey = enc(goalSlot, [])
  if (enc(startSlot, startRack) === goalKey) return 0

  let frontier: { slot: Int32Array; rack: number[] }[] = [{ slot: startSlot, rack: startRack }]
  const seen = new Set<string>([enc(startSlot, startRack)])
  let depth = 0, nodes = 0

  while (frontier.length) {
    depth++
    const next: { slot: Int32Array; rack: number[] }[] = []
    for (const st of frontier) {
      if (++nodes > nodeCap) return null
      const { slot, rack: rk } = st
      const push = (ns: Int32Array, nr: number[]) => {
        nr.sort((a, b) => a - b)
        const key = enc(ns, nr)
        if (seen.has(key)) return
        seen.add(key)
        if (key === goalKey) throw { found: depth }
        next.push({ slot: ns, rack: nr })
      }
      try {
        for (let pi = 0; pi < C; pi++) {
          const t = slot[pi]
          if (t < 0) continue
          { const ns = slot.slice(); ns[pi] = -1; push(ns, [...rk, t]) }        // GRID->RACK
          for (let pj = 0; pj < C; pj++) {                                      // GRID->GRID
            if (pj === pi) continue
            const ns = slot.slice()
            ns[pj] = t; ns[pi] = slot[pj]  // slot[pj] = -1 -> plain move; else swap
            push(ns, rk)
          }
        }
        for (const t of [...new Set(rk)]) {                                     // RACK->GRID
          for (let pj = 0; pj < C; pj++) {
            const ns = slot.slice()
            const u = ns[pj]
            ns[pj] = t
            const nr = [...rk]; nr.splice(nr.indexOf(t), 1); if (u >= 0) nr.push(u)
            push(ns, nr)
          }
        }
      } catch (e) { return (e as { found: number }).found }
    }
    frontier = next
  }
  return null
}

// ---------------------------------------------------------------------------
// Independent faithful transcription of usePlayState's DROP reducer, used to
// REPLAY a witness (link 3). Deliberately written here rather than imported, so
// it is not the same code the planner used to build the witness.
// ---------------------------------------------------------------------------
function replayWitness(startGrid: Grid, startRack: Tile[], witness: Drop[], goal: Map<string, [number, number]>): { moves: number; won: boolean; note: string } {
  const grid = startGrid.map(r => [...r])
  const rack = [...startRack]
  for (const d of witness) {
    if (d.from === 'rack') {
      const i = rack.findIndex(t => t.id === d.key)
      if (i < 0) return { moves: witness.length, won: false, note: `rack tile ${d.key} not in rack` }
      const tile = rack[i]
      rack.splice(i, 1)
      const displaced = grid[d.tr][d.tc]
      grid[d.tr][d.tc] = tile
      if (displaced) rack.push(displaced)
    } else {
      const tile = grid[d.r][d.c]
      if (!tile) return { moves: witness.length, won: false, note: `no tile at (${d.r},${d.c})` }
      grid[d.r][d.c] = grid[d.tr][d.tc]
      grid[d.tr][d.tc] = tile
    }
  }
  if (rack.length > 0) return { moves: witness.length, won: false, note: 'rack not empty' }
  for (let r = 0; r < grid.length; r++)
    for (let c = 0; c < grid[0].length; c++) {
      const t = grid[r][c]
      if (!t) continue
      const g = goal.get(t.id)
      if (!g || g[0] !== r || g[1] !== c) return { moves: witness.length, won: false, note: `${t.id} off its goal cell` }
    }
  const won = validateGrid(grid)
  return { moves: witness.length, won, note: won ? 'validateGrid win' : 'final grid INVALID' }
}

// ---------------------------------------------------------------------------
// Reference minimum: enumerate EVERY pairing over EVERY duplicated label — no
// board/rack filtering, no skipping. This is the ground truth `bindMinCostGoal`
// must match; it is intentionally the dumb, obviously-correct version.
// ---------------------------------------------------------------------------
function exhaustivePairingMin(windows: WindowSpec[], grid: Grid, rack: Tile[], cellOf: (wi: number, i: number) => [number, number]) {
  const bag = [...grid.flat().filter((t): t is Tile => t !== null), ...rack]
  const byLabel = new Map<string, Tile[]>()
  for (const t of bag) {
    const arr = byLabel.get(labelOf(t))
    if (arr) arr.push(t); else byLabel.set(labelOf(t), [t])
  }
  for (const arr of byLabel.values()) arr.sort((a, b) => (a.id < b.id ? -1 : 1))
  const dupLabels = [...byLabel.keys()].sort().filter(l => byLabel.get(l)!.length >= 2)

  let candidates: Map<string, string[]>[] = [new Map()]
  for (const label of dupLabels) {
    const [x, y] = byLabel.get(label)!.map(t => t.id)
    const grown: Map<string, string[]>[] = []
    for (const base of candidates) for (const order of [[x, y], [y, x]]) {
      const m = new Map(base); m.set(label, order); grown.push(m)
    }
    candidates = grown
  }

  let min = Infinity, max = -Infinity, scored = 0
  for (const pinned of candidates) {
    const bound = bindWindowTiles(windows, bag, pinned.size ? pinned : undefined)
    if (!bound) continue
    const goal = new Map<string, [number, number]>()
    bound.forEach((row, wi) => row.forEach((t, i) => goal.set(t.id, cellOf(wi, i))))
    const res = mixedLayoutMoves(grid, rack, goal)
    if (!res || !res.reachedGoal || !res.validGoal) continue
    scored++
    if (res.moves < min) min = res.moves
    if (res.moves > max) max = res.moves
  }
  return { min, max, scored, allDupLabels: dupLabels, candidates: candidates.length }
}

console.log('=== STEP 6b/6c: duplicate-copy PAIRING MINIMISATION verification ===\n')

// ===========================================================================
// 1. The 6b guard: d > MAX_ENUMERATED_DUPLICATES fails LOUDLY, never silently.
// ===========================================================================
console.log('1. Guard — enumeration refuses to blow up silently')
{
  // 7 duplicated colour-runs, every duplicate with a copy on the board => d = 7.
  // Windows: for each of 7 values pick a 3-run and a group sharing that value.
  const windows: WindowSpec[] = []
  const bag: Tile[] = []
  for (let i = 0; i < 7; i++) {
    const v = 1 + i
    windows.push({ type: 'group', value: v, colors: ['r', 'b', 'a'] })
    windows.push({ type: 'group', value: v, colors: ['r', 'b', 'k'] })
    bag.push(T(v, 'r', 0), T(v, 'b', 0), T(v, 'a', 0), T(v, 'r', 1), T(v, 'b', 1), T(v, 'k', 0))
  }
  const cols = 6
  const at = new Map<number, Tile>()
  bag.forEach((t, i) => at.set(i, t))
  const grid = gridOf(Math.ceil(bag.length / cols), cols, at)
  let threw: unknown = null
  try { bindMinCostGoal(windows, grid, [], (wi, i) => [wi, i]) } catch (e) { threw = e }
  const isBlowup = threw instanceof PairingBlowupError
  console.log(`   MAX_ENUMERATED_DUPLICATES = ${MAX_ENUMERATED_DUPLICATES}`)
  console.log(`   d=14 board-touching duplicate labels -> threw ${isBlowup ? 'PairingBlowupError' : String(threw)}`)
  if (isBlowup) console.log(`   message: ${(threw as Error).message.slice(0, 110)}...`)
  check('d over the cap throws PairingBlowupError (loud, not a silent 2^d search)', isBlowup)
  check('the error names the offending labels', isBlowup && (threw as PairingBlowupError).duplicates.length > MAX_ENUMERATED_DUPLICATES)
}

// ===========================================================================
// 2. The 6a bonus fact, RE-CONFIRMED here rather than assumed: when both copies
//    start in the RACK the pairing is free, so skipping it loses nothing.
// ===========================================================================
console.log('\n2. Rack-only duplicates are skipped — and skipping provably costs nothing')
{
  let insts = 0, skippedSome = 0, spreadNonZero = 0, wrapperVsExhaustive = 0
  for (let it = 0; it < 300; it++) {
    // run {v..v+2}c + group {v+2: c,x,y}: label (v+2,c) is duplicated.
    const v = randInt(1, 9)
    const [c, x, y] = shuffle(ALL)
    const windows: WindowSpec[] = [
      { type: 'run', color: c, start: v, length: 3 },
      { type: 'group', value: v + 2, colors: [c, x, y] },
    ]
    const tiles = [T(v, c), T(v + 1, c), T(v + 2, c, 0), T(v + 2, c, 1), T(v + 2, x), T(v + 2, y)]
    const dupIds = new Set([T(v + 2, c, 0).id, T(v + 2, c, 1).id])
    // BOTH duplicate copies go to the rack; the rest are scattered on the board.
    const rack = tiles.filter(t => dupIds.has(t.id))
    const boardTiles = shuffle(tiles.filter(t => !dupIds.has(t.id)))
    const cols = 3
    const at = new Map<number, Tile>()
    const freeCells = shuffle([0, 1, 2, 3, 4, 5]).slice(0, boardTiles.length)
    boardTiles.forEach((t, i) => at.set(freeCells[i], t))
    const grid = gridOf(2, cols, at)
    const cellOf = (wi: number, i: number): [number, number] => [wi, i]
    const res = bindMinCostGoal(windows, grid, rack, cellOf)
    if (!res || !res.reachedGoal || !res.validGoal) continue
    insts++
    if (res.skippedRackOnly.length > 0) skippedSome++
    const ex = exhaustivePairingMin(windows, grid, rack, cellOf)
    if (ex.scored === 0) continue
    if (ex.max !== ex.min) spreadNonZero++          // would mean the skip lost something
    if (res.moves !== ex.min) wrapperVsExhaustive++ // wrapper must still equal the true min
  }
  console.log(`   instances=${insts}  with a rack-only duplicate skipped=${skippedSome}`)
  console.log(`   exhaustive spread over BOTH pairings (should be 0 every time)=${spreadNonZero}`)
  console.log(`   wrapper moves != exhaustive min = ${wrapperVsExhaustive}`)
  check('rack-only duplicates were actually detected and skipped', skippedSome >= 250)
  check('rack-only pairing is free: exhaustive spread is 0 on every instance', spreadNonZero === 0)
  check('skipping them still yields the true minimum', wrapperVsExhaustive === 0)
}

// ===========================================================================
// 3. LINK 1 — unrestricted move-BFS ground truth. Real numbers, real sizes.
// ===========================================================================
// The claim under test is NOT merely "the chosen binding's cost is exact" — it is
// 6a Finding 2: the minimum over pairings equals the TRUE optimum over every
// winning move sequence. So BFS is run to EVERY candidate pairing's goal and the
// minimum of those BFS answers is compared to the wrapper's par. Anything less
// would only re-test Step 4.
console.log('\n3. LINK 1: min over pairings == min over BFS-per-pairing (unrestricted move-BFS)')
{
  let insts = 0, bfsChecked = 0, bfsMismatch = 0, capSkipped = 0
  let naiveWrong = 0, spreadPositive = 0
  const tilesChecked = new Map<number, number>()
  const tilesSkipped = new Map<number, number>()
  let bfsRuns = 0

  // Instances are generated at a range of sizes and then perturbed a bounded
  // number of drops away from the goal. Depth, not tile count, is what makes BFS
  // explode (branching is ~tiles x cells per ply), so bounded perturbation is what
  // buys real tile counts here instead of 6-tile toys. Everything the node cap
  // refuses is COUNTED and printed by size rather than quietly dropped.
  const t0 = Date.now()
  // Budget is wall-clock, not tractability: at the sizes below the node cap is
  // never reached (BFS-refused stays 0) — it is simply ~1s per instance to BFS
  // every pairing. 480s comfortably clears the >=265 bar the m=1 model was held to.
  for (let it = 0; it < 30000 && bfsChecked < 300 && Date.now() - t0 < 480_000; it++) {
    const v = randInt(1, 8)
    const [c, x, y, z] = shuffle(ALL)
    const shape = randInt(0, 2)
    let windows: WindowSpec[]
    let tiles: Tile[]
    if (shape === 0) {
      // 6 tiles: run {v..v+2}c + group {v+2: c,x,y}
      windows = [
        { type: 'run', color: c, start: v, length: 3 },
        { type: 'group', value: v + 2, colors: [c, x, y] },
      ]
      tiles = [T(v, c), T(v + 1, c), T(v + 2, c, 0), T(v + 2, c, 1), T(v + 2, x), T(v + 2, y)]
    } else if (shape === 1) {
      // 9 tiles: run {v..v+2}c + group {v+2: c,x,y} + group {v: c,x,z}
      if (v + 2 > 13) continue
      windows = [
        { type: 'run', color: c, start: v, length: 3 },
        { type: 'group', value: v + 2, colors: [c, x, y] },
        { type: 'group', value: v, colors: [c, x, z] },
      ]
      tiles = [
        T(v, c, 0), T(v + 1, c), T(v + 2, c, 0),
        T(v + 2, c, 1), T(v + 2, x), T(v + 2, y),
        T(v, c, 1), T(v, x), T(v, z),
      ]
    } else {
      // 10 tiles: the cut-point family — run {v..v+2} + {v+2..v+5} + {v+5..v+7}
      if (v + 7 > 13) continue
      windows = [
        { type: 'run', color: c, start: v, length: 3 },
        { type: 'run', color: c, start: v + 2, length: 4 },
        { type: 'run', color: c, start: v + 5, length: 3 },
      ]
      tiles = [
        T(v, c), T(v + 1, c), T(v + 2, c, 0),
        T(v + 2, c, 1), T(v + 3, c), T(v + 4, c), T(v + 5, c, 0),
        T(v + 5, c, 1), T(v + 6, c), T(v + 7, c),
      ]
    }

    const cols = Math.max(...windows.map(w => windowTiles(w).length))
    const cellOf = (wi: number, i: number): [number, number] => [wi, i]
    const goalCells: number[] = []
    windows.forEach((w, wi) => windowTiles(w).forEach((_, i) => goalCells.push(wi * cols + i)))
    if (goalCells.length !== tiles.length) continue

    // Start at the (ascending-id) goal, then perturb by k drops: swap two board
    // tiles, or send one to the rack. Keeps BFS depth bounded while the instance
    // stays full size.
    const at = new Map<number, Tile>()
    const defaultBound = bindWindowTiles(windows, tiles)
    if (!defaultBound) continue
    let ci = 0
    defaultBound.forEach((row, wi) => row.forEach((t, i) => { at.set(wi * cols + i, t); ci++ }))
    if (ci !== tiles.length) continue
    const rack: Tile[] = []
    // k=1..2. Measured: at 10 tiles / 12 cells the branching factor is ~120 per
    // ply, so depth 2 costs ~1.4e4 nodes and depth 3 costs ~1.7e6 — past the cap.
    // Two perturbations is what keeps full-size instances BFS-resolvable.
    const k = randInt(1, 2)
    for (let p = 0; p < k; p++) {
      const occupied = [...at.keys()]
      if (occupied.length < 2) break
      if (Math.random() < 0.3) {
        const cell = occupied[randInt(0, occupied.length - 1)]
        rack.push(at.get(cell)!); at.delete(cell)
      } else {
        const a = occupied[randInt(0, occupied.length - 1)]
        let b = occupied[randInt(0, occupied.length - 1)]
        if (a === b) b = occupied[(occupied.indexOf(a) + 1) % occupied.length]
        const ta = at.get(a)!, tb = at.get(b)!
        at.set(a, tb); at.set(b, ta)
      }
    }
    if (![...at.values()].some(t => tiles.filter(u => u.n === t.n && u.c === t.c).length >= 2)) continue

    const rows = Math.max(...goalCells.map(g => Math.floor(g / cols))) + 1
    const grid = gridOf(rows, cols, at)
    const res = bindMinCostGoal(windows, grid, rack, cellOf)
    if (!res || !res.reachedGoal || !res.validGoal) continue
    insts++
    if (res.spread > 0) spreadPositive++

    // Naive (ascending-id default) binding, for the "does this matter" count.
    const bag = [...at.values(), ...rack]
    const nb = bindWindowTiles(windows, bag)!
    const ng = new Map<string, [number, number]>()
    nb.forEach((row, wi) => row.forEach((t, i) => ng.set(t.id, cellOf(wi, i))))
    const naive = mixedLayoutMoves(grid, rack, ng)
    if (naive && naive.reachedGoal && naive.moves > res.moves) naiveWrong++

    // BFS EVERY pairing, take the min. Two scratch cells so extra empties are
    // available to BFS and can be shown never to beat total-fixed-cycles.
    const pad = Math.max(...goalCells) + 1
    const cells = [...goalCells, pad, pad + 1]
    const ex = exhaustivePairingMin(windows, grid, rack, cellOf)
    let bfsMin = Infinity
    let capped = false
    let cand: Map<string, string[]>[] = [new Map()]
    for (const label of ex.allDupLabels) {
      const copies = bag.filter(t => labelOf(t) === label).map(t => t.id).sort()
      const grown: Map<string, string[]>[] = []
      for (const base of cand) for (const o of [[copies[0], copies[1]], [copies[1], copies[0]]]) {
        const m = new Map(base); m.set(label, o); grown.push(m)
      }
      cand = grown
    }
    for (const pinned of cand) {
      const bound = bindWindowTiles(windows, bag, pinned.size ? pinned : undefined)
      if (!bound) continue
      const goalFlat = new Map<string, number>()
      bound.forEach((row, wi) => row.forEach((t, i) => goalFlat.set(t.id, wi * cols + i)))
      bfsRuns++
      const b = moveBFS(at, rack, goalFlat, cells, 150_000)
      if (b === null) { capped = true; break }
      bfsMin = Math.min(bfsMin, b)
    }
    if (capped || bfsMin === Infinity) {
      capSkipped++
      tilesSkipped.set(tiles.length, (tilesSkipped.get(tiles.length) ?? 0) + 1)
      continue
    }
    bfsChecked++
    tilesChecked.set(tiles.length, (tilesChecked.get(tiles.length) ?? 0) + 1)
    if (bfsMin !== res.moves) {
      bfsMismatch++
      if (bfsMismatch <= 5) console.log(`   MISMATCH: minimised=${res.moves} bfs-min-over-pairings=${bfsMin} tiles=${tiles.length}`)
    }
  }
  const fmt = (m: Map<number, number>) => [...m].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}t:${n}`).join(' ') || 'none'
  console.log(`   instances=${insts}  BFS-checked=${bfsChecked}  BFS-refused(nodecap)=${capSkipped}   (${bfsRuns} BFS runs total — every pairing of every instance)`)
  console.log(`   BFS mismatches=${bfsMismatch}`)
  console.log(`   BFS-checked by tile count : ${fmt(tilesChecked)}`)
  console.log(`   BFS-refused  by tile count : ${fmt(tilesSkipped)}   <- the measured ceiling, not an assumed one`)
  console.log(`   pairing actually mattered (spread>0) on ${spreadPositive}/${insts}; naive binding strictly worse on ${naiveWrong}/${insts}`)
  check('LINK 1: >= 265 BFS cross-checks (the m=1 cost model standard)', bfsChecked >= 265)
  check('LINK 1: zero BFS mismatches', bfsMismatch === 0)
  check('LINK 1: coverage is not 6-tile toys only (10-tile instances BFS-checked)', (tilesChecked.get(10) ?? 0) >= 40)
  check('LINK 1: 9-tile instances BFS-checked too', (tilesChecked.get(9) ?? 0) >= 40)
  check('LINK 1: pairing demonstrably mattered on a real fraction of instances', spreadPositive > 0)
}

// ===========================================================================
// 4. LINK 2+3 — REALISTIC SCALE (19-30 tiles), exhaustive-equivalence + replay.
// ===========================================================================
console.log('\n4. LINK 2+3: realistic tile counts (19-30) — exhaustive pairing min + reducer replay')
{
  // Builder-shaped instance: L value-groups over 3-4 colours plus 1-3 colour runs
  // that re-demand some of those (value,colour)s, creating genuine duplicates.
  function makeRealistic(): { windows: WindowSpec[]; grid: Grid; rack: Tile[]; cols: number; tiles: number; d: number } | null {
    const L = randInt(5, 7)
    const s = randInt(1, 13 - L - 1)
    const [c1, c2, c3, c4] = shuffle(ALL)
    const windows: WindowSpec[] = []
    for (let o = 0; o < L; o++) {
      const colors = Math.random() < 0.5 ? [c1, c2, c3] : [c1, c2, c3, c4]
      windows.push({ type: 'group', value: s + o, colors })
    }
    // 1-2 runs that PARTIALLY overlap the group band, in a colour the groups may
    // or may not carry. Partial overlap is what makes d vary over 1..6 instead of
    // pinning it at 3 per run — d = 1-2 is the range 6a calls realistic, and it
    // must be covered, but the larger d values are kept as a deliberate stress.
    const nRuns = randInt(1, 2)
    for (let i = 0; i < nRuns; i++) {
      const rc = [c1, c2, c3, c4][randInt(0, 3)]
      const start = s + randInt(-2, Math.max(0, L - 1))
      if (start < 1 || start + 2 > 13) continue
      windows.push({ type: 'run', color: rc, start, length: 3 })
    }
    if (windows.length === L) return null // both runs rejected as out of range
    const demand = windows.flatMap(windowTiles)
    const count = new Map<string, number>()
    for (const t of demand) count.set(labelOf(t), (count.get(labelOf(t)) ?? 0) + 1)
    if ([...count.values()].some(n => n > 2)) return null // > TILE_COPIES, not buildable
    const d = [...count.values()].filter(n => n === 2).length
    if (d === 0) return null

    // Mint the concrete bag: copy 0 then copy 1 for each duplicated label.
    const tiles: Tile[] = []
    for (const [label, n] of count) {
      const [vs, cs] = label.split('_')
      for (let k = 0; k < n; k++) tiles.push(T(Number(vs), cs as Tile['c'], k))
    }
    const total = tiles.length
    if (total < 19 || total > 30) return null

    const cols = Math.max(...windows.map(w => windowTiles(w).length))
    const cellOfLocal = (wi: number, i: number) => wi * cols + i
    const goalCells: number[] = []
    windows.forEach((w, wi) => windowTiles(w).forEach((_, i) => goalCells.push(cellOfLocal(wi, i))))

    // Scramble: most tiles on the board at permuted goal cells, a few in the rack.
    const nRack = randInt(1, 4)
    const perm = shuffle(tiles)
    const rack = perm.slice(0, nRack)
    const onBoard = perm.slice(nRack)
    const scatter = shuffle(goalCells).slice(0, onBoard.length)
    const at = new Map<number, Tile>()
    onBoard.forEach((t, i) => at.set(scatter[i], t))
    const grid = gridOf(windows.length, cols, at)
    return { windows, grid, rack, cols, tiles: total, d }
  }

  let insts = 0, exhaustiveMismatch = 0, replayMismatch = 0, replayNotWon = 0
  let spreadPositive = 0, naiveWrong = 0, skipUsed = 0
  let minTiles = Infinity, maxTiles = -Infinity
  const dHist = new Map<number, number>()
  const cands: number[] = []

  for (let it = 0; it < 20000 && insts < 300; it++) {
    const inst = makeRealistic()
    if (!inst) continue
    const { windows, grid, rack, tiles } = inst
    const cellOf = (wi: number, i: number): [number, number] => [wi, i]
    const res = bindMinCostGoal(windows, grid, rack, cellOf)
    if (!res || !res.reachedGoal || !res.validGoal) continue
    insts++
    minTiles = Math.min(minTiles, tiles); maxTiles = Math.max(maxTiles, tiles)
    dHist.set(inst.d, (dHist.get(inst.d) ?? 0) + 1)
    cands.push(res.candidates)
    if (res.skippedRackOnly.length > 0) skipUsed++
    if (res.spread > 0) spreadPositive++

    // LINK 2 — wrapper's answer vs dumb exhaustive over ALL duplicate labels.
    const ex = exhaustivePairingMin(windows, grid, rack, cellOf)
    if (ex.scored > 0 && res.moves !== ex.min) {
      exhaustiveMismatch++
      if (exhaustiveMismatch <= 5) console.log(`   MISMATCH: wrapper=${res.moves} exhaustive-min=${ex.min} d=${inst.d} tiles=${tiles}`)
    }
    if (ex.scored > 0 && ex.max > ex.min) {
      const bag = [...grid.flat().filter((t): t is Tile => t !== null), ...rack]
      const nb = bindWindowTiles(windows, bag)!
      const ng = new Map<string, [number, number]>()
      nb.forEach((row, wi) => row.forEach((t, i) => ng.set(t.id, cellOf(wi, i))))
      const naive = mixedLayoutMoves(grid, rack, ng)
      if (naive && naive.reachedGoal && naive.moves > res.moves) naiveWrong++
    }

    // LINK 3 — replay the winning witness through an independent reducer.
    const rp = replayWitness(grid, rack, res.witness, res.goal)
    if (rp.moves !== res.moves) replayMismatch++
    if (!rp.won) { replayNotWon++; if (replayNotWon <= 3) console.log(`   REPLAY FAIL: ${rp.note}`) }
  }
  const avgCand = cands.reduce((a, b) => a + b, 0) / Math.max(1, cands.length)
  console.log(`   instances=${insts}   tile counts ${minTiles}-${maxTiles}   d histogram ${[...dHist].sort().map(([k, n]) => `d=${k}:${n}`).join(' ')}`)
  console.log(`   candidate bindings scored: avg ${avgCand.toFixed(2)}, max ${Math.max(...cands)}   (rack-only skip engaged on ${skipUsed})`)
  console.log(`   LINK 2  wrapper != exhaustive-over-all-pairings min : ${exhaustiveMismatch}`)
  console.log(`   LINK 3  replayed witness length != par : ${replayMismatch}    replay not a validateGrid win : ${replayNotWon}`)
  console.log(`   pairing mattered (spread>0) on ${spreadPositive}/${insts}; naive binding strictly worse on ${naiveWrong}/${insts}`)
  check('LINK 2: >= 265 realistic-scale instances', insts >= 265)
  check('LINK 2: realistic scale really is 19+ tiles', minTiles >= 19)
  check('LINK 2: wrapper == exhaustive min over ALL pairings, every instance', exhaustiveMismatch === 0)
  check('LINK 3: every winning witness replays to exactly par', replayMismatch === 0)
  check('LINK 3: every winning witness replays to a validateGrid win', replayNotWon === 0)
  check('pairing mattered at realistic scale too', spreadPositive > 0)
}

// ===========================================================================
// 5. The explicit named case: red 1-8 + duplicate 3 + duplicate 6 (MIGRATION_M2
//    §6a's realistic cut-point construction, and Step 11's target shape).
// ===========================================================================
console.log('\n5. Named case: red 1-8 + dup 3 + dup 6 (cut points 3 and 6) — 10 tiles, d=2')
{
  // Cut at 3 and 6: {1,2,3} + {3,4,5,6} + {6,7,8}. The 3 and the 6 each appear in
  // two windows, so both copies are demanded — exactly the m=2 shape.
  const windows: WindowSpec[] = [
    { type: 'run', color: 'r', start: 1, length: 3 }, // 1r 2r 3r
    { type: 'run', color: 'r', start: 3, length: 4 }, // 3r 4r 5r 6r
    { type: 'run', color: 'r', start: 6, length: 3 }, // 6r 7r 8r
  ]
  const cols = 4
  const cellOf = (wi: number, i: number): [number, number] => [wi, i]
  const tiles = [
    T(1, 'r'), T(2, 'r'), T(3, 'r', 0),
    T(3, 'r', 1), T(4, 'r'), T(5, 'r'), T(6, 'r', 0),
    T(6, 'r', 1), T(7, 'r'), T(8, 'r'),
  ]
  const goalCellsFlat = [0, 1, 2, 4, 5, 6, 7, 8, 9, 10]

  // Place every tile on the board, with BOTH duplicate copies swapped relative to
  // the ascending-id default — so the default pairing is not the cheap one.
  const order = [
    T(1, 'r'), T(2, 'r'), T(3, 'r', 1),   // window 0 cells; copy #1 sits here
    T(3, 'r', 0), T(4, 'r'), T(5, 'r'), T(6, 'r', 1),
    T(6, 'r', 0), T(7, 'r'), T(8, 'r'),
  ]
  const at = new Map<number, Tile>()
  order.forEach((t, i) => at.set(goalCellsFlat[i], t))
  const grid = gridOf(3, cols, at)

  const res = bindMinCostGoal(windows, grid, [], cellOf)!
  const ex = exhaustivePairingMin(windows, grid, [], cellOf)

  // Score all four pairings by hand for the printout.
  const rows: string[] = []
  const bag = tiles
  for (const o3 of [[T(3, 'r', 0).id, T(3, 'r', 1).id], [T(3, 'r', 1).id, T(3, 'r', 0).id]])
    for (const o6 of [[T(6, 'r', 0).id, T(6, 'r', 1).id], [T(6, 'r', 1).id, T(6, 'r', 0).id]]) {
      const pinned = new Map<string, string[]>([['3_r', o3], ['6_r', o6]])
      const bound = bindWindowTiles(windows, bag, pinned)!
      const goal = new Map<string, [number, number]>()
      bound.forEach((row, wi) => row.forEach((t, i) => goal.set(t.id, cellOf(wi, i))))
      const r = mixedLayoutMoves(grid, [], goal)!
      const goalFlat = new Map<string, number>()
      for (const [k, [rr, cc]] of goal) goalFlat.set(k, rr * cols + cc)
      const bfs = moveBFS(at, [], goalFlat, [...goalCellsFlat, 3, 11], 400_000)
      rows.push(`     3r->[${o3[0].slice(-1)},${o3[1].slice(-1)}] 6r->[${o6[0].slice(-1)},${o6[1].slice(-1)}] : cost=${r.moves} (fixed=${r.fixed} cycles=${r.cycles})  BFS=${bfs === null ? 'nodecap' : bfs}${bfs !== null && bfs === r.moves ? ' ✓' : bfs === null ? '' : ' MISMATCH'}`)
    }
  console.log('   all 4 candidate pairings, each independently BFS-confirmed:')
  rows.forEach(r => console.log(r))
  console.log(`   bindMinCostGoal picked: par=${res.moves}  candidates=${res.candidates}  enumerated=[${res.enumerated.join(',')}]  spread=${res.spread}`)
  console.log(`   exhaustive min=${ex.min}  max=${ex.max}   naive (ascending-id default) would have paid ${ex.max}`)

  const bfsOk = rows.every(r => !r.includes('MISMATCH'))
  check('named case: wrapper par == exhaustive minimum', res.moves === ex.min)
  check('named case: the pairing genuinely mattered here (min < max)', ex.min < ex.max)
  check('named case: wrapper strictly beat the naive default', res.moves < ex.max)
  check('named case: every BFS-resolved pairing matched its analytic cost', bfsOk)
  check('named case: d=2 -> exactly 4 candidates enumerated', res.candidates === 4)

  const rp = replayWitness(grid, [], res.witness, res.goal)
  console.log(`   winning witness replayed through the real reducer: ${rp.moves} drops, ${rp.note}`)
  check('named case: winning witness replays to par with a validateGrid win', rp.moves === res.moves && rp.won)
}

// ===========================================================================
// 6. CRITICAL REGRESSION: the seven shipped par numbers must not move at all.
// ===========================================================================
console.log('\n6. REGRESSION — the seven shipped par numbers (m=1 builds, nothing to enumerate)')
{
  const rows: [string, () => number | null, number][] = [
    ['easy       (runs-to-groups)', () => buildRunsToGroups('easy')?.minMoves ?? null, 11],
    ['medium     (runs-to-groups)', () => buildRunsToGroups('medium')?.minMoves ?? null, 16],
    ['hard       (runs-to-groups)', () => buildRunsToGroups('hard')?.minMoves ?? null, 20],
    ['decoy      hard            ', () => buildDecoy('hard')?.minMoves ?? null, 22],
    ['decoy      extreme         ', () => buildDecoy('extreme')?.minMoves ?? null, 25],
    ['redherring hard            ', () => buildRedHerring('hard')?.minMoves ?? null, 21],
    ['redherring extreme         ', () => buildRedHerring('extreme')?.minMoves ?? null, 24],
    ['composed   hard            ', () => buildComposed('hard')?.minMoves ?? null, 24],
    ['composed   extreme         ', () => buildComposed('extreme')?.minMoves ?? null, 27],
  ]
  let allExact = true
  for (const [label, build, want] of rows) {
    const seen = new Set<number | null>()
    // A builder may legitimately reject a single draw (the runs-to-groups
    // uniqueness gate rejects ~30% at easy), so retry as the generator does. A
    // builder that can NEVER build still records null and still fails here.
    let calls = 0, rejected = 0
    for (let i = 0; i < 20; i++) {
      let par = build()
      calls++
      for (let t = 0; par === null && t < 40; t++) { rejected++; calls++; par = build() }
      seen.add(par)
    }
    console.log(`          builder rejection rate: ${rejected}/${calls} calls (${(100 * rejected / calls).toFixed(0)}%)`)
    const vals = [...seen]
    const exact = vals.length === 1 && vals[0] === want
    if (!exact) allExact = false
    console.log(`   ${exact ? 'EXACT' : 'DRIFT'}  ${label}  actual ${JSON.stringify(vals)} [expected ${want}]`)
    check(`par unchanged: ${label.trim()}`, exact)
  }
  console.log(`   --> ${allExact ? 'ALL SEVEN PAR NUMBERS UNCHANGED' : 'PAR DRIFT — BUG IN STEP 6'}`)
}

console.log(`\n=== SELF-CHECKS: ${pass} passed, ${fail} failed ===`)

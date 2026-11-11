// Verification harness for the COMPOSED archetype (buildComposed /
// buildComposedAt in archetypes.ts) — decoy's one-ended trap AND red herring's
// two-ended trap on different colours of ONE board.
// Run: `npx tsx src/lib/composed.verify.ts`.
//
// Proves, with real executed output per CLAUDE.md's anti-illusion rule, every
// invariant from BOTH source modifiers re-run on the COMBINED construction:
//   (a) validateGrid(board) true, zero invalid cells at move zero
//   (b) solveBag(all tiles).solvable
//   (c) formsValidSetAlone(rack) === false
//   (d) existsNoRelocationWin(board, rack): win=false AND not exhausted
//   (e) mixedLayoutMoves reaches a validateGrid win on the COMBINED hybrid goal
//   OBVIOUS x3: decoy + both herring extenders all read as run-extensions
//   TRAP x4:    decoy-append / herring-high / herring-low / herring-extend-both
//               each leave the remainder UNSOLVABLE via real solveBag
//   HOME x3:    all three tempting tiles have a real destination cell
// plus the COMPOSITION-SPECIFIC checks that neither source session could run:
//   PARTIAL:    resolving ONE trap correctly is NOT itself a win, and does NOT
//               make the OTHER trap's obvious move safe (re-tested via solveBag
//               on the reduced bag, i.e. in the context of the other trap having
//               already been resolved — not in isolation)
//   COLLIDE:    no two rack tiles share a (value,colour), and the combined goal
//               is an exact duplicate-free partition of the combined tile set

import type { Tile, Grid } from '../types'
import { validateGrid, getInvalidCells } from './validator'
import { solveBag } from './solver'
import {
  buildComposed, buildComposedAt, proveComposedAt, type ComposedBuild,
  formsValidSetAlone, existsNoRelocationWin, obviousSpots,
} from './archetypes'
import { mixedLayoutMoves } from './mixedGoalPlanner'
import { generatePuzzle } from './generator'

let pass = 0, fail = 0
const check = (label: string, ok: boolean) => { if (ok) pass++; else { fail++; console.log(`  FAIL  ${label}`) } }
const key = (t: Tile) => t.id // goal maps are id-keyed (m=2 Step 5)
const eq = (a: Tile, b: Tile) => a.n === b.n && a.c === b.c

// Faithful transcription of usePlayState's DROP reducer (same as verifyEngine.ts).
type Drop =
  | { from: 'grid'; r: number; c: number; tr: number; tc: number }
  | { from: 'rack'; idx: number; tr: number; tc: number }
function applyDrop(grid: Grid, rack: Tile[], d: Drop): void {
  if (d.from === 'rack') {
    const tile = rack[d.idx]; rack.splice(d.idx, 1)
    const displaced = grid[d.tr][d.tc]; grid[d.tr][d.tc] = tile
    if (displaced) rack.push(displaced)
  } else {
    const tile = grid[d.r][d.c]; grid[d.r][d.c] = grid[d.tr][d.tc]; grid[d.tr][d.tc] = tile
  }
}
interface SimResult { moves: number; won: boolean; note: string }
function simulateGoal(startGrid: Grid, startRack: Tile[], goal: Map<string, [number, number]>): SimResult {
  const grid = startGrid.map(r => [...r]); const rack = [...startRack]
  const goalOf = (t: Tile) => goal.get(key(t))!
  let moves = 0
  const misplaced = (): [number, number][] => {
    const out: [number, number][] = []
    for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[0].length; c++) {
      const t = grid[r][c]; if (!t) continue
      const [gr, gc] = goalOf(t); if (gr !== r || gc !== c) out.push([r, c])
    }
    return out
  }
  const budget = grid.length * grid[0].length * 4
  for (let guard = 0; guard <= budget; guard++) {
    const bad = misplaced(); if (bad.length === 0) break
    if (guard === budget) return { moves, won: false, note: 'board phase did not terminate' }
    const drain = bad.find(([r, c]) => { const [gr, gc] = goalOf(grid[r][c]!); return grid[gr][gc] === null })
    const [r, c] = drain ?? bad[0]; const [tr, tc] = goalOf(grid[r][c]!)
    applyDrop(grid, rack, { from: 'grid', r, c, tr, tc }); moves++
  }
  while (rack.length > 0) {
    const [tr, tc] = goalOf(rack[0])
    if (grid[tr][tc] !== null) return { moves, won: false, note: `rack goal (${tr},${tc}) occupied` }
    applyDrop(grid, rack, { from: 'rack', idx: 0, tr, tc }); moves++
  }
  const won = rack.length === 0 && validateGrid(grid)
  return { moves, won, note: won ? 'validateGrid win' : 'final grid INVALID' }
}

/** Every invariant from BOTH source modifiers, re-run on the combined build. */
function checkInvariants(b: ComposedBuild) {
  const a = validateGrid(b.grid) && getInvalidCells(b.grid).size === 0
  const bInv = solveBag(b.allTiles).solvable === true
  const c = formsValidSetAlone(b.rack) === false
  const dS = existsNoRelocationWin(b.grid, b.rack)
  const d = dS.win === false && dS.exhausted === false
  const home = mixedLayoutMoves(b.grid, b.rack, b.goal)
  const e = !!home && home.reachedGoal && home.validGoal

  const oDecoy = obviousSpots(b.grid, b.decoy).length > 0
  const oLow = obviousSpots(b.grid, b.lowExtender).length > 0
  const oHigh = obviousSpots(b.grid, b.highExtender).length > 0

  const without = (trap: Tile[]) => b.allTiles.filter(t => !trap.some(x => eq(x, t)))
  const tDecoy = solveBag(without(b.trapDecoy)).solvable === false
  const tHigh = solveBag(without(b.trapHigh)).solvable === false
  const tLow = solveBag(without(b.trapLow)).solvable === false
  const tBoth = solveBag(without(b.trapBoth)).solvable === false

  const hDecoy = b.goal.has(key(b.decoy))
  const hLow = b.goal.has(key(b.lowExtender))
  const hHigh = b.goal.has(key(b.highExtender))

  const ok = a && bInv && c && d && e && oDecoy && oLow && oHigh && tDecoy && tHigh && tLow && tBoth && hDecoy && hLow && hHigh
  return { ok, a, bInv, c, d, e, oDecoy, oLow, oHigh, tDecoy, tHigh, tLow, tBoth, hDecoy, hLow, hHigh }
}

/** COMPOSITION-SPECIFIC: partial progress must not win, and must not defuse the
 * other trap. "Resolved" = that colour's genuine short run(s) committed; the
 * other trap's obvious append is then re-tested on the REDUCED bag. */
function checkPartial(b: ComposedBuild) {
  const drop = (bag: Tile[], rm: Tile[]) => bag.filter(t => !rm.some(x => eq(x, t)))
  const inSpan = (c: Tile['c'], lo: number, hi: number) => (t: Tile) => t.c === c && t.n >= lo && t.n <= hi
  const { s, L, cDecoy, cHerring } = b

  // --- decoy resolved, herring still open
  const afterDecoy = drop(b.allTiles, b.decoyResolved)
  const decoyRestSolvable = solveBag(afterDecoy).solvable === true
  const highStillDead = solveBag(afterDecoy.filter(t => !inSpan(cHerring, s, s + L)(t))).solvable === false
  const lowStillDead = solveBag(afterDecoy.filter(t => !inSpan(cHerring, s - 1, s + L - 1)(t))).solvable === false

  // --- herring resolved, decoy still open
  const afterHerr = drop(b.allTiles, b.herringResolved)
  const herrRestSolvable = solveBag(afterHerr).solvable === true
  const decoyStillDead = solveBag(afterHerr.filter(t => !inSpan(cDecoy, s, s + L)(t))).solvable === false

  // --- partial progress is not itself a validateGrid win: place ONLY the decoy
  // in its genuine home (its short run on its goal row) and check no win.
  const grid = b.grid.map(r => [...r])
  const rack = [...b.rack]
  for (const t of b.decoyResolved) {
    const g = b.goal.get(key(t))!
    // clear its old board cell, then place
    for (let r = 0; r < grid.length; r++) for (let cc = 0; cc < grid[0].length; cc++)
      if (grid[r][cc] && eq(grid[r][cc]!, t)) grid[r][cc] = null
    const ri = rack.findIndex(x => eq(x, t)); if (ri >= 0) rack.splice(ri, 1)
    grid[g[0]][g[1]] = t
  }
  const partialNotWin = !(rack.length === 0 && validateGrid(grid))

  const ok = decoyRestSolvable && highStillDead && lowStillDead && herrRestSolvable && decoyStillDead && partialNotWin
  return { ok, decoyRestSolvable, highStillDead, lowStillDead, herrRestSolvable, decoyStillDead, partialNotWin }
}

/** COMPOSITION-SPECIFIC: no tile collisions anywhere in the combined build. */
function checkCollisions(b: ComposedBuild) {
  const rackDistinct = new Set(b.rack.map(key)).size === b.rack.length
  const allDistinct = new Set(b.allTiles.map(key)).size === b.allTiles.length
  // goal covers every tile exactly once, on distinct cells
  const goalKeys = [...b.goal.keys()].sort()
  const tileKeys = b.allTiles.map(key).sort()
  const exactCover = goalKeys.length === tileKeys.length && goalKeys.every((x, i) => x === tileKeys[i])
  const cells = [...b.goal.values()].map(([r, c]) => `${r},${c}`)
  const cellsDistinct = new Set(cells).size === cells.length
  const ok = rackDistinct && allDistinct && exactCover && cellsDistinct
  return { ok, rackDistinct, allDistinct, exactCover, cellsDistinct }
}

console.log('=== COMPOSED archetype verification (decoy + red herring, one board) ===\n')
const DIFFS = ['hard', 'extreme'] as const

console.log('0. Composed puzzles restricted to hard/extreme')
check('buildComposed(easy) === null', buildComposed('easy') === null)
check('buildComposed(medium) === null', buildComposed('medium') === null)
console.log(`   easy=${buildComposed('easy')} medium=${buildComposed('medium')}\n`)

console.log('1. Invariants over 25 puzzles/difficulty (a,b,c,d,e, OBVIOUS x3, TRAP x4, HOME x3)')
for (const diff of DIFFS) {
  const N = 25
  const t = {
    a: 0, b: 0, c: 0, d: 0, e: 0, oDecoy: 0, oLow: 0, oHigh: 0,
    tDecoy: 0, tHigh: 0, tLow: 0, tBoth: 0, hDecoy: 0, hLow: 0, hHigh: 0, all: 0,
  }
  let built = 0; const pars = new Set<number>(); let sample = ''
  for (let i = 0; i < N; i++) {
    const b = buildComposed(diff); if (!b) continue
    built++; pars.add(b.minMoves)
    const r = checkInvariants(b)
    if (r.a) t.a++; if (r.bInv) t.b++; if (r.c) t.c++; if (r.d) t.d++; if (r.e) t.e++
    if (r.oDecoy) t.oDecoy++; if (r.oLow) t.oLow++; if (r.oHigh) t.oHigh++
    if (r.tDecoy) t.tDecoy++; if (r.tHigh) t.tHigh++; if (r.tLow) t.tLow++; if (r.tBoth) t.tBoth++
    if (r.hDecoy) t.hDecoy++; if (r.hLow) t.hLow++; if (r.hHigh) t.hHigh++
    if (r.ok) t.all++
    if (!sample) sample = `D={${b.decoy.n}${b.decoy.c}} Lo={${b.lowExtender.n}${b.lowExtender.c}} H={${b.highExtender.n}${b.highExtender.c}}` +
      ` cD=${b.cDecoy} cH=${b.cHerring} cC=${b.cClean} s=${b.s} L=${b.L} tiles=${b.allTiles.length} par=${b.minMoves} grid=${b.grid.length}x${b.grid[0].length}`
  }
  console.log(`  ${diff}: built ${built}/${N}`)
  console.log(`     a=${t.a} b=${t.b} c=${t.c} d=${t.d} e=${t.e}`)
  console.log(`     OBVIOUS(decoy=${t.oDecoy}, lo=${t.oLow}, hi=${t.oHigh})`)
  console.log(`     TRAP(decoy=${t.tDecoy}, hi=${t.tHigh}, lo=${t.tLow}, both=${t.tBoth})`)
  console.log(`     HOME(decoy=${t.hDecoy}, lo=${t.hLow}, hi=${t.hHigh})   ALL=${t.all}  pars={${[...pars].sort((x, y) => x - y)}}`)
  console.log(`     e.g. ${sample}`)
  check(`${diff}: built at least 20`, built >= 20)
  check(`${diff}: all invariants hold on every build`, t.all === built && built > 0)
}

console.log('\n2. COMPOSITION checks — partial progress does not win or defuse the other trap')
for (const diff of DIFFS) {
  const N = 25
  const t = { rest1: 0, hi: 0, lo: 0, rest2: 0, dec: 0, notWin: 0, all: 0 }
  let built = 0
  for (let i = 0; i < N; i++) {
    const b = buildComposed(diff); if (!b) continue
    built++
    const p = checkPartial(b)
    if (p.decoyRestSolvable) t.rest1++; if (p.highStillDead) t.hi++; if (p.lowStillDead) t.lo++
    if (p.herrRestSolvable) t.rest2++; if (p.decoyStillDead) t.dec++; if (p.partialNotWin) t.notWin++
    if (p.ok) t.all++
  }
  console.log(`  ${diff} (${built} builds):`)
  console.log(`     decoy resolved -> remainder still solvable=${t.rest1}, herring-HIGH still dead=${t.hi}, herring-LOW still dead=${t.lo}`)
  console.log(`     herring resolved -> remainder still solvable=${t.rest2}, decoy-append still dead=${t.dec}`)
  console.log(`     one trap resolved alone is NOT a validateGrid win=${t.notWin}   ALL=${t.all}`)
  check(`${diff}: composition checks hold on every build`, t.all === built && built > 0)
}

console.log('\n3. Tile-collision checks (rack, tile set, goal cover, goal cells)')
for (const diff of DIFFS) {
  const N = 25
  const t = { rackDistinct: 0, allDistinct: 0, exactCover: 0, cellsDistinct: 0, all: 0 }
  let built = 0
  for (let i = 0; i < N; i++) {
    const b = buildComposed(diff); if (!b) continue
    built++
    const r = checkCollisions(b)
    if (r.rackDistinct) t.rackDistinct++; if (r.allDistinct) t.allDistinct++
    if (r.exactCover) t.exactCover++; if (r.cellsDistinct) t.cellsDistinct++
    if (r.ok) t.all++
  }
  console.log(`  ${diff} (${built}): rackDistinct=${t.rackDistinct} allTilesDistinct=${t.allDistinct} goalExactCover=${t.exactCover} goalCellsDistinct=${t.cellsDistinct}  ALL=${t.all}`)
  check(`${diff}: no collisions on any build`, t.all === built && built > 0)
}

console.log('\n4. Witness simulated through the real DROP reducer (simulated == par, win)')
for (const diff of DIFFS) {
  let simmed = 0, exact = 0, wonAll = 0; const lines: string[] = []
  for (let i = 0; i < 6; i++) {
    const b = buildComposed(diff); if (!b) { lines.push(`  #${i + 1} null`); continue }
    const sim = simulateGoal(b.grid, b.rack, b.goal); simmed++
    if (sim.moves === b.minMoves) exact++; if (sim.won) wonAll++
    lines.push(`  #${i + 1}  par=${String(b.minMoves).padStart(2)}  simulated=${String(sim.moves).padStart(2)}  ${sim.moves === b.minMoves ? 'exact' : 'MISMATCH'}  ${sim.note}`)
  }
  console.log(`  ${diff}:`); for (const l of lines) console.log(l)
  check(`${diff}: >=5 simulated`, simmed >= 5)
  check(`${diff}: every simulated == par`, exact === simmed && simmed > 0)
  check(`${diff}: every simulation wins`, wonAll === simmed && simmed > 0)
}

console.log('\n5. Construction wall-clock (12 builds/difficulty)')
for (const diff of DIFFS) {
  const times: number[] = []
  for (let i = 0; i < 12; i++) { const t0 = performance.now(); const b = buildComposed(diff); const t1 = performance.now(); if (b) times.push(t1 - t0) }
  times.sort((a, b) => a - b)
  const avg = times.reduce((s, x) => s + x, 0) / times.length
  console.log(`  ${diff}: builds=${times.length}  avg=${avg.toFixed(2)}ms  min=${times[0].toFixed(2)}ms  max=${times[times.length - 1].toFixed(2)}ms`)
  check(`${diff}: construction stays under 50ms/build`, times[times.length - 1] < 50)
}

console.log('\n6. buildComposedAt(L) boundary: L=5 rejected (k supports consecutive); L=6,7 build; L=8 needs filler {3}')
for (const L of [5, 6, 7, 8]) {
  // L=8 with NO filler has 5 solutions, so the UNIQUE proof step (trap-variety
  // session) rejects it; it was never shipped. With kColour filler {3} it is
  // unique, and that is the L=8 this section now builds.
  if (L === 8) {
    const bare = proveComposedAt(8)
    const failedAt = bare.find(l => !l.ok)?.name ?? '(nothing failed)'
    console.log(`  L=8 no filler: rejected at "${failedAt}"`)
  }
  const b = L === 8 ? buildComposedAt(8, { mirror: false, lowOnClean: false, fillers: [3] }) : buildComposedAt(L)
  if (L === 5) {
    console.log(`  L=${L}: ${b === null ? 'null (correctly rejected)' : 'BUILT (UNEXPECTED)'}`)
    check(`L=${L}: rejected`, b === null)
  } else {
    if (!b) { check(`L=${L} builds`, false); console.log(`  L=${L}: null (UNEXPECTED)`); continue }
    const r = checkInvariants(b); const p = checkPartial(b); const sim = simulateGoal(b.grid, b.rack, b.goal)
    console.log(`  L=${L}: tiles=${b.allTiles.length} par=${b.minMoves} sim=${sim.moves} won=${sim.won} allInv=${r.ok} composition=${p.ok} grid=${b.grid.length}x${b.grid[0].length}`)
    const bareRejected = L !== 8 || (buildComposedAt(8) === null && proveComposedAt(8).some(l => !l.ok && l.name.startsWith('UNIQUE')))
    check(`L=${L}: invariants + composition + simulated==par + win`, r.ok && p.ok && sim.moves === b.minMoves && sim.won && bareRejected)
  }
}

console.log('\n7. generatePuzzle integration (own band, hidden tag, other bands survive)')
for (const diff of DIFFS) {
  let composed = 0, decoys = 0, herrings = 0, total = 0, validAll = 0
  for (let i = 0; i < 300; i++) {
    const p = generatePuzzle(diff); if (!p) continue; total++
    if (p.archetypeId === 'runs-to-groups-composed') {
      composed++
      const all = [...p.grid.flat().filter((t): t is Tile => t !== null), ...p.rack]
      if (validateGrid(p.grid) && solveBag(all).solvable && p.optimalMoves > 0) validAll++
    } else if (p.archetypeId === 'runs-to-groups-decoy') decoys++
    else if (p.archetypeId === 'runs-to-groups-redherring') herrings++
  }
  console.log(`  ${diff}: composed=${composed}/${total} (${(composed / total * 100).toFixed(0)}%)  decoy=${decoys}  redherring=${herrings}  base=${total - composed - decoys - herrings};  valid composed=${validAll}/${composed}`)
  check(`${diff}: composed puzzles emitted`, composed > 0)
  check(`${diff}: decoy band survives`, decoys > 0)
  check(`${diff}: red-herring band survives`, herrings > 0)
  check(`${diff}: base archetypes survive`, total - composed - decoys - herrings > 0)
  check(`${diff}: every emitted composed puzzle is valid`, validAll === composed)
}

console.log(`\n=== SELF-CHECKS: ${pass} passed, ${fail} failed ===`)

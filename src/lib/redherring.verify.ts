// Verification harness for the RED HERRING archetype (buildRedHerring /
// buildRedHerringAt in archetypes.ts). Run: `npx tsx src/lib/redherring.verify.ts`.
//
// Proves, with real executed output per CLAUDE.md's anti-illusion rule:
//   (a) validateGrid(board) true, zero invalid cells at move zero
//   (b) solveBag(all tiles).solvable — both extenders have real homes
//   (c) formsValidSetAlone(expanded rack) === false
//   (d) existsNoRelocationWin(board, rack): win=false AND not exhausted
//   (e) mixedLayoutMoves reaches a validateGrid win (the hybrid goal materialises)
//   OBVIOUS ×2: BOTH extenders score as plausible run-extensions (obviousSpots>0)
//   TRAP ×2:    committing EITHER obvious extension (the other left unplaced)
//               leaves the remainder UNSOLVABLE via solveBag — the coupling
//   HOME ×2:    both extenders have a real destination cell in the hybrid goal
// plus: witness simulated through the REAL reducer == par and wins, timing, that
// red herrings never build on easy/medium, and mutual-exclusivity with decoy.

import type { Tile, Grid } from '../types'
import { validateGrid, getInvalidCells } from './validator'
import { solveBag } from './solver'
import {
  buildRedHerring, buildRedHerringAt, type RedHerringBuild,
  formsValidSetAlone, existsNoRelocationWin, obviousSpots,
} from './archetypes'
import { mixedLayoutMoves } from './mixedGoalPlanner'
import { generatePuzzle } from './generator'

let pass = 0, fail = 0
const check = (label: string, ok: boolean) => { if (ok) pass++; else { fail++; console.log(`  FAIL  ${label}`) } }
const key = (t: Tile) => t.id // goal maps are id-keyed (m=2 Step 5)

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

function checkInvariants(b: RedHerringBuild) {
  const a = validateGrid(b.grid) && getInvalidCells(b.grid).size === 0
  const bInv = solveBag(b.allTiles).solvable === true
  const c = formsValidSetAlone(b.rack) === false
  const dS = existsNoRelocationWin(b.grid, b.rack)
  const d = dS.win === false && dS.exhausted === false
  const home = mixedLayoutMoves(b.grid, b.rack, b.goal)
  const e = !!home && home.reachedGoal && home.validGoal
  const oLow = obviousSpots(b.grid, b.lowExtender).length > 0
  const oHigh = obviousSpots(b.grid, b.highExtender).length > 0
  const without = (trap: Tile[]) => b.allTiles.filter(t => !trap.some(x => x.n === t.n && x.c === t.c))
  const trapHigh = solveBag(without(b.trapHigh)).solvable === false
  const trapLow = solveBag(without(b.trapLow)).solvable === false
  const homeLow = b.goal.has(key(b.lowExtender))
  const homeHigh = b.goal.has(key(b.highExtender))
  const ok = a && bInv && c && d && e && oLow && oHigh && trapHigh && trapLow && homeLow && homeHigh
  return { ok, a, bInv, c, d, e, oLow, oHigh, trapHigh, trapLow, homeLow, homeHigh }
}

console.log('=== RED HERRING archetype verification ===\n')
const DIFFS = ['hard', 'extreme'] as const

console.log('0. Red herrings restricted to hard/extreme')
check('buildRedHerring(easy) === null', buildRedHerring('easy') === null)
check('buildRedHerring(medium) === null', buildRedHerring('medium') === null)
console.log(`   easy=${buildRedHerring('easy')} medium=${buildRedHerring('medium')}\n`)

console.log('1. Invariants over 25 puzzles/difficulty (a,b,c,d,e, OBVIOUS×2, TRAP×2, HOME×2)')
for (const diff of DIFFS) {
  const N = 25
  const t = { a: 0, b: 0, c: 0, d: 0, e: 0, oLow: 0, oHigh: 0, trapHigh: 0, trapLow: 0, homeLow: 0, homeHigh: 0, all: 0 }
  let built = 0; const pars = new Set<number>(); let sample = ''
  for (let i = 0; i < N; i++) {
    const b = buildRedHerring(diff); if (!b) continue
    built++; pars.add(b.minMoves)
    const r = checkInvariants(b)
    if (r.a) t.a++; if (r.bInv) t.b++; if (r.c) t.c++; if (r.d) t.d++; if (r.e) t.e++
    if (r.oLow) t.oLow++; if (r.oHigh) t.oHigh++; if (r.trapHigh) t.trapHigh++; if (r.trapLow) t.trapLow++
    if (r.homeLow) t.homeLow++; if (r.homeHigh) t.homeHigh++; if (r.ok) t.all++
    if (!sample) sample = `Lo={${b.lowExtender.n}${b.lowExtender.c}} H={${b.highExtender.n}${b.highExtender.c}} s=${b.s} L=${b.L} par=${b.minMoves} grid=${b.grid.length}x${b.grid[0].length}`
  }
  console.log(`  ${diff}: built ${built}/${N}  |  a=${t.a} b=${t.b} c=${t.c} d=${t.d} e=${t.e} OBV(lo=${t.oLow},hi=${t.oHigh}) TRAP(hi=${t.trapHigh},lo=${t.trapLow}) HOME(lo=${t.homeLow},hi=${t.homeHigh})  ALL=${t.all}  pars={${[...pars].sort((x, y) => x - y)}}`)
  console.log(`     e.g. ${sample}`)
  check(`${diff}: built at least 20`, built >= 20)
  check(`${diff}: all invariants hold on every build`, t.all === built && built > 0)
}

console.log('\n2. Witness simulated through the real DROP reducer (simulated == par, win)')
for (const diff of DIFFS) {
  let simmed = 0, exact = 0, wonAll = 0; const lines: string[] = []
  for (let i = 0; i < 6; i++) {
    const b = buildRedHerring(diff); if (!b) { lines.push(`  #${i + 1} null`); continue }
    const sim = simulateGoal(b.grid, b.rack, b.goal); simmed++
    if (sim.moves === b.minMoves) exact++; if (sim.won) wonAll++
    lines.push(`  #${i + 1}  par=${String(b.minMoves).padStart(2)}  simulated=${String(sim.moves).padStart(2)}  ${sim.moves === b.minMoves ? 'exact' : 'MISMATCH'}  ${sim.note}`)
  }
  console.log(`  ${diff}:`); for (const l of lines) console.log(l)
  check(`${diff}: >=5 simulated`, simmed >= 5)
  check(`${diff}: every simulated == par`, exact === simmed && simmed > 0)
  check(`${diff}: every simulation wins`, wonAll === simmed && simmed > 0)
}

// The budget is on the MEDIAN of 25 builds after 3 discarded warm-up builds.
// It used to be on the MAX of 12 cold builds, which failed under load for a
// reason that is not a slowdown: the first build in a process pays for JIT
// warm-up (measured 7.6 ms cold vs a 2.0 ms warm median at hard, 2026-11-15),
// and one scheduler hiccup on a busy machine lands on the max. A median is
// immune to both and still fails on a real regression: the measured warm median
// is ~2 ms idle and under 4 busy processes, so 5 ms means a 2.5x slowdown.
console.log('\n3. Construction wall-clock (3 warm-up builds, then median of 25)')
for (const diff of DIFFS) {
  for (let i = 0; i < 3; i++) buildRedHerring(diff)
  const times: number[] = []
  for (let i = 0; i < 25; i++) { const t0 = performance.now(); const b = buildRedHerring(diff); const t1 = performance.now(); if (b) times.push(t1 - t0) }
  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]
  const p90 = times[Math.floor(times.length * 0.9)]
  console.log(`  ${diff}: builds=${times.length}  median=${median.toFixed(2)}ms  p90=${p90.toFixed(2)}ms  min=${times[0].toFixed(2)}ms  max=${times[times.length - 1].toFixed(2)}ms`)
  check(`${diff}: median construction time under 5ms/build`, times.length >= 20 && median < 5)
}

console.log('\n4. buildRedHerringAt(L) boundary: L=5,6 build; L=4,7 rejected')
for (const L of [4, 5, 6, 7]) {
  const b = buildRedHerringAt(L)
  if (L === 5 || L === 6) {
    if (!b) { check(`L=${L} builds`, false); console.log(`  L=${L}: null (UNEXPECTED)`); continue }
    const r = checkInvariants(b); const sim = simulateGoal(b.grid, b.rack, b.goal)
    console.log(`  L=${L}: par=${b.minMoves} sim=${sim.moves} won=${sim.won} allInv=${r.ok} grid=${b.grid.length}x${b.grid[0].length}`)
    check(`L=${L}: invariants + simulated==par + win`, r.ok && sim.moves === b.minMoves && sim.won)
  } else {
    console.log(`  L=${L}: ${b === null ? 'null (correctly rejected)' : 'BUILT (UNEXPECTED)'}`)
    check(`L=${L}: rejected`, b === null)
  }
}

console.log('\n5. generatePuzzle integration (layer wired, hidden tag, mutually exclusive with decoy)')
for (const diff of DIFFS) {
  let herrings = 0, decoys = 0, total = 0, validAll = 0
  for (let i = 0; i < 200; i++) {
    const p = generatePuzzle(diff); if (!p) continue; total++
    if (p.archetypeId === 'runs-to-groups-redherring') {
      herrings++
      const all = [...p.grid.flat().filter((t): t is Tile => t !== null), ...p.rack]
      if (validateGrid(p.grid) && solveBag(all).solvable && p.optimalMoves > 0) validAll++
    } else if (p.archetypeId === 'runs-to-groups-decoy') decoys++
  }
  console.log(`  ${diff}: ${herrings}/${total} red-herrings, ${decoys}/${total} decoys (never both on one puzzle); ${validAll}/${herrings} valid`)
  check(`${diff}: at least one red herring emitted`, herrings > 0)
  check(`${diff}: at least one decoy still emitted (bands disjoint, both survive)`, decoys > 0)
  check(`${diff}: every emitted red herring is valid`, validAll === herrings)
}
{
  const rate = (diff: 'hard' | 'extreme') => {
    let h = 0, n = 0
    for (let i = 0; i < 400; i++) { const p = generatePuzzle(diff); if (!p) continue; n++; if (p.archetypeId === 'runs-to-groups-redherring') h++ }
    return h / n
  }
  const rh = rate('hard'), re = rate('extreme')
  console.log(`  red-herring rate: hard=${(rh * 100).toFixed(0)}%  extreme=${(re * 100).toFixed(0)}%`)
  check('extreme red-herring rate > hard red-herring rate', re > rh)
}

console.log(`\n=== SELF-CHECKS: ${pass} passed, ${fail} failed ===`)

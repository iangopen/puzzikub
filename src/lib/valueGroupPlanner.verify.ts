// Differential harness for planValueGroupGoal (archetypes.ts).
// Run: `npx tsx src/lib/valueGroupPlanner.verify.ts`
//
// planValueGroupGoal used to try all L! value orders. It now tries only the
// ordered choices for goal rows that hold a board tile. This harness proves the
// two give the SAME minimum, against the exhaustive original that is kept in
// archetypes.ts for exactly this purpose:
//   1. builder boards (3 rows occupied), every L the exhaustive one can afford
//   2. SCRAMBLED boards: the same tiles dropped on random cells, so anywhere
//      from 1 to all rows are occupied and fixed tiles / cycles really occur
//   3. the plan it returns replays through the real DROP-reducer semantics to
//      a validateGrid win in exactly `moves` moves
//   4. it still returns null exactly where the original did
//   5. timing, including L=8 (the size the old planner could not afford)

import { type Tile, type Grid, makeTile } from '../types'
import {
  buildRunsToGroupsAt, buildGroupsToRuns, buildRunsToGroups,
  planValueGroupGoal, planValueGroupGoalExhaustive,
} from './archetypes'
import { mixedLayoutMoves } from './mixedGoalPlanner'

let pass = 0, fail = 0
const check = (label: string, ok: boolean) => {
  if (ok) pass++
  else { fail++; console.log(`  FAIL  ${label}`) }
}
const COLORS: Tile['c'][] = ['r', 'b', 'a', 'k']
const rnd = (n: number) => Math.floor(Math.random() * n)
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

console.log('=== 1. builder boards: new planner == exhaustive planner ===')
for (const [L, rack, n] of [[3, 1, 40], [4, 2, 40], [5, 2, 40], [6, 4, 30], [7, 5, 6]] as const) {
  let same = 0, formula = 0, built = 0
  for (let i = 0; i < n; i++) {
    const b = buildRunsToGroupsAt(L, rack)
    if (!b) continue
    built++
    const ex = planValueGroupGoalExhaustive(b.grid, b.rack)
    if (ex && ex.moves === b.minMoves) same++
    if (b.minMoves === 3 * L + rack - 6) formula++
  }
  console.log(`  L=${L} rack=${rack}: built ${built}, equal to exhaustive ${same}, equal to 3L+rack-6 ${formula}`)
  check(`L=${L} builder boards agree with exhaustive`, built > 0 && same === built)
  check(`L=${L} par is 3L+rack-6`, formula === built)
}

console.log('\n=== 1b. the SHIPPED large sizes: L=7 (hard) and L=8 (extreme), 30 builder boards each ===')
// Extreme ships at L=8, so equivalence matters most exactly here. The exhaustive
// planner costs ~1 s (L=7) and ~10 s (L=8) per board, which is why this section
// dominates the harness's run time (several minutes).
let bigCompared = 0, bigMismatch = 0
for (const [L, rack] of [[7, 5], [8, 5]] as const) {
  let built = 0, same = 0, calls = 0
  while (built < 30 && calls < 400) {
    calls++
    const b = buildRunsToGroupsAt(L, rack)
    if (!b) continue
    built++
    const ex = planValueGroupGoalExhaustive(b.grid, b.rack)
    if (ex && ex.moves === b.minMoves) same++
    else console.log(`  MISMATCH L=${L}: new=${b.minMoves} exhaustive=${ex?.moves}`)
  }
  bigCompared += built
  bigMismatch += built - same
  console.log(`  L=${L} rack=${rack}: ${built} boards compared, ${same} equal, ${built - same} mismatches; ` +
    `builder rejection rate ${calls - built}/${calls} calls (${(100 * (calls - built) / calls).toFixed(0)}%)`)
  check(`L=${L}: 30 builder boards agree with exhaustive`, built === 30 && same === 30)
}
console.log(`  large-size total: ${bigCompared} boards, ${bigMismatch} mismatches`)

console.log('\n=== 2. scrambled boards: new planner == exhaustive planner ===')
// Tiles of an N-colour x L-value block (some values 3 colours, some 4), split
// at random between board and rack, board tiles on random cells.
let scrambled = 0, agree = 0, withFixedOrCycle = 0, replayed = 0
const occupiedRowHist = new Map<number, number>()
for (let trial = 0; trial < 400; trial++) {
  const L = 3 + rnd(4) // 3..6
  const s = 1 + rnd(14 - L)
  const cols4 = shuffle(COLORS)
  const all: Tile[] = []
  for (let o = 0; o < L; o++) {
    const k = 3 + rnd(2)
    for (const c of cols4.slice(0, k)) all.push(makeTile(s + o, c))
  }
  const rows = L + rnd(3)
  const cols = 4 + rnd(4)
  const grid: Grid = Array.from({ length: rows }, () => Array(cols).fill(null))
  const tiles = shuffle(all)
  const rackN = rnd(Math.min(6, tiles.length - 3))
  const rack = tiles.slice(0, rackN)
  // Half the trials pack the board tiles into few rows, half spread them out.
  const cells = shuffle(Array.from({ length: rows * cols }, (_, i) => i))
  const pool = trial % 2 === 0 ? cells : [...cells].sort((a, b) => a - b)
  tiles.slice(rackN).forEach((t, i) => { grid[Math.floor(pool[i] / cols)][pool[i] % cols] = t })

  const a = planValueGroupGoal(grid, rack)
  const b = planValueGroupGoalExhaustive(grid, rack)
  scrambled++
  if ((a === null) === (b === null) && (!a || a.moves === b!.moves)) agree++
  else console.log(`  MISMATCH trial ${trial}: new=${a?.moves} exhaustive=${b?.moves}`)
  if (a) {
    const res = mixedLayoutMoves(grid, rack, a.goal)
    if (res && (res.fixed > 0 || res.cycles > 0)) withFixedOrCycle++
    if (res && res.reachedGoal && res.validGoal && res.moves === a.moves) replayed++
  }
  const occ = grid.filter(r => r.some(Boolean)).length
  occupiedRowHist.set(occ, (occupiedRowHist.get(occ) ?? 0) + 1)
}
console.log(`  ${scrambled} scrambled boards, ${agree} agree, ${withFixedOrCycle} had fixed tiles or cycles in the optimum`)
console.log(`  occupied rows per board: ${[...occupiedRowHist.entries()].sort((x, y) => x[0] - y[0]).map(([k, v]) => `${k}:${v}`).join(' ')}`)
console.log(`  ${replayed} plans replayed through the reducer to a validateGrid win in exactly par`)
check('every scrambled board agrees with exhaustive', agree === scrambled)
check('every scrambled plan replays to a win in exactly par', replayed === scrambled)
check('scrambled boards really exercise fixed tiles / cycles', withFixedOrCycle > 50)
check('scrambled boards cover more than 3 occupied rows', [...occupiedRowHist.keys()].some(k => k > 3))

console.log('\n=== 3. builder plans replay through the reducer ===')
// Pinned pars. extreme is 23 since the generator-audit recalibration (L=8).
const PAR = { easy: 11, medium: 16, hard: 20, extreme: 23 } as const
for (const diff of ['easy', 'medium', 'hard', 'extreme'] as const) {
  let ok = 0
  const pars = new Set<number>()
  // The builder may legitimately return null (uniqueness gate), so retry.
  let calls = 0, rejected = 0
  for (let built = 0, tries = 0; built < 10 && tries < 400; tries++) {
    const b = buildRunsToGroups(diff)
    calls++
    if (!b) { rejected++; continue }
    built++
    const plan = planValueGroupGoal(b.grid, b.rack)!
    const res = mixedLayoutMoves(b.grid, b.rack, plan.goal)
    if (res && res.reachedGoal && res.validGoal && res.moves === b.minMoves) ok++
    pars.add(b.minMoves)
  }
  console.log(`  ${diff}: 10 builds, ${ok} replay to a validateGrid win in par; par = ${[...pars].join(',')}`)
  console.log(`    builder rejection rate: ${rejected}/${calls} calls (${(100 * rejected / calls).toFixed(0)}%)`)
  check(`${diff}: all plans replay exactly`, ok === 10)
  check(`${diff}: par is exactly ${PAR[diff]}`, pars.size === 1 && pars.has(PAR[diff]))
}

console.log('\n=== 4. null cases unchanged ===')
{
  let both = 0
  for (let i = 0; i < 20; i++) {
    const g = buildGroupsToRuns('hard')!
    if (planValueGroupGoal(g.grid, g.rack) === null && planValueGroupGoalExhaustive(g.grid, g.rack) === null) both++
  }
  console.log(`  groups-to-runs tiles: both planners null on ${both}/20`)
  check('groups-to-runs tiles are rejected by both', both === 20)
}

console.log('\n=== 5. timing (ms per buildRunsToGroupsAt, 10 builds each) ===')
for (const [L, rack] of [[5, 2], [6, 4], [7, 5], [8, 5]] as const) {
  const ts: number[] = []
  let par = -1
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now()
    const b = buildRunsToGroupsAt(L, rack)
    ts.push(performance.now() - t0)
    if (b) par = b.minMoves
  }
  ts.sort((x, y) => x - y)
  console.log(`  L=${L} rack=${rack}: median ${ts[5].toFixed(1)}  max ${ts[9].toFixed(1)}  par ${par}`)
  check(`L=${L} builds in under 250 ms`, ts[9] < 250)
}
{
  const b = buildRunsToGroupsAt(7, 5)!
  const t0 = performance.now()
  planValueGroupGoalExhaustive(b.grid, b.rack)
  console.log(`  for reference, the exhaustive planner on one L=7 board: ${(performance.now() - t0).toFixed(0)} ms`)
}

console.log(`\n=== SELF-CHECKS: ${pass} passed, ${fail} failed ===`)
if (fail > 0) process.exit(1)

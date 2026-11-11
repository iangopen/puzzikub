import type { Tile, Grid, Difficulty } from '../types'
import { makeTile } from '../types'
import { solveBag, solveBagM2 } from './solver'
import { validateGrid, getInvalidCells, getNewlyValidCells, isValidRun, isValidGroup } from './validator'
import {
  buildGroupsToRuns,
  buildRunsToGroups,
  formsValidSetAlone,
  existsNoRelocationWin,
  obviousPlacementWins,
  isTrivial,
  planColorRunGoal,
  planValueGroupGoal,
  type GoalPlan,
} from './archetypes'
import { generatePuzzle } from './generator'

let pass = 0
let fail = 0

function check(label: string, condition: boolean) {
  if (condition) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}`) }
}

const showGrid = (g: Grid) =>
  g.map(r => r.map(t => (t ? `${String(t.n).padStart(2)}${t.c}` : ' . ')).join(' ')).join('\n')
const showTiles = (ts: Tile[]) => ts.map(t => `${t.n}${t.c}`).join(' ')
const showSet = (s: Set<string>) => s.size === 0 ? '{}' : `{ ${[...s].join('  ')} }`

console.log('=== SOLVER SELF-TESTS ===')
check('empty bag is unsolvable', solveBag([]).solvable === false)
check('run of 3 same-color consecutive is solvable',
  solveBag([makeTile(3, 'r'),makeTile(4, 'r'),makeTile(5, 'r')]).solvable === true)
check('run of 2 is unsolvable', solveBag([makeTile(3, 'r'),makeTile(4, 'r')]).solvable === false)
check('group of 3 same-value diff-color is solvable',
  solveBag([makeTile(5, 'r'),makeTile(5, 'b'),makeTile(5, 'k')]).solvable === true)
check('2 same-value tiles alone is unsolvable',
  solveBag([makeTile(5, 'r'),makeTile(5, 'b')]).solvable === false)

const dualBlock: Tile[] = []
for (const c of ['r','b','a'] as const) for (let v = 5; v <= 8; v++) dualBlock.push(makeTile(v, c))
check('3x4 dual block (runs or groups) is solvable', solveBag(dualBlock).solvable === true)
check('single unmatched tile is unsolvable', solveBag([makeTile(9, 'k')]).solvable === false)
const solvedResult = solveBag([makeTile(3, 'r'),makeTile(4, 'r'),makeTile(5, 'r')])
check('assignment field is populated when solvable',
  solvedResult.assignment !== undefined && solvedResult.assignment.size === 3)

// ---------------------------------------------------------------------------
// The rule change itself: only horizontal contiguous segments confer validity.
// ---------------------------------------------------------------------------
console.log('')
console.log('=== VALIDATOR RULE: HORIZONTAL-ONLY COVERAGE ===')

const hRun: Grid = Array.from({ length: 4 }, () => Array(4).fill(null))
;[4,5,6].forEach((n, i) => { hRun[1][i] = makeTile(n, 'r') })
check('horizontal run of 3 is valid', validateGrid(hRun) === true)

const hGroup: Grid = Array.from({ length: 4 }, () => Array(4).fill(null))
;(['r','b','a'] as const).forEach((c, i) => { hGroup[1][i] = makeTile(7, c) })
check('horizontal group of 3 is valid', validateGrid(hGroup) === true)

const vRun: Grid = Array.from({ length: 4 }, () => Array(4).fill(null))
;[4,5,6].forEach((n, i) => { vRun[i][1] = makeTile(n, 'r') })
check('the SAME run arranged vertically is now INVALID', validateGrid(vRun) === false)

const vGroup: Grid = Array.from({ length: 4 }, () => Array(4).fill(null))
;(['r','b','a'] as const).forEach((c, i) => { vGroup[i][1] = makeTile(7, c) })
check('the SAME group arranged vertically is now INVALID', validateGrid(vGroup) === false)

// ---------------------------------------------------------------------------
// m=2 MIGRATION Step 3 — confirmation only, per MIGRATION_M2.md: prove the
// existing validator already handles duplicate (value,colour) tiles with ZERO
// code changes, since isValidRun sorts + requires strict consecutiveness (a
// repeated value breaks that) and isValidGroup compares distinct-colour count
// to array length (a repeated colour breaks that). If any check below fails,
// the audit was wrong and validator.ts needs real design work, not a patch.
// ---------------------------------------------------------------------------
console.log('')
console.log('=== m=2 STEP 3: VALIDATOR DUPLICATE-AWARENESS (confirmation only) ===')

check('isValidRun rejects a duplicate value ([3r#0,3r#1,4r#0])',
  isValidRun([makeTile(3, 'r', 0), makeTile(3, 'r', 1), makeTile(4, 'r', 0)]) === false)

check('isValidGroup rejects a duplicate colour ([5r#0,5r#1,5b#0])',
  isValidGroup([makeTile(5, 'r', 0), makeTile(5, 'r', 1), makeTile(5, 'b', 0)]) === false)

check('isValidGroup rejects a duplicate colour even at 4 tiles ([7r#0,7r#1,7b#0,7a#0])',
  isValidGroup([makeTile(7, 'r', 0), makeTile(7, 'r', 1), makeTile(7, 'b', 0), makeTile(7, 'a', 0)]) === false)

{
  // The actual m=2 case: the SAME (value,colour) duplicated across two
  // different, independently valid runs must be a legal board.
  const dupGrid: Grid = Array.from({ length: 2 }, () => Array(5).fill(null))
  ;[0, 1].forEach(row => {
    ;[3, 4, 5].forEach((n, i) => { dupGrid[row][i] = makeTile(n, 'r', row) })
  })
  check('validateGrid accepts duplicate (value,colour) tiles split across two valid runs',
    validateGrid(dupGrid) === true)

  // Same board shape, but row 1 is short one tile — must still be rejected.
  const incompleteDupGrid: Grid = Array.from({ length: 2 }, () => Array(5).fill(null))
  ;[3, 4, 5].forEach((n, i) => { incompleteDupGrid[0][i] = makeTile(n, 'r', 0) })
  ;[3, 4].forEach((n, i) => { incompleteDupGrid[1][i] = makeTile(n, 'r', 1) })
  check('validateGrid still rejects an incomplete run even when it duplicates board values',
    validateGrid(incompleteDupGrid) === false)

  const invalidCells = getInvalidCells(incompleteDupGrid)
  check('getInvalidCells flags only the incomplete duplicate-bearing row',
    invalidCells.size === 2 && invalidCells.has('1,0') && invalidCells.has('1,1'))
  check('getInvalidCells leaves the complete duplicate-bearing row (row 0) unflagged',
    !invalidCells.has('0,0') && !invalidCells.has('0,1') && !invalidCells.has('0,2'))

  const newlyValid = getNewlyValidCells(incompleteDupGrid, dupGrid)
  check('getNewlyValidCells reports exactly the row that became valid, duplicate values notwithstanding',
    newlyValid.size === 3 && newlyValid.has('1,0') && newlyValid.has('1,1') && newlyValid.has('1,2'))
}

// ---------------------------------------------------------------------------
// Regression: fill-in-the-blank boards must be rejected. Both shapes are now
// stated horizontally, because that is the only orientation that can win.
// ---------------------------------------------------------------------------
console.log('')
console.log('=== REGRESSION: known fill-in-the-blank boards must be rejected ===')

// Horizontal run extension: row 2 is 7r 8r 9r; 10r appends and the grid is won.
const fitbRun: Grid = Array.from({ length: 5 }, () => Array(10).fill(null))
;(['k','b','r'] as const).forEach((c, r) => { for (let i = 0; i < 3; i++) fitbRun[r][i] = makeTile(7 + i, c) })
check('board is valid before the rack is placed', validateGrid(fitbRun) === true)
check('horizontal run-extension win is detected (existsNoRelocationWin)',
  existsNoRelocationWin(fitbRun, [makeTile(10, 'r')]).win === true)
check('horizontal run-extension win is detected (isTrivial)',
  isTrivial(fitbRun, [makeTile(10, 'r')]) === true)

// Horizontal group completion: row 0 is 5r 5b 5a; 5k appends into a group of 4.
const fitbGroup: Grid = Array.from({ length: 5 }, () => Array(10).fill(null))
;(['r','b','a'] as const).forEach((c, i) => { fitbGroup[0][i] = makeTile(5, c) })
;[7,8,9].forEach((n, i) => { fitbGroup[2][i] = makeTile(n, 'r') })
;[2,3,4].forEach((n, i) => { fitbGroup[4][i] = makeTile(n, 'b') })
check('group-completion board is valid before the rack is placed', validateGrid(fitbGroup) === true)
check('horizontal group-completion win is detected (existsNoRelocationWin)',
  existsNoRelocationWin(fitbGroup, [makeTile(5, 'k')]).win === true)
check('horizontal group-completion win is detected (isTrivial)',
  isTrivial(fitbGroup, [makeTile(5, 'k')]) === true)

// The old vertical trap: 8a beneath the 8-column used to complete a group of
// four eights. Under horizontal-only coverage it is just a lone tile in row 3.
check('the OLD vertical group-completion is no longer a win',
  existsNoRelocationWin(fitbRun, [makeTile(8, 'a')]).win === false)

// Failure mode 2: rack is a complete run on its own.
const freeGrid: Grid = Array.from({ length: 5 }, () => Array(10).fill(null))
;(['k','b','r'] as const).forEach((c, r) => { for (let i = 0; i < 3; i++) freeGrid[r][i] = makeTile(7 + i, c) })
const freeRack: Tile[] = [makeTile(4, 'a'),makeTile(5, 'a'),makeTile(6, 'a'),makeTile(7, 'a'),makeTile(8, 'a')]
check('free-standing rack run is detected (formsValidSetAlone)',
  formsValidSetAlone(freeRack) === true)
check('free-standing rack run is detected (isTrivial)', isTrivial(freeGrid, freeRack) === true)

// ---------------------------------------------------------------------------
// The (d) search is pruned. An unsound prune would hide real wins and bless
// trivial puzzles, so it is cross-checked two ways: against wins planted deeper
// than one move, and against an unpruned brute force over every empty cell.
// ---------------------------------------------------------------------------
console.log('')
console.log('=== (d) SEARCH SOUNDNESS ===')

// This file is a standalone script run via `npx tsx` under Node, but it lives
// under src/ and is typechecked against tsconfig.app.json (browser lib, no
// Node types) — so `process` needs a local declaration rather than @types/node.
declare const process: { env: Record<string, string | undefined> }

/** DEEP=1 also brute-forces rack-of-4 puzzles (minutes each). */
const DEEP = process.env.DEEP === '1'
console.log(`  deep unpruned cross-check on rack-of-4 puzzles: ${DEEP ? 'ON' : 'off (set DEEP=1)'}`)

function bruteNoRelocationWin(board: Grid, rack: Tile[]): boolean {
  const grid = board.map(r => [...r])
  const empties: [number, number][] = []
  for (let r = 0; r < grid.length; r++)
    for (let c = 0; c < grid[0].length; c++)
      if (!grid[r][c]) empties.push([r, c])
  const rec = (i: number): boolean => {
    if (i === rack.length) return validateGrid(grid)
    for (const [r, c] of empties) {
      if (grid[r][c]) continue
      grid[r][c] = rack[i]
      if (rec(i + 1)) return true
      grid[r][c] = null
    }
    return false
  }
  return rec(0)
}

// depth-2 win: a run of 3 on the board, rack extends it by two tiles at the end.
const deep1: Grid = Array.from({ length: 5 }, () => Array(9).fill(null))
;[5, 6, 7].forEach((n, i) => { deep1[1][1 + i] = makeTile(n, 'r') })
;(['b','a','k'] as const).forEach((c, i) => { deep1[3][1 + i] = makeTile(4, c) })
check('depth-2 run extension is found (planted win)',
  existsNoRelocationWin(deep1, [makeTile(8, 'r'),makeTile(9, 'r')]).win === true)

// depth-2 win requiring a GAP to be filled, not just an endpoint extended.
const deep2: Grid = Array.from({ length: 5 }, () => Array(9).fill(null))
deep2[1][1] = makeTile(5, 'r')
deep2[1][3] = makeTile(7, 'r')
;(['b','a','k'] as const).forEach((c, i) => { deep2[3][1 + i] = makeTile(4, c) })
check('depth-2 gap fill + endpoint extension is found (planted win)',
  existsNoRelocationWin(deep2, [makeTile(6, 'r'),makeTile(8, 'r')]).win === true)

// a board where genuinely no no-relocation win exists must not be reported as one
const deep3: Grid = Array.from({ length: 5 }, () => Array(9).fill(null))
;(['b','a','k'] as const).forEach((c, i) => { deep3[1][1 + i] = makeTile(4, c) })
check('no false positive on a board with no possible win',
  existsNoRelocationWin(deep3, [makeTile(11, 'r'),makeTile(13, 'b')]).win === false)
check('  ...and brute force agrees', bruteNoRelocationWin(deep3, [makeTile(11, 'r'),makeTile(13, 'b')]) === false)
check('planted wins agree with brute force (deep1)',
  bruteNoRelocationWin(deep1, [makeTile(8, 'r'),makeTile(9, 'r')]) === true)
check('planted wins agree with brute force (deep2)',
  bruteNoRelocationWin(deep2, [makeTile(6, 'r'),makeTile(8, 'r')]) === true)

// ---------------------------------------------------------------------------
// Planted win on a REAL generated board. Unpruned brute force over a rack of 4
// on the real geometry (50-64 empty cells) is ~10^7 leaves, so it cannot serve
// as the cross-check there. Instead: hand the real board a rack that provably
// HAS a no-relocation win — four consecutive values in one colour, none of them
// on the board, which drop into the empty top row as a free-standing run — and
// demand the pruned search finds it. If the row-only prune ever discarded a
// reachable win at rack-of-4 depth, this is where it would show.
// ---------------------------------------------------------------------------
function plantedRunRack(grid: Grid): Tile[] | null {
  const used = new Set<number>()
  for (const t of grid.flat()) if (t) used.add(t.n)
  for (let v = 1; v + 3 <= 13; v++) {
    if ([v, v+1, v+2, v+3].every(x => !used.has(x)))
      return [v, v+1, v+2, v+3].map(n => (makeTile(n, 'r' as const)))
  }
  return null
}

// ---------------------------------------------------------------------------
// Invariants (a)-(d) against real generated puzzles.
// ---------------------------------------------------------------------------
console.log('')
console.log('=== INVARIANTS (a)-(d) ON REAL GENERATED PUZZLES ===')
console.log('  a: validateGrid(startBoard)          b: solveBag(board+rack).solvable')
console.log('  c: rack forms no valid set alone     d: no no-relocation win exists')
console.log('')

const difficulties: Difficulty[] = ['easy', 'medium', 'hard', 'extreme']
const WANTED = 25
const MAX_ATTEMPTS = 400
let anyInvariantFailed = false

/** The two directions of the duality, each with the goal shape it targets. */
const ARCHETYPES = [
  { id: 'groups-to-runs' as const, build: buildGroupsToRuns, plan: planColorRunGoal },
  { id: 'runs-to-groups' as const, build: buildRunsToGroups, plan: planValueGroupGoal },
]

const sampleKey = (a: string, d: Difficulty) => `${a}|${d}`
const samples = new Map<string, { grid: Grid; rack: Tile[]; minMoves: number }[]>()

/**
 * (e) The puzzle must actually be winnable ON THE GRID, not merely partitionable
 * as a bag. Materialise the archetype's own goal plan onto an empty grid and
 * demand that every tile lands on a distinct cell and that validateGrid accepts
 * the result. Shape-agnostic: whichever goal the builder is aiming at, this
 * checks that goal really is a win — not that it matches some hard-coded shape.
 */
function goalLayoutIsReachable(grid: Grid, allTiles: Tile[], plan: GoalPlan | null): boolean {
  if (!plan) return false
  const goal: Grid = Array.from({ length: grid.length }, () => Array(grid[0].length).fill(null))
  for (const t of allTiles) {
    const pos = plan.goal.get(t.id)
    if (!pos) return false
    const [r, c] = pos
    if (r < 0 || r >= goal.length || c < 0 || c >= goal[0].length) return false
    if (goal[r][c]) return false // two tiles claimed the same cell
    goal[r][c] = t
  }
  return validateGrid(goal)
}

for (const arch of ARCHETYPES) {
  console.log(`########## ARCHETYPE: ${arch.id} ##########`)
  console.log('')
  for (const diff of difficulties) {
    let built = 0, attempts = 0, nulls = 0
    let failA = 0, failB = 0, failC = 0, failD = 0, failDobvious = 0, failCollision = 0, exhausted = 0
    let failE = 0, bruteChecked = 0, bruteDisagree = 0
    let plantChecked = 0, plantMissed = 0
    let coverChecked = 0, coverDirty = 0
    const rackSizes: number[] = []
    const moveCounts: number[] = []
    const t0 = Date.now()

    while (built < WANTED && attempts < MAX_ATTEMPTS) {
      attempts++
      const result = arch.build(diff)
      if (!result) { nulls++; continue }
      built++
      const { grid, rack, allTiles, minMoves } = result
      const sk = sampleKey(arch.id, diff)
      if (!samples.has(sk)) samples.set(sk, [])
      if (samples.get(sk)!.length < 2) samples.get(sk)!.push({ grid, rack, minMoves })

      if (!validateGrid(grid)) { failA++; anyInvariantFailed = true }
      if (!solveBag(allTiles).solvable) { failB++; anyInvariantFailed = true }
      if (formsValidSetAlone(rack)) { failC++; anyInvariantFailed = true }

      const search = existsNoRelocationWin(grid, rack)
      if (search.win) { failD++; anyInvariantFailed = true }
      if (search.exhausted) { exhausted++; anyInvariantFailed = true }
      if (obviousPlacementWins(grid, rack)) { failDobvious++; anyInvariantFailed = true }

      // Deliberately a LABEL key, not `t.id`: this asserts the builders still
      // emit m=1-shaped puzzles (no (value,colour) twice). Step 11's duplicate
      // archetype is what relaxes it — until then a collision here is a bug.
      const keys = allTiles.map(t => `${t.n}_${t.c}`)
      if (new Set(keys).size !== keys.length) { failCollision++; anyInvariantFailed = true }

      if (!goalLayoutIsReachable(grid, allTiles, arch.plan(grid, rack))) { failE++; anyInvariantFailed = true }

      // Starting board shows clean, fully-covered horizontal sets at move zero.
      coverChecked++
      if (getInvalidCells(grid).size !== 0) { coverDirty++; anyInvariantFailed = true }

      // Planted-win soundness on the real geometry, at full rack depth.
      if (plantChecked < 5) {
        const planted = plantedRunRack(grid)
        if (planted) {
          plantChecked++
          if (!existsNoRelocationWin(grid, planted).win) { plantMissed++; anyInvariantFailed = true }
        }
      }

      // Unpruned cross-check. Cheap for rack <= 3; for rack 4 the unpruned search
      // is ~10^7 leaves on this geometry, so it runs only under DEEP=1.
      const affordable = rack.length <= 3 ? bruteChecked < 10 : DEEP && bruteChecked < 1
      if (affordable) {
        bruteChecked++
        if (bruteNoRelocationWin(grid, rack) !== search.win) { bruteDisagree++; anyInvariantFailed = true }
      }

      rackSizes.push(rack.length)
      moveCounts.push(minMoves)
    }

    const avg = (xs: number[]) => xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : 'n/a'
    const ms = Date.now() - t0

    console.log(`${diff}:  (${built} puzzles built from ${attempts} attempts, ${nulls} rejected by builder, ${ms}ms)`)
    console.log(`  ${built - failA} / ${built}  pass (a) starting board valid`)
    console.log(`  ${built - failB} / ${built}  pass (b) board+rack solvable`)
    console.log(`  ${built - failC} / ${built}  pass (c) rack forms no valid set alone`)
    console.log(`  ${built - failD - exhausted} / ${built}  pass (d) no no-relocation win  (${failD} had a win, ${exhausted} unproven/budget)`)
    console.log(`  ${built - failDobvious} / ${built}  pass (d-literal) obvious placements do not win`)
    console.log(`  ${built - failE} / ${built}  pass (e) the goal plan materialises to a validateGrid win`)
    console.log(`  ${built - failCollision} / ${built}  no duplicate tiles`)
    console.log(`  ${coverChecked - coverDirty} / ${coverChecked}  starting board has ZERO invalid cells`)
    console.log(`  planted-win cross-check (4-tile free-standing run on real boards): ${plantChecked} planted, ${plantMissed} missed by the pruned search`)
    console.log(`  (d) vs unpruned brute force: ${bruteChecked} cross-checked, ${bruteDisagree} disagreements${bruteChecked === 0 ? '  (rack of 4 — run with DEEP=1)' : ''}`)
    console.log(`  rack size: min ${Math.min(...rackSizes)}  max ${Math.max(...rackSizes)}  avg ${avg(rackSizes)}`)
    console.log(`  reference solution length (minMoves): avg ${avg(moveCounts)}`)
    console.log('')
  }
}

// ---------------------------------------------------------------------------
// The board as the player first sees it: every tile must sit inside a valid
// horizontal set, so getInvalidCells must be literally empty. Printed, not
// summarised.
// ---------------------------------------------------------------------------
console.log('=== STARTING BOARDS AT MOVE ZERO (2 real puzzles per archetype per difficulty) ===')
for (const arch of ARCHETYPES) {
  for (const diff of difficulties) {
    for (const [i, s] of (samples.get(sampleKey(arch.id, diff)) ?? []).entries()) {
      const invalid = getInvalidCells(s.grid)
      console.log(`\n--- ${arch.id} / ${diff} #${i + 1} --- rack: ${showTiles(s.rack)}   minMoves: ${s.minMoves}`)
      console.log(showGrid(s.grid))
      console.log(`  validateGrid = ${validateGrid(s.grid)}`)
      console.log(`  getInvalidCells = ${showSet(invalid)}   size = ${invalid.size}`)
    }
  }
}

// ---------------------------------------------------------------------------
// minMoves is a claim about the real game, so it is settled by playing the real
// game. `applyDrop` below is a line-for-line transcription of the DROP branch of
// usePlayState's reducer — crucially, GRID→GRID onto an occupied cell swaps the
// two tiles in a single move, which is where the cycle savings come from.
//
// The plan is executed the way the cost proof says it can be: drain every path
// (tile whose goal cell is empty) first, then unwind each remaining cycle by
// swapping into the goal cell, then drop the rack onto the cells now free. If
// the simulated move count ever differs from planColorRunGoal's number, or the
// final grid does not satisfy validateGrid, the number is wrong.
// ---------------------------------------------------------------------------
console.log('=== minMoves: SIMULATED REAL MOVE SEQUENCE (reducer semantics) ===')

type Drop =
  | { from: 'grid'; r: number; c: number; tr: number; tc: number }
  | { from: 'rack'; idx: number; tr: number; tc: number }

function applyDrop(grid: Grid, rack: Tile[], d: Drop): void {
  if (d.from === 'rack') {
    const tile = rack[d.idx]
    rack.splice(d.idx, 1)
    const displaced = grid[d.tr][d.tc]
    grid[d.tr][d.tc] = tile
    if (displaced) rack.push(displaced)
  } else {
    const tile = grid[d.r][d.c]
    grid[d.r][d.c] = grid[d.tr][d.tc]
    grid[d.tr][d.tc] = tile
  }
}

interface SimResult { moves: number; won: boolean; note: string }

function simulatePlan(startGrid: Grid, startRack: Tile[], plan: GoalPlan | null): SimResult | null {
  if (!plan) return null

  const grid = startGrid.map(r => [...r])
  const rack = [...startRack]
  const goalOf = (t: Tile) => plan.goal.get(t.id)!
  let moves = 0

  const misplaced = (): [number, number][] => {
    const out: [number, number][] = []
    for (let r = 0; r < grid.length; r++)
      for (let c = 0; c < grid[0].length; c++) {
        const t = grid[r][c]
        if (!t) continue
        const [gr, gc] = goalOf(t)
        if (gr !== r || gc !== c) out.push([r, c])
      }
    return out
  }

  const budget = grid.length * grid[0].length * 4
  for (let guard = 0; guard <= budget; guard++) {
    const bad = misplaced()
    if (bad.length === 0) break
    if (guard === budget) return { moves, won: false, note: 'board phase did not terminate' }

    // A tile whose goal cell is empty: plain relocation, drains a path tail-first.
    const drain = bad.find(([r, c]) => {
      const [gr, gc] = goalOf(grid[r][c]!)
      return grid[gr][gc] === null
    })
    const [r, c] = drain ?? bad[0] // otherwise every goal is occupied: unwind a cycle
    const [tr, tc] = goalOf(grid[r][c]!)
    applyDrop(grid, rack, { from: 'grid', r, c, tr, tc })
    moves++
  }

  // Every board tile is home, so each rack tile's goal cell is now empty.
  while (rack.length > 0) {
    const [tr, tc] = goalOf(rack[0])
    if (grid[tr][tc] !== null) return { moves, won: false, note: `rack goal (${tr},${tc}) was occupied` }
    applyDrop(grid, rack, { from: 'rack', idx: 0, tr, tc })
    moves++
  }

  const won = rack.length === 0 && validateGrid(grid)
  return { moves, won, note: won ? 'validateGrid passed' : 'final grid INVALID' }
}

// Built directly from each archetype (not generatePuzzle) so both directions are
// exercised at every difficulty regardless of the 50/50 coin flip.
for (const arch of ARCHETYPES) {
  for (const diff of difficulties) {
    let simmed = 0, exact = 0, wonAll = 0
    const lines: string[] = []
    for (let i = 0; i < 5; i++) {
      // A builder may legitimately reject a draw (e.g. the runs-to-groups
      // uniqueness gate rejects ~30% at easy), so retry as generateArchetype does.
      let result = arch.build(diff)
      for (let t = 0; !result && t < 40; t++) result = arch.build(diff)
      if (!result) { lines.push(`  #${i + 1} builder returned null`); continue }
      const sim = simulatePlan(result.grid, result.rack, arch.plan(result.grid, result.rack))
      if (!sim) { lines.push(`  #${i + 1} no plan`); continue }
      simmed++
      if (sim.moves === result.minMoves) exact++
      if (sim.won) wonAll++
      lines.push(`  #${i + 1}  par=${String(result.minMoves).padStart(2)}  simulated=${String(sim.moves).padStart(2)}  ` +
        `${sim.moves === result.minMoves ? 'exact match' : 'MISMATCH'}  ${sim.note}`)
    }
    console.log(`${arch.id} / ${diff}:`)
    for (const l of lines) console.log(l)
    check(`${arch.id}/${diff}: simulated move count equals par on all 5`, simmed === 5 && exact === 5)
    check(`${arch.id}/${diff}: simulated sequence ends in a validateGrid win on all 5`, simmed === 5 && wonAll === 5)
    console.log('')
  }
}

console.log('')
console.log('=== PLAYER-FACING generatePuzzle() — with internal retry + 50/50 direction ===')
const dirTally: Record<string, number> = {}
// m=2 Step 11: the game now legitimately ships DUPLICATE-BEARING puzzles (the
// cut-point archetype), and the m=1 solveBag rejects any duplicate outright —
// so it is no longer the right oracle for generatePuzzle() output. The bag
// check below uses solveBagM2, but the differential value of keeping solveBag
// alive (see its retirement note in solver.ts) is PRESERVED, not discarded:
// on every duplicate-FREE puzzle the two solvers must still agree, and that is
// asserted here rather than assumed.
let differentialChecked = 0, differentialDisagreed = 0
for (const diff of difficulties) {
  let ok = 0
  const GENS = 40
  for (let i = 0; i < GENS; i++) {
    const puzzle = generatePuzzle(diff)
    if (!puzzle) continue
    dirTally[puzzle.archetypeId ?? '?'] = (dirTally[puzzle.archetypeId ?? '?'] ?? 0) + 1
    const boardTiles = puzzle.grid.flat().filter((t): t is Tile => t !== null)
    const allTiles = [...boardTiles, ...puzzle.rack]
    const labels = new Set(allTiles.map(t => `${t.n}_${t.c}`))
    const hasDuplicate = labels.size !== allTiles.length
    const m2 = solveBagM2(allTiles).solvable
    if (!hasDuplicate) {
      differentialChecked++
      if (solveBag(allTiles).solvable !== m2) differentialDisagreed++
    }
    if (validateGrid(puzzle.grid) && m2 && !isTrivial(puzzle.grid, puzzle.rack)) ok++
  }
  console.log(`${diff}: ${ok}/${GENS} generatePuzzle() calls produced a fully valid, non-trivial puzzle`)
}
const dirTotal = Object.values(dirTally).reduce((a, b) => a + b, 0)
console.log(`direction mix over ${dirTotal} generated puzzles:`)
for (const [id, n] of Object.entries(dirTally))
  console.log(`  ${id.padEnd(16)} ${n}  (${((n / dirTotal) * 100).toFixed(0)}%)`)
// Both base dualities must still appear; the optional hard/extreme decoy layer
// adds a third internal category (runs-to-groups-decoy) and is not required here.
check('both base directions are generated',
  (dirTally['groups-to-runs'] ?? 0) > 0 && (dirTally['runs-to-groups'] ?? 0) > 0)
console.log(`solveBag vs solveBagM2 on the ${differentialChecked} duplicate-free puzzles above: ${differentialDisagreed} disagreements`)
check('solveBag and solveBagM2 still agree on every duplicate-free generated puzzle',
  differentialChecked > 0 && differentialDisagreed === 0)

console.log('')
console.log(`=== SELF-TESTS: ${pass} passed, ${fail} failed ===`)
console.log(`=== INVARIANTS (a)-(d): ${anyInvariantFailed ? 'AT LEAST ONE FAILED' : 'ALL PASSED on every generated puzzle'} ===`)

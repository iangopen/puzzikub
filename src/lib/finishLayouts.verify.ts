// Verification harness for the FINISH CHECK against equivalent layouts.
// Run: `npx tsx src/lib/finishLayouts.verify.ts`.
//
// The uniqueness rule (distinctSolutions) calls a run of six and the same tiles
// laid as 3+3 ONE solution. This harness shows the finish check agrees: for real
// hard and extreme groups-to-runs puzzles it lays out EVERY strict partition
// (every way to leave each run whole or cut it), in several positions, plays each
// one move by move through the REAL reducer (playReducer.ts, the code the app
// runs), and requires `won` on the last move and on no earlier move.
// Negative controls show the check is not simply accepting everything.
import type { Tile, Grid, Puzzle, Difficulty } from '../types'
import { playReducer, INITIAL_PLAY_STATE, type PlayState } from './playReducer'
import { validateGrid } from './validator'
import { buildGroupsToRunsAt } from './archetypes'
import { cutCompositions, type PlacedPiece } from './cutRunPlanner'
import { mixedLayoutMoves } from './mixedGoalPlanner'
import { distinctSolutions, partitionCount } from './difficultyProxy'

let rngState = 20261115
Math.random = (): number => {
  rngState = (rngState + 0x6d2b79f5) | 0
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

let pass = 0, fail = 0
const check = (name: string, ok: boolean): void => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
}

const COLORS: Tile['c'][] = ['r', 'b', 'a', 'k']
interface Run { color: Tile['c']; lo: number; hi: number }

function runsOf(bag: Tile[]): Run[] {
  return COLORS.filter(c => bag.some(t => t.c === c)).map(c => {
    const vs = bag.filter(t => t.c === c).map(t => t.n)
    return { color: c, lo: Math.min(...vs), hi: Math.max(...vs) }
  })
}

function goalOf(bag: Tile[], pieces: PlacedPiece[]): Map<string, [number, number]> {
  const goal = new Map<string, [number, number]>()
  for (const p of pieces)
    for (let v = p.lo; v <= p.hi; v++) goal.set(bag.find(t => t.c === p.color && t.n === v)!.id, [p.row, p.col + (v - p.lo)])
  return goal
}

interface Played { won: boolean; wonEarly: boolean; moves: number; state: PlayState; drops: number }

/** Play to `goal` through the real reducer, one DROP per witness move. */
function play(puzzle: Puzzle, goal: Map<string, [number, number]>, stopBefore = 0): Played | null {
  const plan = mixedLayoutMoves(puzzle.grid, puzzle.rack, goal)
  if (!plan) return null
  let state = playReducer(INITIAL_PLAY_STATE, { type: 'LOAD', puzzle })
  let wonEarly = false
  const drops = plan.witness.slice(0, plan.witness.length - stopBefore)
  drops.forEach((d, i) => {
    state = playReducer(state, d.from === 'rack'
      ? { type: 'DROP', src: { from: 'rack', rackIdx: state.rack.findIndex(t => t.id === d.key) }, target: { to: 'grid', row: d.tr, col: d.tc } }
      : { type: 'DROP', src: { from: 'grid', row: d.r, col: d.c }, target: { to: 'grid', row: d.tr, col: d.tc } })
    if (state.won && i < plan.witness.length - 1) wonEarly = true
  })
  return { won: state.won, wonEarly, moves: state.moves, state, drops: drops.length }
}

// L=5 is the pre-session hard size and L=6 the shipped hard size (it was the
// extreme size); both have long runs. "extreme" below means L=6.
const SIZE: Record<string, number> = { easy: 3, medium: 4, hard: 5, extreme: 6 }
const puzzleOf = (diff: Difficulty): Puzzle => {
  for (let i = 0; i < 200; i++) {
    const b = buildGroupsToRunsAt(SIZE[diff], diff === 'easy' ? 2 : 4)
    if (b) return { id: 'x', name: 'x', diff, grid: b.grid, rack: b.rack, optimalMoves: b.minMoves, generated: true }
  }
  throw new Error(`no groups-to-runs build at L=${SIZE[diff]}`)
}

/** Each colour on its own row, its pieces left to right with one empty cell between. */
function gapLayout(runs: Run[], cut: number[][]): PlacedPiece[] {
  const out: PlacedPiece[] = []
  runs.forEach((run, row) => {
    let col = 0, at = run.lo
    for (const len of cut[row]) { out.push({ color: run.color, lo: at, hi: at + len - 1, row, col }); col += len + 1; at += len }
  })
  return out
}

/** Pieces dropped at random free positions (no overlap, no two strips touching). */
function scatterLayout(runs: Run[], cut: number[][], rows: number, cols: number): PlacedPiece[] | null {
  for (let attempt = 0; attempt < 400; attempt++) {
    const used = new Set<string>()
    const out: PlacedPiece[] = []
    let ok = true
    runs.forEach((run, i) => {
      let at = run.lo
      for (const len of cut[i]) {
        let placed = false
        for (let tries = 0; tries < 60 && !placed; tries++) {
          const row = Math.floor(Math.random() * rows), col = Math.floor(Math.random() * (cols - len + 1))
          let free = true
          for (let k = -1; k <= len; k++) if (used.has(`${row},${col + k}`)) free = false
          if (!free) continue
          for (let k = 0; k < len; k++) used.add(`${row},${col + k}`)
          out.push({ color: run.color, lo: at, hi: at + len - 1, row, col })
          placed = true
        }
        if (!placed) ok = false
        at += len
      }
    })
    if (ok) return out
  }
  return null
}

function allCuts(runs: Run[]): number[][][] {
  let acc: number[][][] = [[]]
  for (const run of runs) {
    const next: number[][][] = []
    for (const a of acc) for (const comp of cutCompositions(run.hi - run.lo + 1)) next.push([...a, comp])
    acc = next
  }
  return acc
}

// ===========================================================================
console.log('=== 1. every strict partition of a real puzzle wins, in every position tried ===')
for (const diff of ['hard', 'extreme'] as Difficulty[]) { // L=5 and L=6
  const PUZZLES = 4
  let layouts = 0, wins = 0, early = 0, validGoals = 0, moveMismatch = 0, cutLayouts = 0, partitionsSeen = 0, partitionsExpected = 0
  let allUnique = true
  for (let i = 0; i < PUZZLES; i++) {
    const p = puzzleOf(diff)
    const bag = [...p.grid.flat().filter((t): t is Tile => !!t), ...p.rack]
    const runs = runsOf(bag)
    const cuts = allCuts(runs)
    if (distinctSolutions(bag, 1000).count !== 1) allUnique = false
    partitionsExpected += partitionCount(bag, 1000)
    partitionsSeen += cuts.length
    const rows = p.grid.length, cols = p.grid[0].length
    for (const cut of cuts) {
      const candidates: (PlacedPiece[] | null)[] = [gapLayout(runs, cut), scatterLayout(runs, cut, rows, cols), scatterLayout(runs, cut, rows, cols)]
      for (const pieces of candidates) {
        if (!pieces) continue
        const goal = goalOf(bag, pieces)
        const r = play(p, goal)
        if (!r) continue
        layouts++
        if (pieces.length > runs.length) cutLayouts++
        if (r.won) wins++
        if (r.wonEarly) early++
        if (validateGrid(r.state.grid) && r.state.rack.length === 0) validGoals++
        if (r.moves !== r.drops) moveMismatch++
      }
    }
    if (i === 0) {
      const cut = cuts[cuts.length - 1]
      console.log(`  e.g. ${diff} puzzle 1: runs ${runs.map(r => `${r.color}${r.lo}-${r.hi}`).join(' ')}; ${cuts.length} strict partitions; last one cuts them as ${cut.map(c => c.join('+')).join(' | ')}`)
    }
  }
  console.log(`  ${diff}: ${PUZZLES} puzzles, ${partitionsSeen} strict partitions (partitionCount says ${partitionsExpected}), ${layouts} layouts played (${cutLayouts} with a cut run): won ${wins}, won before the last move ${early}`)
  check(`${diff}: every puzzle has exactly one distinct solution (so all these layouts are "the same answer")`, allUnique)
  check(`${diff}: the layouts cover every strict partition`, partitionsSeen === partitionsExpected && partitionsSeen > PUZZLES)
  check(`${diff}: at least 3 layouts per partition were played`, layouts >= partitionsSeen * 3 - PUZZLES && cutLayouts > 0)
  check(`${diff}: the finish check says WON on every layout`, wins === layouts && validGoals === layouts)
  check(`${diff}: never won before the last move, and moves == drops`, early === 0 && moveMismatch === 0)
}

// ===========================================================================
console.log('\n=== 2. the same puzzle solved whole, cut on one row, and cut across rows ===')
{
  const p = puzzleOf('hard')
  const bag = [...p.grid.flat().filter((t): t is Tile => !!t), ...p.rack]
  const runs = runsOf(bag)
  const whole = runs.map(r => [r.hi - r.lo + 1])
  const halves = runs.map(r => cutCompositions(r.hi - r.lo + 1).find(c => c.length === 2)!)
  const show = (g: Grid): string => g.map(r => '    ' + r.map(t => (t ? `${t.n}${t.c}`.padStart(3) : '  .')).join(' ')).join('\n')
  const named: [string, PlacedPiece[]][] = [
    ['every run whole', gapLayout(runs, whole)],
    ['every run cut in two, both pieces on one row with a gap', gapLayout(runs, halves)],
    // Low half at the right edge of its own row, high half at the left of the next row.
    ['every run cut in two, pieces placed apart', runs.flatMap((r, i) => {
      const [a] = halves[i]
      return [
        { color: r.color, lo: r.lo, hi: r.lo + a - 1, row: i, col: p.grid[0].length - a },
        { color: r.color, lo: r.lo + a, hi: r.hi, row: (i + 1) % runs.length, col: 0 },
      ]
    })],
    ['only the first run cut', gapLayout(runs, [halves[0], ...whole.slice(1)])],
  ]
  for (const [name, pieces] of named) {
    const r = play(p, goalOf(bag, pieces))
    console.log(`  ${name}: won=${r?.won} in ${r?.moves} moves (par ${p.optimalMoves})`)
    if (r && name.includes('apart')) console.log(show(r.state.grid))
    check(name, !!r && r.won && !r.wonEarly)
  }

  // ---- negative controls: the same reducer refuses layouts that are not valid
  console.log('\n=== 3. negative controls: the finish check refuses invalid layouts ===')
  const cols = p.grid[0].length
  const r0 = runs[0], r1 = runs[1]
  const [a0] = halves[0]
  const neg: [string, PlacedPiece[]][] = [
    // The one-row cut layout, with the second colour's low half moved up against
    // the end of the first colour's high half.
    ['two strips of different colours touching (no gap)', gapLayout(runs, halves).map(q =>
      q.color === r1.color && q.lo === r1.lo ? { ...q, row: 0, col: cols - (q.hi - q.lo + 1) } : q)],
    ['a run cut as 2 + 4', [
      { color: r0.color, lo: r0.lo, hi: r0.lo + 1, row: 0, col: 0 }, { color: r0.color, lo: r0.lo + 2, hi: r0.hi, row: 0, col: 3 },
      ...gapLayout(runs.slice(1), whole.slice(1)).map(q => ({ ...q, row: q.row + 1 })),
    ]],
  ]
  for (const [name, pieces] of neg) {
    if (pieces.reduce((s, q) => s + q.hi - q.lo + 1, 0) !== bag.length) { check(`${name} (control layout holds every tile)`, false); continue }
    const r = play(p, goalOf(bag, pieces))
    const flagged = r ? [...r.state.invalidCells].filter(k => !k.startsWith('__v:')).length : 0
    console.log(`  ${name}: won=${r?.won}, rack ${r?.state.rack.length}, ${flagged} cells flagged invalid`)
    check(`${name}: NOT won, and cells are flagged`, !!r && !r.won && r.state.rack.length === 0 && flagged > 0)
  }
  {
    // The two halves touching in the RIGHT order are simply the whole run: wins.
    const pieces = [
      { color: r0.color, lo: r0.lo, hi: r0.lo + a0 - 1, row: 0, col: 0 }, { color: r0.color, lo: r0.lo + a0, hi: r0.hi, row: 0, col: a0 },
      ...gapLayout(runs.slice(1), whole.slice(1)).map(q => ({ ...q, row: q.row + 1 })),
    ]
    const r = play(p, goalOf(bag, pieces))
    check('the two halves touching in the right order are the whole run: won', !!r && r.won)
  }
  {
    // Runs must read ascending left to right (validator.ts isOrderedRun, pinned by
    // runOrder.verify.ts). The two halves touching in the WRONG order, e.g.
    // "5 6 7 2 3 4" in one colour, are not a run: NOT won. This was accepted until
    // 2026-11-15.
    const pieces = [
      { color: r0.color, lo: r0.lo + a0, hi: r0.hi, row: 0, col: 0 }, { color: r0.color, lo: r0.lo, hi: r0.lo + a0 - 1, row: 0, col: r0.hi - r0.lo + 1 - a0 },
      ...gapLayout(runs.slice(1), whole.slice(1)).map(q => ({ ...q, row: q.row + 1 })),
    ]
    const r = play(p, goalOf(bag, pieces))
    console.log(`  the two halves of a run touching in the WRONG order (${r0.lo + a0}-${r0.hi} then ${r0.lo}-${r0.lo + a0 - 1}): won=${r?.won}`)
    check('a run whose tiles are out of left-to-right order: NOT won, and cells are flagged', !!r && !r.won && r.state.rack.length === 0 && [...r.state.invalidCells].some(k => !k.startsWith('__v:')))
  }
  {
    // A valid board with one tile still in the rack is not a win.
    const r = play(p, goalOf(bag, gapLayout(runs, halves)), 1)
    console.log(`  cut layout stopped one move short: won=${r?.won}, rack ${r?.state.rack.length}`)
    check('one tile still in the rack: NOT won', !!r && !r.won && r.state.rack.length === 1)
    // Undo after a win clears it; replaying the move wins again.
    const full = play(p, goalOf(bag, gapLayout(runs, halves)))!
    const undone = playReducer(full.state, { type: 'UNDO' })
    check('Undo after a cut-layout win clears won', full.won && !undone.won && undone.moves === full.moves)
  }
}

console.log(`\n=== SELF-CHECKS: ${pass} passed, ${fail} failed ===`)

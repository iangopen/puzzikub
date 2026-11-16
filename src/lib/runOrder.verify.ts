// Verification harness for RUN ORDER in the finish check.
// Run: `npx tsx src/lib/runOrder.verify.ts`.
//
// Rule enforced (2026-11-15): a run on the board must read in ASCENDING order,
// left to right, one step at a time ("3 4 5", never "5 3 4" or "5 4 3").
// The Tutorial says "consecutive order" (src/components/Tutorial.tsx:11) and
// every example is ascending, but nothing settled the direction, so ascending is
// the Rummikub convention. `isValidRun` stays an ORDER-FREE bag predicate (the
// solver and builders reason about bags, which have no order); only the GRID
// check (`validateGrid` / `getInvalidCells`) reads order.
import type { Tile, Grid, Puzzle } from '../types'
import { makeTile } from '../types'
import { validateGrid, getInvalidCells, isValidRun } from './validator'
import { playReducer, INITIAL_PLAY_STATE } from './playReducer'

let pass = 0, fail = 0
const check = (name: string, ok: boolean): void => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`)
}

/** One row from a spec like "3r 4r 5r _ 7b 7r 7k"; `_` is an empty cell. */
function row(spec: string, copyOf = new Map<string, number>()): (Tile | null)[] {
  return spec.split(' ').map(s => {
    if (s === '_') return null
    const n = parseInt(s, 10), c = s.slice(String(n).length) as Tile['c']
    const k = `${n}${c}`, copy = copyOf.get(k) ?? 0
    copyOf.set(k, copy + 1)
    return makeTile(n, c, copy)
  })
}
const grid = (...rows: string[]): Grid => { const m = new Map<string, number>(); return rows.map(r => row(r, m)) }

console.log('=== 1. validateGrid on single rows ===')
const cases: [string, string, boolean][] = [
  ['ascending run 3 4 5', '3r 4r 5r', true],
  ['ascending run 1..13', '1r 2r 3r 4r 5r 6r 7r 8r 9r 10r 11r 12r 13r', true],
  ['out of order 5 3 4', '5r 3r 4r', false],
  ['out of order 3 5 4', '3r 5r 4r', false],
  ['descending 5 4 3', '5r 4r 3r', false],
  ['halves touching in the wrong order 6 7 8 3 4 5', '6r 7r 8r 3r 4r 5r', false],
  ['halves touching in the right order 3 4 5 6 7 8 (= whole run)', '3r 4r 5r 6r 7r 8r', true],
  ['long run cut into valid shorter runs 3 4 5 _ 6 7 8', '3r 4r 5r _ 6r 7r 8r', true],
  ['cut pieces in any order along the row 6 7 8 _ 3 4 5', '6r 7r 8r _ 3r 4r 5r', true],
  ['group 7 7 7 in any colour order', '7k 7r 7b', true],
  ['group of four, any colour order', '7a 7k 7r 7b', true],
  ['gap in values 3 4 6', '3r 4r 6r', false],
]
for (const [name, spec, want] of cases) {
  const g = grid(spec)
  const got = validateGrid(g)
  const flagged = getInvalidCells(g).size
  console.log(`  [${spec}] validateGrid=${got} flagged=${flagged}`)
  check(`${name}: ${want ? 'valid' : 'INVALID'}`, got === want && (want ? flagged === 0 : flagged > 0))
}

console.log('\n=== 2. isValidRun is still an order-free BAG predicate ===')
check('isValidRun([5,3,4]) is true (bags have no order)', isValidRun(row('5r 3r 4r') as Tile[]))

console.log('\n=== 3. through the real play reducer ===')
// Board holds 3r 4r and a valid group; the rack holds 5r. Dropping 5r to the
// RIGHT of 4r wins; dropping it to the LEFT of 3r ("5 3 4") must not.
const puzzle = (): Puzzle => ({
  id: 'x', name: 'x', diff: 'easy', generated: true, optimalMoves: 1,
  grid: grid('_ 3r 4r _', '7r 7b 7k _'),
  rack: [makeTile(5, 'r')],
})
{
  let s = playReducer(INITIAL_PLAY_STATE, { type: 'LOAD', puzzle: puzzle() })
  s = playReducer(s, { type: 'DROP', src: { from: 'rack', rackIdx: 0 }, target: { to: 'grid', row: 0, col: 3 } })
  console.log(`  5r dropped right of 4r: won=${s.won} rack=${s.rack.length}`)
  check('"3 4 5" finishes the puzzle', s.won && s.rack.length === 0)
}
{
  let s = playReducer(INITIAL_PLAY_STATE, { type: 'LOAD', puzzle: puzzle() })
  s = playReducer(s, { type: 'DROP', src: { from: 'rack', rackIdx: 0 }, target: { to: 'grid', row: 0, col: 0 } })
  const flagged = [...s.invalidCells].filter(k => !k.startsWith('__v:'))
  console.log(`  5r dropped left of 3r: won=${s.won} rack=${s.rack.length} flagged=${flagged.join(' ')}`)
  check('"5 3 4" does NOT finish the puzzle, and its cells are flagged', !s.won && s.rack.length === 0 && flagged.length === 3)
}

console.log(`\n=== SELF-CHECKS: ${pass} passed, ${fail} failed ===`)

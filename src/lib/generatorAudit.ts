/**
 * Generator audit: `npx tsx src/lib/generatorAudit.ts [N] [filter]`.
 *
 * For every archetype x tier, generates N real puzzles through the real
 * `generatePuzzle` path and prints par distribution, shape variety, generation
 * time, solution counts and the non-par difficulty proxies from
 * difficultyProxy.ts. Output is Markdown tables on stdout. `filter` is a
 * substring of the row label (e.g. "hard" or "decoy").
 */
import type { Difficulty, Puzzle, Tile } from '../types'
import { generatePuzzle, FORCE_TYPES, type ForceType } from './generator'
import { validateGrid } from './validator'
import { solveBagM2 } from './solver'
import { formsValidSetAlone, existsNoRelocationWin } from './archetypes'
import { partitionCount, trapDensity, myopicCascade, guessworkCost, boardTraps, techniqueLadder } from './difficultyProxy'

const N = Number(process.argv[2] ?? 200)
const FILTER = process.argv[3] ?? ''
const DIFFS: Difficulty[] = ['easy', 'medium', 'hard', 'extreme']
const COLORS: Tile['c'][] = ['r', 'b', 'a', 'k']

function perms<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs]
  return xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p]))
}
const COLOR_PERMS = perms(COLORS)

/** Layout + rack, exactly as generated. */
function exactSig(p: Puzzle): string {
  const g = p.grid.map(r => r.map(t => (t ? `${t.n}${t.c}` : '.')).join(' ')).join('/')
  return `${g}|${p.rack.map(t => `${t.n}${t.c}`).sort().join(' ')}`
}

/** The same, up to a value shift and a relabelling of the four colours. */
function structSig(p: Puzzle): string {
  const all = [...p.grid.flat().filter((t): t is Tile => !!t), ...p.rack]
  const vmin = Math.min(...all.map(t => t.n))
  let best = ''
  for (const perm of COLOR_PERMS) {
    const m = (t: Tile) => `${t.n - vmin}${perm[COLORS.indexOf(t.c)]}`
    const g = p.grid.map(r => r.map(t => (t ? m(t) : '.')).join(' ')).join('/')
    const s = `${g}|${p.rack.map(m).sort().join(' ')}`
    if (best === '' || s < best) best = s
  }
  return best
}

const pct = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
const dist = (xs: number[]): string => {
  const m = new Map<number, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ')
}
const f1 = (x: number): string => x.toFixed(1)

interface Row { label: string; cells: Record<string, string> }
const tableA: Row[] = []
const tableB: Row[] = []
const mix: string[] = []
let invariantFailures = 0
let oracleDisagreements = 0

function audit(label: string, diff: Difficulty, force?: ForceType): void {
  if (FILTER && !label.includes(FILTER)) return
  const puzzles: Puzzle[] = []
  const times: number[] = []
  for (let i = 0; i < N; i++) {
    const t0 = performance.now()
    const p = generatePuzzle(diff, force)
    times.push(performance.now() - t0)
    if (!p) { if (i === 0) return; continue } // archetype does not exist at this tier
    puzzles.push(p)
  }
  if (puzzles.length === 0) return

  if (!force) {
    const kinds = new Map<string, number>()
    for (const p of puzzles) kinds.set(p.archetypeId ?? '?', (kinds.get(p.archetypeId ?? '?') ?? 0) + 1)
    mix.push(`| ${diff} | ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / puzzles.length).toFixed(0)}%`).join(', ')} |`)
  }

  const pars = puzzles.map(p => p.optimalMoves ?? -1)
  const sols: number[] = []
  const deadFrac: number[] = []
  const plaus: number[] = []
  const depth: number[] = []
  const resolved: number[] = []
  const zero: number[] = []
  const guess: number[] = []
  const mustBreak: number[] = []
  const tempt: number[] = []
  const temptDead: number[] = []
  let stalled = 0
  const lad: number[][] = [[], [], [], []]
  const maxLv: number[] = []
  for (const p of puzzles) {
    const board = p.grid.flat().filter((t): t is Tile => !!t)
    const bag = [...board, ...p.rack]
    // Invariants (a)-(d), re-checked independently of the builders.
    const search = existsNoRelocationWin(p.grid, p.rack)
    if (!validateGrid(p.grid) || !solveBagM2(bag).solvable || formsValidSetAlone(p.rack) || search.win || search.exhausted)
      invariantFailures++
    const pc = partitionCount(bag, 1000)
    if (pc === 0) oracleDisagreements++ // solveBagM2 says solvable, the counter found none
    sols.push(pc)
    const td = trapDensity(bag)
    plaus.push(td.plausible)
    deadFrac.push(td.dead / td.plausible)
    const mc = myopicCascade(bag)
    depth.push(mc.depth)
    resolved.push(mc.resolved)
    zero.push(mc.forcedAtZero)
    if (mc.stalled) stalled++
    guess.push(guessworkCost(bag, 20).mean)
    const tl = techniqueLadder(bag)
    tl.steps.forEach((x, i) => lad[i].push(x))
    maxLv.push(tl.maxLevel)
    const bt = boardTraps(p.grid, p.rack)
    mustBreak.push(bt.rowsMustBreak / bt.rows)
    tempt.push(bt.tempting)
    temptDead.push(bt.temptingDead)
  }

  const g = puzzles[0].grid
  const colSet = new Set(puzzles.map(p => p.grid[0].length))
  tableA.push({
    label,
    cells: {
      n: String(puzzles.length),
      par: dist(pars),
      tiles: dist(puzzles.map(p => p.grid.flat().filter(Boolean).length + p.rack.length)),
      grid: colSet.size === 1 ? `${g.length}x${g[0].length}` : `cols ${[...colSet].sort((a, b) => a - b).join('/')}`,
      exact: String(new Set(puzzles.map(exactSig)).size),
      struct: String(new Set(puzzles.map(structSig)).size),
      ms: `${f1(mean(times))} / ${f1(pct(times, 0.95))} / ${f1(Math.max(...times))}`,
    },
  })
  tableB.push({
    label,
    cells: {
      sols: `${pct(sols, 0.5)}${sols.some(s => s >= 1000) ? '+' : ''} (${Math.min(...sols)}-${Math.max(...sols)})`,
      unique: `${(100 * sols.filter(s => s === 1).length / sols.length).toFixed(0)}%`,
      plausible: f1(mean(plaus)),
      dead: `${(100 * mean(deadFrac)).toFixed(0)}%`,
      mustBreak: `${(100 * mean(mustBreak)).toFixed(0)}%`,
      tempting: `${f1(mean(temptDead))}/${f1(mean(tempt))}`,
      zero: `${(100 * mean(zero)).toFixed(0)}%`,
      cascade: `${f1(mean(depth))}${stalled ? ` (stalls ${(100 * stalled / puzzles.length).toFixed(0)}%, ${(100 * mean(resolved)).toFixed(0)}% placed)` : ''}`,
      guess: f1(mean(guess)),
      ladder: lad.map(l => f1(mean(l))).join(' / '),
      maxLv: dist(maxLv),
    },
  })
  process.stderr.write(`done ${label}\n`)
}

const print = (title: string, heads: [string, string][], rows: Row[]): void => {
  console.log(`\n### ${title}\n`)
  console.log(`| archetype / tier | ${heads.map(h => h[1]).join(' | ')} |`)
  console.log(`|---|${heads.map(() => '---').join('|')}|`)
  for (const r of rows) console.log(`| ${r.label} | ${heads.map(h => r.cells[h[0]]).join(' | ')} |`)
}

for (const force of FORCE_TYPES) for (const diff of DIFFS) audit(`${force} / ${diff}`, diff, force)
for (const diff of DIFFS) audit(`SHIPPED MIX / ${diff}`, diff)

console.log(`\nN = ${N} puzzles per row, generated through generatePuzzle().`)
print('A. Par, size, variety, generation time', [
  ['n', 'n'], ['par', 'par (value:count)'], ['tiles', 'tiles'], ['grid', 'grid rows x cols'],
  ['exact', 'distinct exact'], ['struct', 'distinct structural'], ['ms', 'gen ms mean / p95 / max'],
], tableA)
print('B. Non-par difficulty proxies', [
  ['sols', 'solutions median (min-max)'], ['unique', 'unique'], ['plausible', 'plausible sets'],
  ['dead', 'dead sets'], ['mustBreak', 'board rows that must break'], ['tempting', 'tempting rack tiles dead/total'],
  ['zero', 'forced at move 0'], ['cascade', 'myopic depth'], ['guess', 'guesswork undos'],
  ['ladder', 'ladder steps L0 / L1 / L2 / L3'], ['maxLv', 'hardest technique (level:count)'],
], tableB)
if (mix.length) {
  console.log('\n### C. Shipped archetype mix\n\n| tier | archetypes |\n|---|---|')
  for (const m of mix) console.log(m)
}
console.log(`\nInvariant (a)-(d) failures: ${invariantFailures}`)
console.log(`partitionCount vs solveBagM2 disagreements: ${oracleDisagreements}`)

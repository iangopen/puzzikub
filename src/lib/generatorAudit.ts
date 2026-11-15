/**
 * Generator audit: `npx tsx src/lib/generatorAudit.ts [N] [filter] [seed]`.
 *
 * For every archetype x tier, generates N real puzzles through the real
 * `generatePuzzle` path and prints par distribution, shape variety, generation
 * time, solution counts and the non-par difficulty proxies from
 * difficultyProxy.ts. Output is Markdown tables on stdout. `filter` is a
 * comma-separated list of row-label substrings (e.g. "decoy,SHIPPED MIX / hard").
 *
 * Table D is the VERDICT: per shipped tier, the share of puzzles with more than
 * one distinct solution and the share whose par is outside the tier's band. The
 * process exits 1 if either is above zero for any audited SHIPPED MIX row.
 *
 * What this script got wrong before the uniqueness/tier session, and now fixes:
 *  - NO SEED. It drew from Math.random, so no two runs measured the same
 *    puzzles and a before/after pair was two different samples. Math.random is
 *    now a seeded generator, re-seeded per row from (seed, row label), so a row
 *    is reproducible on its own and under any filter.
 *  - IT COUNTED CUTS AS SOLUTIONS. "solutions" was `partitionCount`, which
 *    counts a run of six and the same six tiles as two runs of three as two
 *    answers. That is where groups-to-runs' "16" and "81" came from (2^4 and
 *    3^4: four long runs, each cut or not). It now reports both numbers: strict
 *    partitions, and DISTINCT solutions (same tiles in the same groups = same
 *    solution). The distinct count is computed here by brute force over every
 *    partition (`distinctSolutionsBrute`), NOT by the search the generator's
 *    gate uses, and the two are compared on every puzzle.
 *  - THE RATER GRADED A FREE CHOICE AS ITS HARDEST TECHNIQUE. See
 *    `techniqueLadder`: "L3" meant both "needs deep search" and "any choice
 *    works". Both readings are printed (old rater / fixed rater).
 *  - NO TIER DEFINITION, NO PASS/FAIL. It printed distributions and left the
 *    reader to judge. Bands now live in tierBands.ts and table D checks them.
 */
import type { Difficulty, Puzzle, Tile } from '../types'
import { generatePuzzle, generationStats, FORCE_TYPES, type ForceType } from './generator'
import { validateGrid } from './validator'
import { solveBagM2 } from './solver'
import { formsValidSetAlone, existsNoRelocationWin } from './archetypes'
import {
  partitionCount, distinctSolutions, distinctSolutionsBrute, trapDensity, myopicCascade, guessworkCost, boardTraps, techniqueLadder,
} from './difficultyProxy'
import { PAR_BAND, tierOfPar } from './tierBands'

const N = Number(process.argv[2] ?? 200)
const FILTER = process.argv[3] ?? ''
const SEED = Number(process.argv[4] ?? 20261115)

/** mulberry32. Replaces Math.random for the whole process: every random draw in
 * the generator and the builders goes through it, so a row is reproducible. */
let rngState = 0
Math.random = (): number => {
  rngState = (rngState + 0x6d2b79f5) | 0
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const reseed = (label: string): void => {
  let h = SEED | 0
  for (let i = 0; i < label.length; i++) h = (Math.imul(h, 31) + label.charCodeAt(i)) | 0
  rngState = h
}
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
const dist2 = (xs: string[]): string => {
  const m = new Map<string, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return ['easy', 'medium', 'hard', 'extreme', 'none'].filter(k => m.has(k)).map(k => `${k}:${m.get(k)}`).join(' ')
}

interface Row { label: string; cells: Record<string, string> }
const tableA: Row[] = []
const tableB: Row[] = []
const tableD: Row[] = []
const mix: string[] = []
let invariantFailures = 0
let oracleDisagreements = 0
let uniquenessDisagreements = 0
let verdictFailures = 0

function audit(label: string, diff: Difficulty, force?: ForceType): void {
  if (FILTER && !FILTER.split(',').some(f => label.includes(f))) return
  reseed(label)
  const stats = generationStats as { attempts: number; rejected: number; notUnique?: number; outOfBand?: number }
  stats.attempts = 0
  stats.rejected = 0
  if (stats.notUnique !== undefined) stats.notUnique = 0
  if (stats.outOfBand !== undefined) stats.outOfBand = 0
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
  const oldLv: number[] = []
  const free: number[] = []
  const distinct: number[] = []
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
    // Distinct solutions, by brute force over every partition (independent of
    // the generator's gate), compared with the gate's own search.
    const brute = distinctSolutionsBrute(bag)
    const fast = distinctSolutions(bag, 1000).count
    if (brute.count !== fast || brute.partitions !== partitionCount(bag, 200_000)) uniquenessDisagreements++
    distinct.push(brute.count)
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
    oldLv.push(tl.freeChoices > 0 ? 3 : tl.maxLevel) // what the rater said before the fix
    free.push(tl.freeChoices)
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
      rej: `${(100 * generationStats.rejected / Math.max(1, generationStats.attempts)).toFixed(0)}% (${generationStats.rejected}/${generationStats.attempts})`,
      ms: `${f1(mean(times))} / ${f1(pct(times, 0.95))} / ${f1(Math.max(...times))}`,
    },
  })
  tableB.push({
    label,
    cells: {
      sols: `${pct(sols, 0.5)}${sols.some(s => s >= 1000) ? '+' : ''} (${Math.min(...sols)}-${Math.max(...sols)})`,
      distinct: `${pct(distinct, 0.5)} (${Math.min(...distinct)}-${Math.max(...distinct)})`,
      unique: `${(100 * distinct.filter(s => s === 1).length / distinct.length).toFixed(0)}%`,
      plausible: f1(mean(plaus)),
      dead: `${(100 * mean(deadFrac)).toFixed(0)}%`,
      mustBreak: `${(100 * mean(mustBreak)).toFixed(0)}%`,
      tempting: `${f1(mean(temptDead))}/${f1(mean(tempt))}`,
      zero: `${(100 * mean(zero)).toFixed(0)}%`,
      cascade: `${f1(mean(depth))}${stalled ? ` (stalls ${(100 * stalled / puzzles.length).toFixed(0)}%, ${(100 * mean(resolved)).toFixed(0)}% placed)` : ''}`,
      guess: f1(mean(guess)),
      ladder: lad.map(l => f1(mean(l))).join(' / '),
      maxLv: dist(maxLv),
      oldLv: dist(oldLv),
      free: f1(mean(free)),
    },
  })
  // Table D: the verdict for this row against its tier's band.
  const [lo, hi] = PAR_BAND[diff]
  const multi = distinct.filter(s => s !== 1).length
  const outOfBand = pars.filter(x => x < lo || x > hi).length
  const pass = multi === 0 && outOfBand === 0 && puzzles.length === N
  if (!force && !pass) verdictFailures++
  tableD.push({
    label,
    cells: {
      n: String(puzzles.length),
      multi: `${multi} (${(100 * multi / puzzles.length).toFixed(1)}%)`,
      cuts: String(sols.filter(x => x > 1).length),
      band: `${lo}-${hi}`,
      par: `${Math.min(...pars)}-${Math.max(...pars)}`,
      out: `${outOfBand} (${(100 * outOfBand / puzzles.length).toFixed(1)}%)`,
      rated: dist2(pars.map(x => tierOfPar(x) ?? 'none')),
      lv: dist(maxLv),
      gate: stats.notUnique === undefined ? 'no gate' : `${stats.notUnique} / ${stats.outOfBand}`,
      ms: `${f1(mean(times))} / ${f1(pct(times, 0.95))} / ${f1(Math.max(...times))}`,
      verdict: pass ? 'PASS' : 'FAIL',
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

console.log(`\nN = ${N} puzzles per row, generated through generatePuzzle(). Seed ${SEED}.`)
print('A. Par, size, variety, generation time', [
  ['n', 'n'], ['par', 'par (value:count)'], ['tiles', 'tiles'], ['grid', 'grid rows x cols'],
  ['exact', 'distinct exact'], ['struct', 'distinct structural'], ['rej', 'builder rejections'], ['ms', 'gen ms mean / p95 / max'],
], tableA)
print('B. Non-par difficulty proxies', [
  ['sols', 'strict partitions median (min-max)'], ['distinct', 'distinct solutions median (min-max)'], ['unique', 'one distinct solution'], ['plausible', 'plausible sets'],
  ['dead', 'dead sets'], ['mustBreak', 'board rows that must break'], ['tempting', 'tempting rack tiles dead/total'],
  ['zero', 'forced at move 0'], ['cascade', 'myopic depth'], ['guess', 'guesswork undos'],
  ['ladder', 'ladder steps L0 / L1 / L2 / L3'], ['free', 'free choices'], ['maxLv', 'hardest technique (level:count)'],
  ['oldLv', 'hardest technique, old rater'],
], tableB)
print('D. VERDICT: uniqueness and tier band', [
  ['n', 'n'], ['multi', 'puzzles with >1 distinct solution'], ['cuts', 'puzzles with >1 strict partition'],
  ['band', 'par band'], ['par', 'par min-max'], ['out', 'par outside band'], ['rated', 'rates as (tier:count)'],
  ['lv', 'hardest technique (level:count)'], ['gate', 'gate rejections: not unique / out of band'],
  ['ms', 'gen ms mean / p95 / max'], ['verdict', 'verdict'],
], tableD)
if (mix.length) {
  console.log('\n### C. Shipped archetype mix\n\n| tier | archetypes |\n|---|---|')
  for (const m of mix) console.log(m)
}
console.log(`\nInvariant (a)-(d) failures: ${invariantFailures}`)
console.log(`partitionCount vs solveBagM2 disagreements: ${oracleDisagreements}`)
console.log(`distinctSolutions (gate) vs brute force disagreements: ${uniquenessDisagreements}`)
const bad = verdictFailures + invariantFailures + oracleDisagreements + uniquenessDisagreements
console.log(`\nAUDIT VERDICT: ${bad === 0 ? 'PASS' : 'FAIL'} (${verdictFailures} SHIPPED MIX rows failing; forced rows are informational)`)
process.exit(bad === 0 ? 0 : 1)

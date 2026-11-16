/**
 * Cut-vs-par measurement: `npx tsx src/lib/cutVsPar.ts [N] [seed] [searchIterations]`.
 *
 * Question: can a player finish in FEWER moves than the shipped par by laying a
 * long run as two short ones? Generates the same puzzles as the audit's
 * "SHIPPED MIX / <tier>" rows (same seed, same label, same generatePuzzle path)
 * and, for every puzzle whose bag has more than one strict partition, compares:
 *   shipped par            p.optimalMoves
 *   whole-run par          planColorRunGoal (one whole run per colour, aligned)
 *   best uncut, free       planCutRunGoal(wholeOnly): whole runs, placed freely
 *   best cut               planCutRunGoal: any cut, anchored family
 *   adversary              searchCutRunGoal: annealing over free placements
 * Every layout that is counted is replayed through the reducer semantics
 * (mixedLayoutMoves) to a validateGrid win in exactly its move count.
 * Exits 1 if any counted layout fails its replay, or if a shipped par is beaten.
 */
import type { Difficulty, Tile } from '../types'
import { generatePuzzle } from './generator'
import { planColorRunGoal } from './archetypes'
import { planCutRunGoal, searchCutRunGoal, type CutPlanStats } from './cutRunPlanner'
import { mixedLayoutMoves } from './mixedGoalPlanner'
import { partitionCount } from './difficultyProxy'
import { PAR_BAND, tierOfPar } from './tierBands'

const N = Number(process.argv[2] ?? 1000)
const SEED = Number(process.argv[3] ?? 20261115)
const ITER = Number(process.argv[4] ?? 20000)

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
const dist = (xs: number[]): string => {
  const m = new Map<number, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ') || '-'
}
const pct = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0
}

let replayFailures = 0
let beaten = 0
const rows: string[] = []

for (const diff of ['easy', 'medium', 'hard', 'extreme'] as Difficulty[]) {
  reseed(`SHIPPED MIX / ${diff}`)
  const puzzles = []
  for (let i = 0; i < N; i++) { const p = generatePuzzle(diff); if (p) puzzles.push(p) }

  let cuttable = 0, plannerNull = 0, strayCuttable = 0
  const shipped: number[] = [], whole: number[] = [], uncut: number[] = [], cut: number[] = [], adv: number[] = []
  const dCut: number[] = [], dUncut: number[] = [], dAdv: number[] = [], ms: number[] = [], leaves: number[] = []
  const rated: string[] = []
  const kinds = new Map<string, number>()
  for (const p of puzzles) {
    const bag = [...p.grid.flat().filter((t): t is Tile => !!t), ...p.rack]
    if (p.archetypeId !== 'groups-to-runs') { if (partitionCount(bag, 1000) > 1) strayCuttable++; continue }
    if (partitionCount(bag, 1000) > 1) cuttable++
    kinds.set(p.archetypeId ?? '?', (kinds.get(p.archetypeId ?? '?') ?? 0) + 1)
    const stats: CutPlanStats = { leaves: 0 }
    const t0 = performance.now()
    const best = planCutRunGoal(p.grid, p.rack, false, stats)
    ms.push(performance.now() - t0)
    leaves.push(stats.leaves)
    const free = planCutRunGoal(p.grid, p.rack, true)
    const aligned = planColorRunGoal(p.grid, p.rack)
    if (!best || !aligned) { plannerNull++; continue }
    const found = searchCutRunGoal(p.grid, p.rack, best.pieces, ITER)!
    for (const plan of [best, found, ...(free ? [free] : [])]) {
      const r = mixedLayoutMoves(p.grid, p.rack, plan.goal)
      if (!r || !r.reachedGoal || !r.validGoal || r.moves !== plan.moves || r.witness.length !== plan.moves) replayFailures++
    }
    shipped.push(p.optimalMoves)
    whole.push(aligned.moves)
    cut.push(best.moves)
    adv.push(found.moves)
    if (free) { uncut.push(free.moves); dUncut.push(p.optimalMoves - free.moves) }
    dCut.push(p.optimalMoves - best.moves)
    dAdv.push(best.moves - found.moves)
    const lowest = Math.min(p.optimalMoves, best.moves, found.moves, free ? free.moves : Infinity)
    if (lowest < p.optimalMoves) beaten++
    rated.push(tierOfPar(lowest) ?? 'none')
  }
  const [lo, hi] = PAR_BAND[diff]
  const out = rated.filter(t => t !== diff).length
  rows.push(`| ${diff} | ${puzzles.length} | ${shipped.length} | ${cuttable}${plannerNull ? ` (planner null ${plannerNull})` : ''}${strayCuttable ? ` (+${strayCuttable} in OTHER archetypes)` : ''} | ${[...kinds.entries()].map(([k, v]) => `${k} ${v}`).join(', ') || '-'} | ${dist(shipped)} | ${dist(whole)} | ${dist(uncut)} | ${dist(cut)} | ${dCut.filter(d => d > 0).length} (${dist(dCut.filter(d => d > 0))}) | ${dUncut.filter(d => d > 0).length} | ${dAdv.filter(d => d > 0).length} (${dist(dAdv.filter(d => d > 0))}) | ${lo}-${hi}: ${out} | ${ms.length ? `${(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1)} / ${pct(ms, 0.95).toFixed(1)} / ${Math.max(...ms).toFixed(1)}` : '-'} | ${leaves.length ? Math.max(...leaves) : '-'} |`)
  process.stderr.write(`done ${diff}\n`)
}

console.log(`\nN = ${N} per tier, seed ${SEED}, adversary ${ITER} iterations per puzzle. Distributions are value:count.\n`)
console.log('| tier | n | groups-to-runs puzzles | of those, >1 strict partition | archetypes | shipped par | whole-run aligned par | best uncut, free | best cut (planner) | cut cheaper than shipped par (by how much) | uncut-free cheaper than shipped par | adversary cheaper than planner (by how much) | best-known cost outside band | planner ms mean / p95 / max | max leaves |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for (const r of rows) console.log(r)
console.log(`\nReplay failures (a counted layout that did not reach a validateGrid win in its move count): ${replayFailures}`)
console.log(`Puzzles whose shipped par is beaten by a known layout: ${beaten}`)
console.log(`\nCUT-VS-PAR VERDICT: ${replayFailures === 0 && beaten === 0 ? 'PASS' : 'FAIL'}`)
process.exit(replayFailures === 0 && beaten === 0 ? 0 : 1)

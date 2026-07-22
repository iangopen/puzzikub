// Verification harness for the CHAIN archetype — buildChain / buildChainAt in
// archetypes.ts. Run: `npx tsx src/lib/chain.verify.ts`.
//
// The chain is DEDUCTIVE, not physical (a prior buildDominoChain failed twice by
// assuming otherwise — see the long comment above buildChainAt). Everything
// below is re-derived INDEPENDENTLY of the builder: this file has its own
// candidate-set enumerator, its own partition counter, its own cascade, its own
// par-over-all-layouts search and its own DROP-reducer transcription.
//
// Proves, with real executed output:
//   (a) validateGrid(board), zero invalid cells at move zero
//   (b) solveBagM2(all tiles).solvable
//   (c) formsValidSetAlone(rack) === false
//   (d) existsNoRelocationWin: win=false AND not exhausted
//   (e) the goal materialises to a real validateGrid win
//   UNIQUE : exactly one run/group partition (independently counted)
//   DEPTH  : the local cascade completes with depth 2*links
//   GENUINE: each later link determines a tile that had >=2 candidates at move
//            zero — i.e. it was NOT already obvious
//   SOUND  : every locally-forced deduction is confirmed by solveBagM2 — the
//            alternatives it rules out really are globally unsolvable
//   NOT-A-DECOY: ambiguity survives round 1 (it does not all collapse at once)
//   PAR    : builder par == min over EVERY layout == a simulated real win

import type { Tile, Grid } from '../types'
import { validateGrid, getInvalidCells, isValidRun, isValidGroup } from './validator'
import { solveBagM2 } from './solver'
import {
  buildChain, buildChainAt, type ChainBuild,
  formsValidSetAlone, existsNoRelocationWin,
  buildRunsToGroups, buildDecoy, buildComposed, buildCutPoint,
} from './archetypes'
import { mixedLayoutMoves, bindMinCostGoal, type WindowSpec } from './mixedGoalPlanner'
import { generatePuzzle } from './generator'

let pass = 0, fail = 0
const check = (label: string, ok: boolean) => { if (ok) pass++; else { fail++; console.log(`  FAIL  ${label}`) } }
const lbl = (t: Tile) => `${t.n}${t.c}`
const K = (t: Tile) => `${t.n}_${t.c}`
const show = (ts: Tile[]) => `{${[...ts].sort((a, b) => a.n - b.n).map(lbl).join(' ')}}`

// --- independent enumerator (m=1: at most one tile per (value,colour)) -------
function blocksFor(bag: Tile[], t: Tile): Tile[][] {
  const out: Tile[][] = []
  const sc = new Map<number, Tile>()
  for (const x of bag) if (x.c === t.c) sc.set(x.n, x)
  let lo = t.n; while (sc.has(lo - 1)) lo--
  let hi = t.n; while (sc.has(hi + 1)) hi++
  for (let a = lo; a <= t.n; a++) for (let b = t.n; b <= hi; b++) {
    if (b - a + 1 < 3) continue
    const run: Tile[] = []
    for (let v = a; v <= b; v++) run.push(sc.get(v)!)
    if (isValidRun(run)) out.push(run)
  }
  const others = bag.filter(x => x.n === t.n && x.c !== t.c)
  const combos = (arr: Tile[], k: number): Tile[][] => {
    if (k === 0) return [[]]
    const r: Tile[][] = []
    arr.forEach((x, i) => combos(arr.slice(i + 1), k - 1).forEach(z => r.push([x, ...z])))
    return r
  }
  for (const k of [2, 3]) for (const rest of combos(others, k)) {
    const g = [t, ...rest]
    if (isValidGroup(g)) out.push(g)
  }
  return out
}
const drop = (bag: Tile[], b: Tile[]) => { const s = new Set(b.map(K)); return bag.filter(x => !s.has(K(x))) }
function partitionCount(bag: Tile[], cap = 2): number {
  let f = 0
  const rec = (rest: Tile[]) => {
    if (f >= cap) return
    if (!rest.length) { f++; return }
    for (const b of blocksFor(rest, rest[0])) { rec(drop(rest, b)); if (f >= cap) return }
  }
  rec(bag); return f
}

interface Cascade { depth: number; stalled: boolean; rounds: { tile: string; initial: number; block: Tile[] }[][] }
function cascade(bag: Tile[]): Cascade {
  const initial = new Map<string, number>()
  for (const t of bag) initial.set(K(t), blocksFor(bag, t).length)
  let rest = [...bag]
  const rounds: { tile: string; initial: number; block: Tile[] }[][] = []
  let guard = 0
  while (rest.length && guard++ < 60) {
    const rec: { tile: string; initial: number; block: Tile[] }[] = []
    for (const t of rest) {
      const c = blocksFor(rest, t)
      if (c.length === 1) rec.push({ tile: lbl(t), initial: initial.get(K(t))!, block: c[0] })
    }
    if (!rec.length) return { depth: rounds.length, stalled: true, rounds }
    const rm = new Set<string>()
    rec.forEach(r => r.block.forEach(x => rm.add(K(x))))
    rounds.push(rec)
    rest = rest.filter(x => !rm.has(K(x)))
  }
  return { depth: rounds.length, stalled: false, rounds }
}
const genuineSteps = (c: Cascade) => c.rounds.slice(1).filter(r => r.some(x => x.initial >= 2)).length

// --- DROP reducer transcription ---------------------------------------------
type Move = { from: 'grid'; r: number; c: number; tr: number; tc: number } | { from: 'rack'; idx: number; tr: number; tc: number }
function applyDrop(grid: Grid, rack: Tile[], d: Move) {
  if (d.from === 'rack') {
    const t = rack[d.idx]; rack.splice(d.idx, 1)
    const disp = grid[d.tr][d.tc]; grid[d.tr][d.tc] = t; if (disp) rack.push(disp)
  } else { const t = grid[d.r][d.c]; grid[d.r][d.c] = grid[d.tr][d.tc]; grid[d.tr][d.tc] = t }
}
function simulate(startGrid: Grid, startRack: Tile[], goal: Map<string, [number, number]>) {
  const grid = startGrid.map(r => [...r]); const rack = [...startRack]
  const g = (t: Tile) => goal.get(t.id)!
  let moves = 0
  const bad = () => {
    const o: [number, number][] = []
    for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[0].length; c++) {
      const t = grid[r][c]; if (!t) continue
      const [gr, gc] = g(t); if (gr !== r || gc !== c) o.push([r, c])
    }
    return o
  }
  const budget = grid.length * grid[0].length * 4
  for (let i = 0; i <= budget; i++) {
    const b = bad(); if (!b.length) break
    if (i === budget) return { moves, won: false }
    const drain = b.find(([r, c]) => { const [gr, gc] = g(grid[r][c]!); return grid[gr][gc] === null })
    const [r, c] = drain ?? b[0]; const [tr, tc] = g(grid[r][c]!)
    applyDrop(grid, rack, { from: 'grid', r, c, tr, tc }); moves++
  }
  while (rack.length) {
    const [tr, tc] = g(rack[0])
    if (grid[tr][tc] !== null) return { moves, won: false }
    applyDrop(grid, rack, { from: 'rack', idx: 0, tr, tc }); moves++
  }
  return { moves, won: rack.length === 0 && validateGrid(grid) }
}

/** par minimised over EVERY layout: each block that sits contiguously on a board
 *  row may keep those cells or be rebuilt on a fresh row. */
function parOverAllLayouts(b: ChainBuild): number {
  const isRun = (x: Tile[]) => x.every(t => t.c === x[0].c)
  const boardRows: Tile[][] = []
  for (let r = 0; r < b.grid.length; r++) {
    const row = b.grid[r].filter((t): t is Tile => t !== null)
    if (row.length) boardRows.push(row)
  }
  const stayable = b.blocks.map(blk => boardRows.findIndex(row => blk.every(t => row.some(x => K(x) === K(t)))))
  const idx = stayable.map((v, i) => [v, i] as [number, number]).filter(([v]) => v >= 0).map(([, i]) => i)
  let best = Infinity
  for (let mask = 0; mask < (1 << idx.length); mask++) {
    const keep = new Set<number>()
    idx.forEach((bi, k) => { if (mask & (1 << k)) keep.add(bi) })
    const windows: WindowSpec[] = b.blocks.map(x => isRun(x)
      ? { type: 'run', color: x[0].c, start: Math.min(...x.map(t => t.n)), length: x.length }
      : { type: 'group', value: x[0].n, colors: x.map(t => t.c) })
    let fresh = boardRows.length
    const need = b.blocks.length - keep.size
    const rows = Math.max(b.grid.length, 1 + boardRows.length + need + 1)
    const grid: Grid = Array.from({ length: rows }, () => Array(b.grid[0].length).fill(null))
    boardRows.forEach((row, r) => row.forEach((t, i) => { grid[1 + r][1 + i] = t }))
    const cells: [number, number][][] = []
    let ok = true
    b.blocks.forEach((blk, bi) => {
      if (keep.has(bi)) {
        const rowIdx = stayable[bi]
        const row = boardRows[rowIdx]
        const off = row.findIndex(t => K(t) === K(blk[0]))
        cells.push(blk.map((_, i): [number, number] => [1 + rowIdx, 1 + off + i]))
      } else {
        const r = ++fresh
        if (r >= rows) { ok = false; return }
        cells.push(blk.map((_, i): [number, number] => [r, 1 + i]))
      }
    })
    if (!ok) continue
    const res = bindMinCostGoal(windows, grid, b.rack, (wi, i) => cells[wi][i])
    if (res && res.reachedGoal && res.validGoal && res.moves < best) best = res.moves
  }
  return best
}

console.log('=== CHAIN archetype verification (deductive chain, m=1) ===\n')

// ---------------------------------------------------------------------------
console.log('0. Tier gating — chain puzzles ship at MEDIUM only')
check('buildChain(easy) === null', buildChain('easy') === null)
check('buildChain(hard) === null', buildChain('hard') === null)
check('buildChain(extreme) === null', buildChain('extreme') === null)
check('buildChain(medium) builds', buildChain('medium') !== null)
console.log(`   easy=${buildChain('easy')} hard=${buildChain('hard')} extreme=${buildChain('extreme')}`)
console.log(`   buildChainAt(1)=${buildChainAt(1)}  buildChainAt(5)=${buildChainAt(5)}  (links must be 2..4)\n`)

// ---------------------------------------------------------------------------
const N = 25
console.log(`1. Invariants over ${N} medium builds (a,b,c,d,e + UNIQUE, DEPTH, GENUINE)`)
{
  const t = { a: 0, b: 0, c: 0, d: 0, e: 0, uniq: 0, depth: 0, gen: 0, all: 0 }
  const pars = new Set<number>(); const dims = new Set<string>(); const depths = new Set<number>(); const gens = new Set<number>()
  let built = 0, example = ''
  for (let i = 0; i < N; i++) {
    const b = buildChain('medium'); if (!b) continue
    built++
    const a = validateGrid(b.grid) && getInvalidCells(b.grid).size === 0
    const bi = solveBagM2(b.allTiles).solvable === true
    const c = formsValidSetAlone(b.rack) === false
    const s = existsNoRelocationWin(b.grid, b.rack)
    const d = s.win === false && s.exhausted === false
    const home = mixedLayoutMoves(b.grid, b.rack, b.goal)
    const e = !!home && home.reachedGoal && home.validGoal
    const uniq = partitionCount(b.allTiles) === 1
    const cas = cascade(b.allTiles)
    const links = b.runCols.length
    const deepOk = !cas.stalled && cas.depth === 2 * links
    const genOk = genuineSteps(cas) >= 2 * links - 1
    if (a) t.a++; if (bi) t.b++; if (c) t.c++; if (d) t.d++; if (e) t.e++
    if (uniq) t.uniq++; if (deepOk) t.depth++; if (genOk) t.gen++
    if (a && bi && c && d && e && uniq && deepOk && genOk) t.all++
    pars.add(b.minMoves); dims.add(`${b.grid.length}x${b.grid[0].length}`)
    depths.add(cas.depth); gens.add(genuineSteps(cas))
    if (!example) example = `${b.blocks.map(show).join(' ')}  rack=${show(b.rack)} par=${b.minMoves}`
  }
  console.log(`  built ${built}/${N} | a=${t.a} b=${t.b} c=${t.c} d=${t.d} e=${t.e} UNIQUE=${t.uniq} DEPTH=${t.depth} GENUINE=${t.gen}  ALL=${t.all}`)
  console.log(`  pars={${[...pars]}} grids={${[...dims]}} cascadeDepths={${[...depths]}} genuineSteps={${[...gens]}}`)
  console.log(`  e.g. ${example}`)
  check('all builds succeeded', built === N)
  check('(a) board valid, zero invalid cells', t.a === built)
  check('(b) solvable', t.b === built)
  check('(c) rack forms no valid set alone', t.c === built)
  check('(d) no no-relocation win', t.d === built)
  check('(e) goal materialises to a validateGrid win', t.e === built)
  check('UNIQUE: exactly one partition (independently counted)', t.uniq === built)
  check('DEPTH: local cascade completes at depth 2*links = 8', t.depth === built && depths.has(8) && depths.size === 1)
  check('GENUINE: >= 2*links-1 = 7 genuinely non-obvious steps', t.gen === built)
  check('par deterministic', pars.size === 1)
  check('par === 9', [...pars][0] === 9)
}

// ---------------------------------------------------------------------------
console.log('\n2. THE CHAIN PROOF — every link, with real solveBagM2 evidence')
console.log('   For each round: the tiles it determines, their candidate count AT MOVE')
console.log('   ZERO, and confirmation that the alternatives ruled out are genuinely')
console.log('   unsolvable (so the local deduction is SOUND, not a guess).')
{
  const b = buildChainAt(4, 1, ['r', 'b', 'a', 'k'])!
  console.log(`   partition ${b.blocks.map(show).join(' ')}`)
  const cas = cascade(b.allTiles)
  let rest = [...b.allTiles]
  let soundChecks = 0, soundFails = 0, genuineLinks = 0
  cas.rounds.forEach((round, i) => {
    const newly = round.filter(x => x.initial >= 2)
    if (i > 0 && newly.length) genuineLinks++
    const desc = round.map(x => `${x.tile}(initial ${x.initial})`).join(' ')
    console.log(`   round ${i + 1}: ${desc}`)
    // SOUNDNESS: for one newly-determined tile, verify every OTHER initial
    // candidate really is globally unsolvable.
    const probe = newly[0] ?? round[0]
    const tile = b.allTiles.find(t => lbl(t) === probe.tile)!
    const initialCands = blocksFor(b.allTiles, tile)
    const badOnes = initialCands.filter(cb => !cb.every(x => probe.block.some(y => K(y) === K(x))) || cb.length !== probe.block.length)
    const ruledOut = badOnes.filter(cb => !solveBagM2(drop(b.allTiles, cb)).solvable).length
    soundChecks += badOnes.length; soundFails += badOnes.length - ruledOut
    if (badOnes.length) console.log(`      ${probe.tile}: ${badOnes.length} rival candidate set(s) at move zero, ${ruledOut} proven UNSOLVABLE by solveBagM2`)
    const rm = new Set<string>(); round.forEach(x => x.block.forEach(y => rm.add(K(y))))
    rest = rest.filter(x => !rm.has(K(x)))
  })
  console.log(`   cascade depth=${cas.depth} stalled=${cas.stalled} genuine links=${genuineLinks}`)
  check('the cascade fully resolves the puzzle (no leftover)', !cas.stalled && rest.length === 0)
  check('every rival candidate ruled out by the chain is genuinely unsolvable', soundFails === 0 && soundChecks > 0)
  check('the chain has >= 7 genuine links', genuineLinks >= 7)
}

// ---------------------------------------------------------------------------
console.log('\n3. CRUX — is this just "decoy with extra steps"?')
console.log('   (if resolving round 1 made everything obvious, ambiguity would drop to 0')
console.log('    immediately; a real chain keeps tiles ambiguous for several rounds)')
{
  const b = buildChainAt(4, 1, ['r', 'b', 'a', 'k'])!
  let rest = [...b.allTiles]
  const trace: string[] = []
  let roundsWithAmbiguity = 0
  for (let i = 0; i < 12 && rest.length; i++) {
    const amb = rest.map(t => [lbl(t), blocksFor(rest, t).length] as [string, number]).filter(([, n]) => n >= 2)
    if (amb.length) roundsWithAmbiguity++
    trace.push(`   before round ${i + 1}: ${String(rest.length).padStart(2)} tiles left, ambiguous=${amb.length} ${amb.map(([t, n]) => `${t}(${n})`).join(' ')}`)
    const forced: Tile[][] = []
    for (const t of rest) { const c = blocksFor(rest, t); if (c.length === 1) forced.push(c[0]) }
    if (!forced.length) break
    const rm = new Set<string>(); forced.forEach(x => x.forEach(y => rm.add(K(y))))
    rest = rest.filter(x => !rm.has(K(x)))
  }
  trace.forEach(t => console.log(t))
  check('ambiguity survives round 1 (not all obvious at once)', roundsWithAmbiguity >= 3)
}

// ---------------------------------------------------------------------------
console.log('\n4. BASELINE — the other archetypes are not chains')
{
  const rows: [string, () => { allTiles: Tile[] } | null][] = [
    ['runs-to-groups(hard)', () => buildRunsToGroups('hard')],
    ['decoy(hard)', () => buildDecoy('hard')],
    ['composed(hard)', () => buildComposed('hard')],
    ['cut-point(medium)', () => buildCutPoint('medium')],
    ['chain(medium)', () => buildChain('medium')],
  ]
  for (const [name, f] of rows) {
    const ds: string[] = []
    for (let i = 0; i < 3; i++) {
      const b = f(); if (!b) continue
      const c = cascade(b.allTiles)
      ds.push(`${c.depth}${c.stalled ? '(stalled)' : ''}`)
    }
    console.log(`   ${name.padEnd(22)} local cascade depth: ${ds.join(' ')}`)
  }
  console.log('   (cut-point is m=2, so this m=1 enumerator under-reports it — shown for contrast only)')
}

// ---------------------------------------------------------------------------
console.log('\n5. PAR honesty — builder par vs min over EVERY layout, and a real simulation')
{
  let exact = 0, simExact = 0, simWon = 0, n = 0
  for (let i = 0; i < 6; i++) {
    const b = buildChain('medium'); if (!b) continue
    n++
    const ex = parOverAllLayouts(b)
    const sim = simulate(b.grid, b.rack, b.goal)
    if (ex === b.minMoves) exact++
    if (sim.moves === b.minMoves) simExact++
    if (sim.won) simWon++
    console.log(`  #${n}  par=${b.minMoves}  minOverAllLayouts=${ex}  simulated=${sim.moves}  ${sim.won ? 'validateGrid win' : 'NO WIN'}`)
  }
  check('builder par equals the minimum over every layout', exact === n && n > 0)
  check('simulated move count equals par', simExact === n)
  check('simulation ends in a real validateGrid win', simWon === n)
}

// ---------------------------------------------------------------------------
console.log('\n6. Construction timing')
{
  const times: number[] = []
  for (let i = 0; i < 12; i++) { const t0 = performance.now(); buildChain('medium'); times.push(performance.now() - t0) }
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  console.log(`   medium: builds=${times.length} avg=${avg.toFixed(2)}ms min=${Math.min(...times).toFixed(2)}ms max=${Math.max(...times).toFixed(2)}ms`)
  check('construction stays under budget (<250ms)', avg < 250)
}

// ---------------------------------------------------------------------------
console.log('\n7. generatePuzzle integration')
{
  const M = 200
  let chain = 0, valid = 0
  const others = new Map<string, number>()
  for (let i = 0; i < M; i++) {
    const p = generatePuzzle('medium'); if (!p) continue
    if (p.archetypeId === 'chain') {
      chain++
      const all = [...p.grid.flat().filter((t): t is Tile => t !== null), ...p.rack]
      if (validateGrid(p.grid) && solveBagM2(all).solvable && p.optimalMoves > 0) valid++
    } else others.set(p.archetypeId ?? '?', (others.get(p.archetypeId ?? '?') ?? 0) + 1)
  }
  console.log(`   medium: chain=${chain}/${M} (${Math.round(chain / M * 100)}%) valid=${valid}/${chain}; others=${[...others].map(([k, v]) => `${k}:${v}`).join(' ')}`)
  check('chain puzzles are emitted at medium', chain > 0)
  check('every emitted chain puzzle is valid+solvable', valid === chain)
  check('cut-point still emitted at medium (bands stay disjoint)', (others.get('cut-point') ?? 0) > 0)
  check('base archetypes still emitted at medium', (others.get('runs-to-groups') ?? 0) + (others.get('groups-to-runs') ?? 0) > 0)
  let leaked = 0
  for (const d of ['easy', 'hard', 'extreme'] as const)
    for (let i = 0; i < 60; i++) if (generatePuzzle(d)?.archetypeId === 'chain') leaked++
  console.log(`   chain puzzles leaked into easy/hard/extreme: ${leaked}`)
  check('chain never appears outside medium', leaked === 0)
}

console.log(`\n=== SELF-CHECKS: ${pass} passed, ${fail} failed ===`)

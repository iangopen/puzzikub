// Verification harness for the VARIANTS of the trap layers and the chain
// (decoyVariants / redHerringVariants / composedVariants / buildChainVariant in
// archetypes.ts). Run: `npx tsx src/lib/trapVariants.verify.ts`.
//
// The original puzzle of each layer is still covered by its own harness
// (decoy / redherring / composed / chain .verify.ts). This one covers every
// SHIPPED variant, and re-derives each property independently of the builder:
//   - invariants (a)-(d), with the m=1 `solveBag` as the differential oracle
//   - the trap proof: every tempting commitment leaves an UNSOLVABLE remainder
//   - uniqueness, with its own partition counter (not difficultyProxy's)
//   - genuine home: the builder's witness replayed through a transcription of
//     the real DROP reducer, landing on a validateGrid win in exactly par
//   - pinned par per variant
// and then shows that the proof CAN fail, on four deliberately broken variants.

import type { Tile, Grid, Difficulty } from '../types'
import { validateGrid, getInvalidCells, isValidRun, isValidGroup } from './validator'
import { solveBag } from './solver'
import {
  formsValidSetAlone, existsNoRelocationWin, type ArchetypeResult, type ProofLine,
  decoyVariants, buildDecoyAt, proveDecoyAt, buildDecoyVariant,
  redHerringVariants, buildRedHerringAt, proveRedHerringAt, buildRedHerringVariant,
  composedVariants, buildComposedAt, proveComposedAt, buildComposedVariant,
  buildChainAt, buildChainVariant,
} from './archetypes'
import type { Drop } from './mixedGoalPlanner'
import { techniqueLadder, refutationDepth, myopicCascade } from './difficultyProxy'
import { generatePuzzle, FORCE_TYPES, type ForceType } from './generator'

let pass = 0, fail = 0
const check = (label: string, ok: boolean) => {
  if (ok) pass++
  else { fail++; console.log(`  FAIL  ${label}`) }
}
const SAMPLES = 6
const COLORS: Tile['c'][] = ['r', 'b', 'a', 'k']

// ---- independent partition counter (m=1 bags only; capped) -----------------
function countPartitions(bag: Tile[], cap = 2): number {
  let found = 0
  const rec = (rest: Tile[]): void => {
    if (found >= cap) return
    if (rest.length === 0) { found++; return }
    const sorted = [...rest].sort((a, b) => a.n - b.n || a.c.localeCompare(b.c))
    const t = sorted[0]
    const others = sorted.slice(1)
    const sets: Tile[][] = []
    // t is the smallest tile, so any run containing it starts at it.
    const run: Tile[] = [t]
    for (let v = t.n + 1; ; v++) {
      const next = others.find(x => x.c === t.c && x.n === v)
      if (!next) break
      run.push(next)
      if (run.length >= 3) sets.push([...run])
    }
    const same = others.filter(x => x.n === t.n)
    for (let i = 0; i < same.length; i++)
      for (let j = i + 1; j < same.length; j++) {
        sets.push([t, same[i], same[j]])
        for (let k = j + 1; k < same.length; k++) sets.push([t, same[i], same[j], same[k]])
      }
    for (const set of sets) {
      if (!isValidRun(set) && !isValidGroup(set)) continue
      const ids = new Set(set.map(x => x.id))
      rec(rest.filter(x => !ids.has(x.id)))
      if (found >= cap) return
    }
  }
  rec(bag)
  return found
}

// ---- transcription of usePlayState's DROP reducer --------------------------
// GRID->GRID onto an occupied cell SWAPS; RACK->GRID sends a displaced tile to
// the rack. The witness names rack tiles by id.
function replay(startGrid: Grid, startRack: Tile[], witness: Drop[], goal: Map<string, [number, number]>): { moves: number; won: boolean } {
  let maxR = startGrid.length - 1
  let maxC = startGrid[0].length - 1
  for (const [r, c] of goal.values()) { maxR = Math.max(maxR, r); maxC = Math.max(maxC, c) }
  const grid: Grid = Array.from({ length: maxR + 1 }, (_, r) =>
    Array.from({ length: maxC + 1 }, (_, c) => startGrid[r]?.[c] ?? null))
  const rack = [...startRack]
  for (const d of witness) {
    if (d.from === 'rack') {
      const idx = rack.findIndex(t => t.id === d.key)
      if (idx < 0) return { moves: -1, won: false }
      const [tile] = rack.splice(idx, 1)
      const displaced = grid[d.tr][d.tc]
      grid[d.tr][d.tc] = tile
      if (displaced) rack.push(displaced)
    } else {
      const tile = grid[d.r][d.c]
      grid[d.r][d.c] = grid[d.tr][d.tc]
      grid[d.tr][d.tc] = tile
    }
  }
  return { moves: witness.length, won: rack.length === 0 && validateGrid(grid) }
}

const dead = (all: Tile[], commit: Tile[]): boolean => {
  const ids = new Set(commit.map(t => t.id))
  const rest = all.filter(t => !ids.has(t.id))
  return rest.length > 0 && !solveBag(rest).solvable
}

interface Sample extends ArchetypeResult { goal: Map<string, [number, number]>; witness: Drop[] }
interface Verdict { ok: boolean; pars: Set<number>; levels: Set<number>; depths: Set<string>; tiles: number; grid: string }

/** Independent re-check of one build. `traps` are its tempting commitments. */
function verify(b: Sample, traps: Tile[][], v: Verdict): void {
  const search = existsNoRelocationWin(b.grid, b.rack)
  const inv = validateGrid(b.grid) && getInvalidCells(b.grid).size === 0 &&
    solveBag(b.allTiles).solvable && !formsValidSetAlone(b.rack) && !search.win && !search.exhausted
  const trapsDead = traps.every(t => dead(b.allTiles, t))
  const unique = countPartitions(b.allTiles) === 1
  const run = replay(b.grid, b.rack, b.witness, b.goal)
  const home = run.won && run.moves === b.minMoves
  const aligned = b.grid.every(row => row.every(t => !t) || (row[0] === null && row[1] !== null))
  if (!(inv && trapsDead && unique && home && aligned)) {
    v.ok = false
    console.log(`    sample failed: invariants=${inv} trapsDead=${trapsDead} unique=${unique} home=${home} (replay ${run.moves} vs par ${b.minMoves}) aligned=${aligned}`)
  }
  v.pars.add(b.minMoves)
  v.levels.add(techniqueLadder(b.allTiles).maxLevel)
  v.depths.add(traps.map(t => refutationDepth(b.allTiles, t)).join(','))
  v.tiles = b.allTiles.length
  v.grid = `${b.grid.length}x${b.grid[0].length}`
}

const fresh = (): Verdict => ({ ok: true, pars: new Set(), levels: new Set(), depths: new Set(), tiles: 0, grid: '' })
const showProof = (title: string, proof: ProofLine[]): void => {
  console.log(`  proof steps (${title}):`)
  for (const l of proof) console.log(`    ${l.ok ? 'ok  ' : 'FAIL'} ${l.name}`)
}
const fmt = (xs: Set<number> | Set<string>): string => [...xs].sort().join('/')

// Pinned pars: every value each shipped variant produced over 150 builds on
// this branch. The originals keep their numbers (decoy 22/25, red herring 21/24
// at L=5/6, composed 24/27). A set with two values means par depends on which
// board row carries the trap colour(s): the goal layout is fixed, so a
// different row leaves a different number of tiles already in place.
const PAR: Record<string, number[]> = {
  'decoy 6 hi [1]': [22],
  'decoy 6 hi [0,1]': [23],
  'decoy 6 hi [2]': [22],
  'decoy 6 hi [0,2]': [23],
  'decoy 6 hi [1,2]': [23],
  'decoy 6 lo [1]': [19, 21],
  'decoy 6 lo [0,1]': [20, 22],
  'decoy 6 lo [2]': [19, 21],
  'decoy 6 lo [0,2]': [20, 22],
  'decoy 6 lo [1,2]': [20, 22],
  'herring 5 same []': [21],
  'herring 5 split []': [20, 21],
  'herring 6 same []': [24],
  'herring 6 split []': [23, 24],
  'composed 6 hi classic []': [24],
  'composed 6 hi third []': [24],
  'composed 6 lo classic []': [24],
  'composed 6 lo third []': [24],
  'decoy 7 hi [2]': [25],
  'decoy 7 hi [0,2]': [26],
  'decoy 7 hi [1,2]': [26],
  'decoy 7 hi [0,3]': [26],
  'decoy 7 hi [1,3]': [26],
  'decoy 7 hi [0,1,3]': [27],
  'decoy 7 hi [2,3]': [26],
  'decoy 7 hi [0,2,3]': [27],
  'decoy 7 lo [2]': [22, 24],
  'decoy 7 lo [0,2]': [23, 25],
  'decoy 7 lo [1,2]': [23, 25],
  'decoy 7 lo [0,3]': [23, 25],
  'decoy 7 lo [1,3]': [23, 25],
  'decoy 7 lo [0,1,3]': [24, 26],
  'decoy 7 lo [2,3]': [23, 25],
  'decoy 7 lo [0,2,3]': [24, 26],
  'herring 7 same [3]': [28],
  'herring 7 split [3]': [27, 28],
  'herring 8 same [3]': [31],
  'herring 8 split [3]': [30, 31],
  'herring 8 same [4]': [31],
  'herring 8 split [4]': [30, 31],
  'herring 8 same [3,4]': [32],
  'herring 8 split [3,4]': [31, 32],
  'composed 7 hi classic []': [27],
  'composed 7 hi third []': [27],
  'composed 7 lo classic []': [27],
  'composed 7 lo third []': [27],
  'composed 8 hi classic [3]': [31],
  'composed 8 hi third [3]': [31],
  'composed 8 lo classic [3]': [31],
  'composed 8 lo third [3]': [31],
}

const DIFFS: Difficulty[] = ['hard', 'extreme']
const pin = (id: string, v: Verdict): boolean =>
  PAR[id] !== undefined && [...v.pars].every(p => PAR[id].includes(p))

// ===========================================================================
console.log('=== 1. DECOY variants ===')
for (const diff of DIFFS) {
  const variants = decoyVariants(diff)
  console.log(`\n${diff}: ${variants.length} variants`)
  showProof(`L=${variants[1].L} fillers [${variants[1].variant.fillers}]`, proveDecoyAt(variants[1].L, variants[1].variant))
  for (const { L, variant } of variants) {
    const v = fresh()
    let built = 0
    for (let i = 0; i < SAMPLES; i++) {
      const b = buildDecoyAt(L, variant)
      if (!b) continue
      built++
      verify(b, [b.runExtension], v)
    }
    const id = `decoy ${L} ${variant.mirror ? 'lo' : 'hi'} [${variant.fillers}]`
    const proofOk = proveDecoyAt(L, variant).every(l => l.ok)
    console.log(`  ${id.padEnd(22)} built ${built}/${SAMPLES}  proof ${proofOk ? 'ok' : 'FAILED'}  tiles ${v.tiles}  grid ${v.grid}  par ${fmt(v.pars)}  ` +
      `technique L${fmt(v.levels)}  trap depth ${fmt(v.depths)}  replayed ${v.ok ? built : '<' + built}/${built} to a win at par`)
    check(`${id}: ${SAMPLES} builds, proof, invariants, trap, unique, replay, par pinned`, built === SAMPLES && proofOk && v.ok && pin(id, v))
  }
}

// ===========================================================================
console.log('\n=== 2. RED HERRING variants ===')
for (const diff of DIFFS) {
  const variants = redHerringVariants(diff)
  console.log(`\n${diff}: ${variants.length} variants`)
  const shown = variants[variants.length - 1]
  showProof(`L=${shown.L} ${shown.variant.split ? 'split' : 'same'} fillers [${shown.variant.fillers}]`, proveRedHerringAt(shown.L, shown.variant))
  for (const { L, variant } of variants) {
    const v = fresh()
    let built = 0
    for (let i = 0; i < SAMPLES; i++) {
      const b = buildRedHerringAt(L, variant)
      if (!b) continue
      built++
      verify(b, [b.trapLow, b.trapHigh, b.trapBoth], v)
    }
    const id = `herring ${L} ${variant.split ? 'split' : 'same'} [${variant.fillers}]`
    const proofOk = proveRedHerringAt(L, variant).every(l => l.ok)
    console.log(`  ${id.padEnd(24)} built ${built}/${SAMPLES}  proof ${proofOk ? 'ok' : 'FAILED'}  tiles ${v.tiles}  grid ${v.grid}  par ${fmt(v.pars)}  ` +
      `technique L${fmt(v.levels)}  trap depth low,high,both ${fmt(v.depths)}  replayed ${v.ok ? built : '<' + built}/${built}`)
    check(`${id}: ${SAMPLES} builds, proof, invariants, traps, unique, replay`, built === SAMPLES && proofOk && v.ok)
    check(`${id}: par within its pinned range`, pin(id, v))
    if (diff === 'extreme') check(`${id}: needs technique level 2`, fmt(v.levels) === '2')
  }
}

// ===========================================================================
console.log('\n=== 3. COMPOSED variants ===')
for (const diff of DIFFS) {
  const variants = composedVariants(diff)
  console.log(`\n${diff}: ${variants.length} variants`)
  const shown = variants[variants.length - 1]
  showProof(`L=${shown.L} mirror ${shown.variant.mirror} lowOnClean ${shown.variant.lowOnClean} fillers [${shown.variant.fillers}]`,
    proveComposedAt(shown.L, shown.variant))
  for (const { L, variant } of variants) {
    const v = fresh()
    let built = 0
    for (let i = 0; i < SAMPLES; i++) {
      const b = buildComposedAt(L, variant)
      if (!b) continue
      built++
      verify(b, [b.trapDecoy, b.trapHigh, b.trapLow, b.trapBoth, [...b.trapDecoy, ...b.trapBoth]], v)
    }
    const id = `composed ${L} ${variant.mirror ? 'lo' : 'hi'} ${variant.lowOnClean ? 'third' : 'classic'} [${variant.fillers}]`
    const proofOk = proveComposedAt(L, variant).every(l => l.ok)
    console.log(`  ${id.padEnd(30)} built ${built}/${SAMPLES}  proof ${proofOk ? 'ok' : 'FAILED'}  tiles ${v.tiles}  grid ${v.grid}  par ${fmt(v.pars)}  ` +
      `technique L${fmt(v.levels)}  trap depth ${fmt(v.depths)}  replayed ${v.ok ? built : '<' + built}/${built}`)
    check(`${id}: ${SAMPLES} builds, proof, invariants, traps, unique, replay`, built === SAMPLES && proofOk && v.ok)
    check(`${id}: par within its pinned range`, pin(id, v))
  }
}

// ===========================================================================
console.log('\n=== 4. CHAIN variants (medium) ===')
for (const mirror of [false, true]) {
  const v = fresh()
  let built = 0, depth8 = 0
  for (let i = 0; i < 10; i++) {
    const b = buildChainVariant('medium', x => x.mirror === mirror)
    if (!b) continue
    built++
    verify(b, [], v)
    const mc = myopicCascade(b.allTiles)
    if (!mc.stalled && mc.depth === 8) depth8++
  }
  console.log(`  chain ${mirror ? 'mirrored' : 'ascending'}, rows shuffled: built ${built}/10  tiles ${v.tiles}  grid ${v.grid}  par ${fmt(v.pars)}  ` +
    `myopic cascade depth 8 on ${depth8}/10  technique L${fmt(v.levels)}  replayed ${v.ok ? built : '<' + built}/${built}`)
  check(`chain ${mirror ? 'mirrored' : 'ascending'}: 10 builds, invariants, unique, replay`, built === 10 && v.ok)
  check(`chain ${mirror ? 'mirrored' : 'ascending'}: par is exactly 9`, fmt(v.pars) === '9')
  check(`chain ${mirror ? 'mirrored' : 'ascending'}: cascade depth 8, never stalls`, depth8 === 10)
}
{
  const bad = buildChainAt(4, undefined, undefined, { mirror: false, rowOrder: [0, 1, 1, 3, 4] })
  console.log(`  a rowOrder that is not a permutation: ${bad === null ? 'rejected' : 'BUILT'}`)
  check('chain: non-permutation rowOrder is rejected', bad === null)
}

// ===========================================================================
console.log('\n=== 5. THE PROOF CAN FAIL: four deliberately broken variants ===')
const broken: [string, ProofLine[], string][] = [
  ['decoy L=6 fillers [0]  (leftover 1,2,3 is a run: the trap leaks)', proveDecoyAt(6, { mirror: false, fillers: [0] }), 'TRAP'],
  ['decoy L=7 fillers [1]  (trap is dead, but 10 solutions)', proveDecoyAt(7, { mirror: false, fillers: [1] }), 'UNIQUE'],
  ['red herring L=7, no filler  (extend-both leaves middle runs)', proveRedHerringAt(7, { split: false, fillers: [] }), 'TRAP every combination'],
  ['composed L=7 fillers [3]  (2 solutions)', proveComposedAt(7, { mirror: false, lowOnClean: false, fillers: [3] }), 'UNIQUE'],
]
for (const [label, proof, expect] of broken) {
  const failed = proof.find(l => !l.ok)
  console.log(`  ${label}`)
  for (const l of proof) console.log(`      ${l.ok ? 'ok  ' : 'FAIL'} ${l.name}`)
  check(`broken variant fails at ${expect}: ${label}`, !!failed && failed.name.startsWith(expect))
}
check('broken decoy returns null from the builder', buildDecoyAt(6, { mirror: false, fillers: [0] }) === null)
check('broken red herring returns null from the builder', buildRedHerringAt(7, { split: false, fillers: [] }) === null)

// ===========================================================================
console.log('\n=== 6. shape counts, rejection rate and timing (400 shipped draws per row) ===')
function structSig(b: ArchetypeResult): string {
  const all = [...b.grid.flat().filter((t): t is Tile => !!t), ...b.rack]
  const vmin = Math.min(...all.map(t => t.n))
  const perms = (xs: Tile['c'][]): Tile['c'][][] =>
    xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p]))
  let best = ''
  for (const perm of perms(COLORS)) {
    const m = (t: Tile) => `${t.n - vmin}${perm[COLORS.indexOf(t.c)]}`
    const s = `${b.grid.map(r => r.map(t => (t ? m(t) : '.')).join(' ')).join('/')}|${b.rack.map(m).sort().join(' ')}`
    if (best === '' || s < best) best = s
  }
  return best
}
const rows: [string, () => ArchetypeResult | null, number][] = [
  ['decoy / hard', () => buildDecoyVariant('hard'), 25],
  ['decoy / extreme', () => buildDecoyVariant('extreme'), 25],
  ['red-herring / hard', () => buildRedHerringVariant('hard'), 18],
  ['red-herring / extreme', () => buildRedHerringVariant('extreme'), 25],
  ['composed / hard', () => buildComposedVariant('hard'), 18],
  ['composed / extreme', () => buildComposedVariant('extreme'), 25],
  ['chain / medium', () => buildChainVariant('medium'), 15],
]
for (const [label, build, target] of rows) {
  const sigs = new Set<string>()
  const times: number[] = []
  let nulls = 0, wide = 0
  for (let i = 0; i < 400; i++) {
    const t0 = performance.now()
    const b = build()
    times.push(performance.now() - t0)
    if (!b) { nulls++; continue }
    sigs.add(structSig(b))
    wide = Math.max(wide, b.grid[0].length)
  }
  times.sort((a, b) => a - b)
  console.log(`  ${label.padEnd(22)} distinct shapes ${String(sigs.size).padStart(3)}  (target ${target})   widest board ${wide} cols   p95 ${times[380].toFixed(1)} ms`)
  console.log(`  ${''.padEnd(22)} builder rejection rate: ${nulls}/400 calls (${(100 * nulls / 400).toFixed(0)}%)`)
  check(`${label}: at least ${target} distinct shapes`, sigs.size >= target)
  check(`${label}: no rejected draws, p95 under 250 ms, at most 12 columns`, nulls === 0 && times[380] < 250 && wide <= 12)
}

// ===========================================================================
console.log('\n=== 7. force types resolve to the right layer ===')
const EXPECT: Partial<Record<ForceType, [string, Difficulty[]]>> = {
  'decoy-classic': ['runs-to-groups-decoy', DIFFS], 'decoy-mirror': ['runs-to-groups-decoy', DIFFS],
  'red-herring-classic': ['runs-to-groups-redherring', DIFFS], 'red-herring-split': ['runs-to-groups-redherring', DIFFS],
  'composed-classic': ['runs-to-groups-composed', DIFFS], 'composed-mirror': ['runs-to-groups-composed', DIFFS],
  'composed-third': ['runs-to-groups-composed', DIFFS],
  'chain-classic': ['chain', ['medium']], 'chain-mirror': ['chain', ['medium']],
}
for (const force of FORCE_TYPES) {
  const e = EXPECT[force]
  if (!e) continue
  const got = e[1].map(d => generatePuzzle(d, force)?.archetypeId ?? 'null')
  const offTier = generatePuzzle('easy', force)
  console.log(`  ?forceArchetype=${force.padEnd(20)} ${e[1].join('/')} -> ${got.join(', ')}   easy -> ${offTier ? 'BUILT' : 'null'}`)
  check(`${force}: builds its layer at its tiers and nothing at easy`, got.every(g => g === e[0]) && offTier === null)
}

// ===========================================================================
console.log('\n=== 8. sample boards ===')
const show = (title: string, b: ArchetypeResult | null): void => {
  if (!b) { console.log(`${title}: null`); return }
  console.log(`${title}   par ${b.minMoves}   grid ${b.grid.length}x${b.grid[0].length}`)
  for (const row of b.grid) if (row.some(Boolean)) console.log('   ' + row.map(t => (t ? `${t.n}${t.c}`.padStart(3) : '  .')).join(' '))
  console.log('   rack: ' + [...b.rack].sort((x, y) => x.n - y.n).map(t => `${t.n}${t.c}`).join(' '))
}
const five = (title: string, build: () => ArchetypeResult | null): void => {
  console.log(`\n--- ${title} ---`)
  for (let i = 1; i <= 5; i++) show(`#${i}`, build())
}
five('decoy, mirrored (decoy below the block), hard', () => buildDecoyVariant('hard', v => v.mirror))
five('decoy, alternative filler sets, extreme', () => buildDecoyVariant('extreme', v => !v.mirror && v.fillers.length > 1))
five('red herring, split across two colours, hard', () => buildRedHerringVariant('hard', v => v.split))
five('red herring with middle filler (L=7/8), extreme', () => buildRedHerringVariant('extreme'))
five('composed, mirrored, hard', () => buildComposedVariant('hard', v => v.mirror && !v.lowOnClean))
five('composed, opposite-end extender on the third colour, extreme', () => buildComposedVariant('extreme', v => v.lowOnClean))
five('chain, mirrored with shuffled rows, medium', () => buildChainVariant('medium', v => v.mirror))

console.log(`\n=== SELF-CHECKS: ${pass} passed, ${fail} failed ===`)
if (fail > 0) process.exit(1)

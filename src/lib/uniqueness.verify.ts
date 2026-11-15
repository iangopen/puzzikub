// Verification harness for the uniqueness proof and the tier bands.
// Run: `npx tsx src/lib/uniqueness.verify.ts`.
//
// What it shows, with real executed output:
//   1. a KNOWN two-solution puzzle (the medium groups-to-runs design that
//      shipped until this session) is counted as 2 and REFUSED by the gate;
//   2. a bag whose only freedom is where a long run is cut is counted as 1;
//   3. hand-checked edge cases;
//   4. the search agrees with brute force over every partition on thousands of
//      random bags, and with solveBagM2 on solvability;
//   5. every puzzle generatePuzzle ships is unique and inside its tier's band.
import { type Tile, type Grid, type Difficulty, makeTile } from '../types'
import { distinctSolutions, distinctSolutionsBrute, partitionCount } from './difficultyProxy'
import { solveBagM2 } from './solver'
import { validateGrid } from './validator'
import { type ArchetypeResult } from './archetypes'
import { generatePuzzle, generateWith, generationStats } from './generator'
import { PAR_BAND, TIERS, tierOfPar, hasUniqueSolution, shipVerdict } from './tierBands'

// Seeded, so every run checks the same bags and the same puzzles.
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
const block = (lo: number, hi: number, cols: Tile['c'][] = COLORS, copy = 0): Tile[] => {
  const out: Tile[] = []
  for (let n = lo; n <= hi; n++) for (const c of cols) out.push(makeTile(n, c, copy))
  return out
}
const show = (bag: Tile[]): string => bag.map(t => `${t.n}${t.c}`).join(' ')

// ===========================================================================
console.log('=== 1. a KNOWN two-solution puzzle is counted as 2 and refused ===')
// Values 2-5 in all four colours as four groups, rack 1r 1b 6a. This is exactly
// what buildGroupsToRuns('medium') produced before this session (L=4, rack 3).
//   solution A: four runs   1r-5r, 1b-5b, 2a-6a, 2k-5k
//   solution B: 1r-4r, 1b-4b, 2a-6a, 2k-4k, and a GROUP 5r 5b 5k
const twoBoard = block(2, 5)
const twoRack = [makeTile(1, 'r'), makeTile(1, 'b'), makeTile(6, 'a')]
const twoBag = [...twoBoard, ...twoRack]
{
  const fast = distinctSolutions(twoBag, 2)
  const full = distinctSolutions(twoBag, 1000)
  const brute = distinctSolutionsBrute(twoBag)
  console.log(`  bag: ${show(twoBag)}`)
  console.log(`  distinctSolutions(cap 2) = ${fast.count} (${fast.nodes} nodes)   uncapped = ${full.count}   brute force = ${brute.count} over ${brute.partitions} partitions`)
  brute.groupSets.forEach((g, i) => console.log(`    solution ${i + 1}: groups = ${g.length ? g.join(' | ') : '(none: every tile is in a run)'}`))
  check('solveBagM2 says it is solvable (so it is a real puzzle, not a broken one)', solveBagM2(twoBag).solvable)
  check('the exhaustive search finds exactly 2 distinct solutions', full.count === 2)
  check('with cap 2 it stops at the second', fast.count === 2 && fast.nodes <= full.nodes)
  check('brute force over every partition agrees: 2', brute.count === 2)
  check('hasUniqueSolution is false', !hasUniqueSolution(twoBag))
  check('shipVerdict is "not-unique" (par 14 is inside the medium band, so only uniqueness refuses it)', shipVerdict('medium', twoBag, 14) === 'not-unique')

  // The generator's own retry loop, fed a builder that only ever returns this
  // puzzle: it must give up, and say why.
  const grid: Grid = Array.from({ length: 6 }, () => Array<Tile | null>(9).fill(null))
  for (let i = 0; i < 4; i++) COLORS.forEach((c, k) => { grid[1 + i][1 + k] = makeTile(2 + i, c) })
  const fixed: ArchetypeResult = { grid, rack: twoRack, allTiles: twoBag, minMoves: 14 }
  generationStats.attempts = generationStats.rejected = generationStats.notUnique = generationStats.outOfBand = 0
  const shipped = generateWith('medium', 'groups-to-runs', () => fixed)
  console.log(`  generateWith(medium, builder that returns only this puzzle) -> ${shipped === null ? 'null' : 'A PUZZLE'}; attempts ${generationStats.attempts}, refused as not unique ${generationStats.notUnique}`)
  check('the board is a legal starting board (validateGrid)', validateGrid(grid))
  check('the generator refuses it on every attempt and returns null', shipped === null && generationStats.attempts === 40 && generationStats.notUnique === 40)

  // Control: the same loop DOES ship a unique puzzle, so the refusal above is
  // the gate working, not the loop being broken.
  const okRack = [makeTile(1, 'r'), makeTile(1, 'b'), makeTile(6, 'a'), makeTile(6, 'k')]
  const okBag = [...twoBoard, ...okRack]
  const ok = generateWith('medium', 'groups-to-runs', () => ({ grid, rack: okRack, allTiles: okBag, minMoves: 14 }))
  console.log(`  control (add 6k to the rack): distinct = ${distinctSolutions(okBag, 1000).count} -> ${ok ? 'shipped' : 'null'}`)
  check('control: one more boundary tile makes it unique and it ships', distinctSolutions(okBag, 1000).count === 1 && ok !== null)
  check('control: the same unique puzzle is refused at a tier whose band excludes par 14', generateWith('hard', 'groups-to-runs', () => ({ grid, rack: okRack, allTiles: okBag, minMoves: 14 })) === null)
}

// ===========================================================================
console.log('\n=== 2. cutting a long run is NOT a second solution ===')
{
  // The hard groups-to-runs shape: values 3-7 in four colours, rack 2r 2b 8a 8k.
  // Every colour is one run of six, which can also be laid as 3+3.
  const bag = [...block(3, 7), makeTile(2, 'r'), makeTile(2, 'b'), makeTile(8, 'a'), makeTile(8, 'k')]
  const brute = distinctSolutionsBrute(bag)
  console.log(`  hard shape:    strict partitions ${partitionCount(bag, 1000)} (= 2^4)   distinct solutions ${distinctSolutions(bag, 1000).count}   brute ${brute.count} over ${brute.partitions}`)
  check('hard shape: 16 strict partitions, 1 distinct solution', partitionCount(bag, 1000) === 16 && distinctSolutions(bag, 1000).count === 1 && brute.count === 1)
  const bag2 = [...block(3, 8), makeTile(2, 'r'), makeTile(2, 'b'), makeTile(9, 'a'), makeTile(9, 'k')]
  const brute2 = distinctSolutionsBrute(bag2)
  console.log(`  extreme shape: strict partitions ${partitionCount(bag2, 1000)} (= 3^4)   distinct solutions ${distinctSolutions(bag2, 1000).count}   brute ${brute2.count} over ${brute2.partitions}`)
  check('extreme shape: 81 strict partitions, 1 distinct solution', partitionCount(bag2, 1000) === 81 && distinctSolutions(bag2, 1000).count === 1 && brute2.count === 1)
  check('both are accepted by hasUniqueSolution', hasUniqueSolution(bag) && hasUniqueSolution(bag2))
}

// ===========================================================================
console.log('\n=== 3. hand-checked cases ===')
{
  const cases: [string, Tile[], number][] = [
    ['empty bag', [], 0],
    ['two tiles', [makeTile(1, 'r'), makeTile(2, 'r')], 0],
    ['one run of three', [makeTile(1, 'r'), makeTile(2, 'r'), makeTile(3, 'r')], 1],
    ['one group of three', [makeTile(5, 'r'), makeTile(5, 'b'), makeTile(5, 'a')], 1],
    ['run with a hole', [makeTile(1, 'r'), makeTile(2, 'r'), makeTile(4, 'r')], 0],
    ['3 colours x 3 values (3 runs, or 3 groups)', block(4, 6, ['r', 'b', 'a']), 2],
    // 4 colours x 3 values: all runs, all groups, or any one colour as a run
    // with the other three in 3-colour groups = 1 + 1 + 4.
    ['4 colours x 3 values', block(4, 6), 6],
    ['the same group twice (two copies of each tile)', [...block(5, 5, ['r', 'b', 'a']), ...block(5, 5, ['r', 'b', 'a'], 1)], 1],
    ['a run twice (two copies of each tile)', [...block(1, 3, ['r']), ...block(1, 3, ['r'], 1)], 1],
    ['three copies of one tile', [makeTile(1, 'r', 0), makeTile(1, 'r', 1), makeTile(1, 'r', 2), makeTile(2, 'r'), makeTile(3, 'r')], 0],
    ['run 1-13 of one colour (many cuts, one solution)', block(1, 13, ['k']), 1],
  ]
  for (const [name, bag, want] of cases) {
    const got = distinctSolutions(bag, 1000).count
    const brute = bag.length && bag.length < 30 && want !== 0 ? distinctSolutionsBrute(bag).count : want
    console.log(`  ${name.padEnd(48)} distinct ${got}  (expected ${want}${want !== 0 ? `, brute ${brute}` : ''})`)
    check(name, got === want && brute === want)
  }
}

// ===========================================================================
console.log('\n=== 4. differential: search == brute force on random bags ===')
{
  // Random bags drawn from a narrow value window so that many are solvable and
  // many have several solutions. Up to two copies of a tile.
  let n = 0, solvable = 0, multi = 0, withDup = 0, mismatch = 0, oracleMismatch = 0, capMismatch = 0
  const hist = new Map<number, number>()
  for (let trial = 0; trial < 4000; trial++) {
    const lo = 1 + Math.floor(Math.random() * 9)
    const span = 3 + Math.floor(Math.random() * 3)
    const cols = COLORS.slice(0, 2 + Math.floor(Math.random() * 3))
    const keep = 0.55 + Math.random() * 0.45
    const dupP = Math.random() < 0.4 ? 0.25 : 0
    const bag: Tile[] = []
    for (let v = lo; v < lo + span && v <= 13; v++)
      for (const c of cols) {
        if (Math.random() < keep) bag.push(makeTile(v, c, 0))
        if (Math.random() < dupP) bag.push(makeTile(v, c, 1))
      }
    if (bag.length < 3 || bag.length > 26) continue
    n++
    if (new Set(bag.map(t => `${t.n}${t.c}`)).size < bag.length) withDup++
    const fast = distinctSolutions(bag, 1_000_000).count
    const brute = distinctSolutionsBrute(bag)
    if (brute.partitions >= 200_000) continue
    if (fast !== brute.count) { mismatch++; if (mismatch <= 3) console.log(`    MISMATCH fast ${fast} brute ${brute.count}: ${show(bag)}`) }
    if ((fast > 0) !== solveBagM2(bag).solvable) oracleMismatch++
    if (distinctSolutions(bag, 2).count !== Math.min(2, fast)) capMismatch++
    if (fast > 0) solvable++
    if (fast > 1) multi++
    const bucket = fast > 5 ? 6 : fast
    hist.set(bucket, (hist.get(bucket) ?? 0) + 1)
  }
  console.log(`  ${n} random bags: ${solvable} solvable, ${multi} with more than one distinct solution, ${withDup} containing duplicate tiles`)
  console.log(`  distinct-solution histogram: ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k === 6 ? '6+' : k}:${v}`).join('  ')}`)
  console.log(`  mismatches vs brute force: ${mismatch}   vs solveBagM2 solvability: ${oracleMismatch}   cap-2 early exit: ${capMismatch}`)
  check('the sample is meaningful (>=300 solvable, >=100 multi-solution, >=300 with duplicates)', solvable >= 300 && multi >= 100 && withDup >= 300)
  check('search count == brute-force count on every bag', mismatch === 0)
  check('count > 0 exactly when solveBagM2 says solvable', oracleMismatch === 0)
  check('cap 2 returns min(2, true count) on every bag', capMismatch === 0)
}

// ===========================================================================
console.log('\n=== 5. tier bands are disjoint and contiguous ===')
{
  let ok = true
  for (let i = 1; i < TIERS.length; i++) if (PAR_BAND[TIERS[i]][0] !== PAR_BAND[TIERS[i - 1]][1] + 1) ok = false
  console.log(`  ${TIERS.map(d => `${d} ${PAR_BAND[d][0]}-${PAR_BAND[d][1]}`).join('   ')}`)
  check('each band starts one above the previous band', ok)
  check('every par from 9 to 32 rates as exactly one tier', Array.from({ length: 24 }, (_, i) => i + 9).every(p => tierOfPar(p) !== null))
  check('par outside 9-32 rates as no tier', tierOfPar(8) === null && tierOfPar(33) === null)
}

// ===========================================================================
console.log('\n=== 6. every shipped puzzle is unique and inside its band ===')
{
  const N = 250
  for (const diff of TIERS as Difficulty[]) {
    generationStats.attempts = generationStats.rejected = generationStats.notUnique = generationStats.outOfBand = 0
    let made = 0, unique = 0, inBand = 0, nulls = 0, gateMs = 0, gateMax = 0, nodesMax = 0
    const kinds = new Map<string, number>()
    const pars: number[] = []
    for (let i = 0; i < N; i++) {
      const p = generatePuzzle(diff)
      if (!p) { nulls++; continue }
      made++
      const bag = [...p.grid.flat().filter((t): t is Tile => t !== null), ...p.rack]
      // Brute force here, not the gate's own search.
      if (distinctSolutionsBrute(bag).count === 1) unique++
      if (tierOfPar(p.optimalMoves) === diff) inBand++
      pars.push(p.optimalMoves)
      kinds.set(p.archetypeId ?? '?', (kinds.get(p.archetypeId ?? '?') ?? 0) + 1)
      const t0 = performance.now()
      const r = distinctSolutions(bag, 2)
      const dt = performance.now() - t0
      gateMs += dt
      gateMax = Math.max(gateMax, dt)
      nodesMax = Math.max(nodesMax, r.nodes)
    }
    console.log(`  ${diff.padEnd(8)} made ${made}/${N}  unique (brute) ${unique}  par ${Math.min(...pars)}-${Math.max(...pars)} in band ${PAR_BAND[diff][0]}-${PAR_BAND[diff][1]}: ${inBand}`)
    console.log(`  ${''.padEnd(8)} uniqueness proof: mean ${(gateMs / made).toFixed(3)} ms, max ${gateMax.toFixed(2)} ms, max ${nodesMax} nodes`)
    console.log(`  ${''.padEnd(8)} gate refusals in ${generationStats.attempts} builder calls: not unique ${generationStats.notUnique}, out of band ${generationStats.outOfBand}, builder null ${generationStats.rejected - generationStats.notUnique - generationStats.outOfBand}`)
    console.log(`  ${''.padEnd(8)} mix: ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`)
    check(`${diff}: ${N} puzzles generated, none null`, made === N && nulls === 0)
    check(`${diff}: every puzzle has exactly one distinct solution`, unique === made)
    check(`${diff}: every par is inside ${PAR_BAND[diff][0]}-${PAR_BAND[diff][1]}`, inBand === made)
    check(`${diff}: at least two archetypes still ship`, kinds.size >= 2)
    check(`${diff}: the uniqueness proof costs under 5 ms per puzzle`, gateMax < 5)
  }
}

console.log(`\n=== SELF-CHECKS: ${pass} passed, ${fail} failed ===`)

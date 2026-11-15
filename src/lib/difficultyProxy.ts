/**
 * Solving-difficulty proxies that are NOT par. Pure module, no React.
 *
 * Par counts moves. These count what a player has to THINK about, on the bag
 * (board + rack tiles, positions ignored) and on the starting board. Every
 * function is duplicate-safe (m<=2): bags are held as per-label counts, and
 * sets/partitions are compared by LABEL, so the two copies of a tile are
 * interchangeable — which is how a player sees them.
 *
 * What each proxy captures and misses is documented in GENERATOR_AUDIT.md;
 * none of them is a measurement of human difficulty.
 */
import { type Tile, type Grid, makeTile } from '../types'
import { solveBagM2 } from './solver'
import { isValidRun, isValidGroup } from './validator'

const COLORS: Tile['c'][] = ['r', 'b', 'a', 'k']
const NV = 14 // values 1..13, index 0 unused
type Counts = Int8Array // index = n * 4 + colourIndex
/** A set as sorted label indices. */
type LSet = number[]

const idxOf = (t: Tile): number => t.n * 4 + COLORS.indexOf(t.c)

export function countsOf(bag: Tile[]): Counts {
  const cnt = new Int8Array(NV * 4)
  for (const t of bag) cnt[idxOf(t)]++
  return cnt
}

function tilesOf(cnt: Counts): Tile[] {
  const out: Tile[] = []
  for (let i = 4; i < cnt.length; i++)
    for (let k = 0; k < cnt[i]; k++) out.push(makeTile(i >> 2, COLORS[i & 3], k))
  return out
}

const total = (cnt: Counts): number => cnt.reduce((a, b) => a + b, 0)

function solvable(cnt: Counts): boolean {
  const tiles = tilesOf(cnt)
  return tiles.length > 0 && solveBagM2(tiles).solvable
}

/** Every label-distinct valid set containing label `idx`, formable from `cnt`. */
function setsContaining(cnt: Counts, idx: number): LSet[] {
  const out: LSet[] = []
  const n = idx >> 2
  const c = idx & 3
  let lo = n
  while (lo > 1 && cnt[(lo - 1) * 4 + c] > 0) lo--
  let hi = n
  while (hi < 13 && cnt[(hi + 1) * 4 + c] > 0) hi++
  for (let a = lo; a <= n; a++)
    for (let b = Math.max(n, a + 2); b <= hi; b++) {
      const run: number[] = []
      for (let v = a; v <= b; v++) run.push(v * 4 + c)
      out.push(run)
    }
  const others: number[] = []
  for (let k = 0; k < 4; k++) if (k !== c && cnt[n * 4 + k] > 0) others.push(n * 4 + k)
  for (let i = 0; i < others.length; i++)
    for (let j = i + 1; j < others.length; j++) out.push([idx, others[i], others[j]].sort((x, y) => x - y))
  if (others.length === 3) out.push([idx, ...others].sort((x, y) => x - y))
  return out
}

/** Every label-distinct valid set formable from the bag. */
function allSets(cnt: Counts): LSet[] {
  const seen = new Map<string, LSet>()
  for (let i = 4; i < cnt.length; i++) {
    if (cnt[i] === 0) continue
    for (const s of setsContaining(cnt, i)) seen.set(s.join(','), s)
  }
  return [...seen.values()]
}

const apply = (cnt: Counts, s: LSet, d: number): void => { for (const i of s) cnt[i] += d }
const formable = (cnt: Counts, s: LSet): boolean => s.every(i => cnt[i] > 0)

/**
/** A fixed total order on sets (by content), used to count {A,B} once. */
function setOrder(a: LSet, b: LSet): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

/**
 * PROXY 1 — STRICT PARTITION COUNT. Label-distinct partitions of the bag into
 * valid sets, capped. The smallest remaining label must be covered next; when a
 * label has two copies, the second copy's set must not come before the first's
 * in `setOrder`, so {A,B} is not counted again as {B,A}.
 *
 * BUG FIXED in the uniqueness/tier session: that rule used to compare POSITIONS
 * in the candidate list, but the list is rebuilt after the first copy's set is
 * removed, so the positions meant different sets. On bags with duplicate tiles
 * it undercounted, sometimes to 0 for a solvable bag (found by
 * uniqueness.verify.ts section 4: 17 of 3971 random bags). Bags without
 * duplicates were never affected.
 *
 * This counts a run of six and the same tiles as two runs of three as TWO
 * partitions. For "does this puzzle have one answer" use `distinctSolutions`.
 */
export function partitionCount(bag: Tile[], cap = 1000): number {
  const cnt = countsOf(bag)
  let found = 0
  const rec = (from: number, lastIdx: number, lastSet: LSet | null): void => {
    if (found >= cap) return
    let i = from
    while (i < cnt.length && cnt[i] === 0) i++
    if (i === cnt.length) { found++; return }
    for (const s of setsContaining(cnt, i)) {
      // The smallest label can only START a run — nothing below it remains.
      if (s[0] !== i) continue
      if (i === lastIdx && lastSet && setOrder(s, lastSet) < 0) continue
      apply(cnt, s, -1)
      rec(i, i, s)
      apply(cnt, s, +1)
      if (found >= cap) return
    }
  }
  rec(4, -1, null)
  return found
}

/** One group as a 4-bit colour mask, and every mask with >= 3 colours. */
const GROUP_MASKS = [0b0111, 0b1011, 0b1101, 0b1110, 0b1111]

/**
 * Run-feasibility automaton for ONE colour, walked value by value. A state is
 * the lengths (capped at 3) of the up-to-two runs still open at the previous
 * value, packed as `a * 4 + b` with a >= b and 0 = no run. A run may stop only
 * at length >= 3. `c` is how many tiles of this colour sit at the next value.
 */
function runStep(states: Set<number>, c: number): Set<number> {
  const out = new Set<number>()
  const closable = (x: number): boolean => x === 0 || x === 3
  const grow = (x: number): number => Math.min(3, x + 1)
  const put = (x: number, y: number): void => { out.add(x >= y ? x * 4 + y : y * 4 + x) }
  for (const s of states) {
    const a = s >> 2
    const b = s & 3
    if (c === 0) { if (closable(a) && closable(b)) put(0, 0); continue }
    if (c === 1) {
      if (a > 0 && closable(b)) put(grow(a), 0)
      if (b > 0 && closable(a)) put(grow(b), 0)
      if (closable(a) && closable(b)) put(1, 0)
      continue
    }
    if (a > 0 && b > 0) put(grow(a), grow(b))
    if (a > 0 && closable(b)) put(grow(a), 1)
    if (b > 0 && closable(a)) put(grow(b), 1)
    if (closable(a) && closable(b)) put(1, 1)
  }
  return out
}

export interface DistinctSolutions {
  /** Distinct solutions found, never more than `cap`. */
  count: number
  /** Search nodes visited (one per value per group choice). */
  nodes: number
}

/**
 * THE UNIQUENESS PROOF. Counts the DISTINCT SOLUTIONS of a bag, exhaustively,
 * stopping as soon as `cap` are found (cap 2 = "prove unique or find a second").
 *
 * Two partitions are the SAME solution when they put the same tiles into the
 * same groups. They can then differ only in where a colour's run tiles are cut
 * into runs (a run of six is also two runs of three), and that is not a second
 * answer: laid on the board the cut and uncut rows are the same tiles in the
 * same order. `partitionCount` counts those cuts separately, which is why it
 * reported 16 and 81 "solutions" for bags that have exactly one.
 *
 * Method: walk the values 1..13. At each value choose which groups are formed
 * there (none, one or two); every tile not grouped must be in a run, so each
 * colour's leftovers feed a small automaton (`runStep`) that tracks the runs
 * still open. A branch dies the moment a colour has no way to continue. A leaf
 * is a group choice whose leftovers decompose into runs, i.e. one solution, and
 * each solution is reached exactly once (two groups at a value are generated in
 * mask order only). No sampling, no node cap: the search is complete.
 */
export function distinctSolutions(bag: Tile[], cap = 2): DistinctSolutions {
  if (bag.length === 0) return { count: 0, nodes: 0 }
  const cnt = countsOf(bag)
  for (let i = 4; i < cnt.length; i++) if (cnt[i] > 2) return { count: 0, nodes: 0 }
  let count = 0
  let nodes = 0
  const start = new Set([0])
  const rec = (v: number, states: Set<number>[]): void => {
    if (count >= cap) return
    if (v === NV) {
      // Past value 13: every colour must be able to close all its runs.
      if (states.every(st => runStep(st, 0).size > 0)) count++
      return
    }
    const base = v * 4
    const tryLeftover = (): void => {
      nodes++
      const next: Set<number>[] = []
      for (let k = 0; k < 4; k++) {
        const st = runStep(states[k], cnt[base + k])
        if (st.size === 0) return
        next.push(st)
      }
      rec(v + 1, next)
    }
    const fits = (m: number): boolean => {
      for (let k = 0; k < 4; k++) if ((m >> k) & 1 && cnt[base + k] === 0) return false
      return true
    }
    const take = (m: number, d: number): void => { for (let k = 0; k < 4; k++) if ((m >> k) & 1) cnt[base + k] += d }
    tryLeftover() // no group at this value
    for (let i = 0; i < GROUP_MASKS.length && count < cap; i++) {
      const m1 = GROUP_MASKS[i]
      if (!fits(m1)) continue
      take(m1, -1)
      tryLeftover() // one group
      for (let j = i; j < GROUP_MASKS.length && count < cap; j++) {
        const m2 = GROUP_MASKS[j]
        if (!fits(m2)) continue
        take(m2, -1)
        tryLeftover() // two groups
        take(m2, +1)
      }
      take(m1, +1)
    }
  }
  rec(1, [start, start, start, start])
  return { count, nodes }
}

/**
 * The same number by brute force, for the harness only: enumerate every strict
 * partition and collect the distinct group sets. Slow and capped by partitions,
 * so it is the independent oracle for `distinctSolutions`, never a gate.
 */
export function distinctSolutionsBrute(bag: Tile[], partitionCap = 200_000): { count: number; partitions: number; groupSets: string[][] } {
  const cnt = countsOf(bag)
  const sigs = new Set<string>()
  const groups: string[] = []
  let partitions = 0
  const rec = (from: number, lastIdx: number, lastSet: LSet | null): void => {
    if (partitions >= partitionCap) return
    let i = from
    while (i < cnt.length && cnt[i] === 0) i++
    if (i === cnt.length) { partitions++; sigs.add([...groups].sort().join(';')); return }
    for (const s of setsContaining(cnt, i)) {
      if (s[0] !== i) continue
      if (i === lastIdx && lastSet && setOrder(s, lastSet) < 0) continue
      const isGroup = (s[0] >> 2) === (s[1] >> 2)
      apply(cnt, s, -1)
      if (isGroup) groups.push(s.join(','))
      rec(i, i, s)
      if (isGroup) groups.pop()
      apply(cnt, s, +1)
    }
  }
  rec(4, -1, null)
  const name = (i: number): string => `${i >> 2}${COLORS[i & 3]}`
  const groupSets = [...sigs].map(sig => (sig === '' ? [] : sig.split(';').map(g => g.split(',').map(x => name(+x)).join(' '))))
  return { count: sigs.size, partitions, groupSets }
}

export interface TrapDensity {
  /** Label-distinct valid sets formable from the bag (the "plausible" commitments). */
  plausible: number
  /** Of those, how many appear in NO solution: commit to one and the rest is unsolvable. */
  dead: number
}

/**
 * PROXY 2 — TRAP DENSITY. Of every valid set a player could assemble from the
 * tiles in front of them, what fraction is a dead end?
 */
export function trapDensity(bag: Tile[]): TrapDensity {
  const cnt = countsOf(bag)
  const n = total(cnt)
  const sets = allSets(cnt)
  let dead = 0
  for (const s of sets) {
    if (s.length === n) continue
    apply(cnt, s, -1)
    if (!solvable(cnt)) dead++
    apply(cnt, s, +1)
  }
  return { plausible: sets.length, dead }
}

export interface Cascade {
  /** Rounds of myopic deduction completed. */
  depth: number
  /** Myopic reasoning ran out of forced tiles before the bag was empty. */
  stalled: boolean
  /** Fraction of tiles myopic reasoning placed before stalling (1 = solved). */
  resolved: number
  /** Fraction of tiles with exactly one candidate set at move zero. */
  forcedAtZero: number
  /** Tiles still ambiguous (>=2 candidate sets) at the start of each round. */
  ambiguous: number[]
}

/**
 * PROXY 3 — MYOPIC CASCADE (the chain archetype's local model, generalised to
 * m=2). A tile is determined when exactly ONE valid set containing it can
 * still be formed, ignoring whether the remainder stays solvable. Each round
 * commits every determined set, which is what unlocks the next round.
 */
export function myopicCascade(bag: Tile[]): Cascade {
  const cnt = countsOf(bag)
  const n = total(cnt)
  const ambiguous: number[] = []
  let depth = 0
  let forcedAtZero = 0
  for (let guard = 0; guard < 80 && total(cnt) > 0; guard++) {
    const forced = new Map<string, LSet>()
    let amb = 0
    let forcedTiles = 0
    for (let i = 4; i < cnt.length; i++) {
      if (cnt[i] === 0) continue
      const cands = setsContaining(cnt, i)
      if (cands.length === 1) { forced.set(cands[0].join(','), cands[0]); forcedTiles += cnt[i] }
      else if (cands.length >= 2) amb += cnt[i]
    }
    ambiguous.push(amb)
    if (depth === 0) forcedAtZero = forcedTiles / n
    if (forced.size === 0) return { depth, stalled: true, resolved: 1 - total(cnt) / n, forcedAtZero, ambiguous }
    for (const s of forced.values()) if (formable(cnt, s)) apply(cnt, s, -1)
    depth++
  }
  return { depth, stalled: total(cnt) > 0, resolved: 1 - total(cnt) / n, forcedAtZero, ambiguous }
}

/**
 * PROXY 4 — GUESSWORK COST. A solver with no insight: pick a random remaining
 * tile, commit a random valid set containing it, back out when stuck. Returns
 * the number of commitments UNDONE before the first full solution, averaged
 * over `trials` random orders (each capped at `nodeCap` commitments).
 */
export function guessworkCost(bag: Tile[], trials = 20, nodeCap = 20_000): { mean: number; median: number; capped: number } {
  const results: number[] = []
  let capped = 0
  for (let t = 0; t < trials; t++) {
    const cnt = countsOf(bag)
    let undone = 0
    let nodes = 0
    let hitCap = false
    const rec = (): boolean => {
      const live: number[] = []
      for (let i = 4; i < cnt.length; i++) if (cnt[i] > 0) live.push(i)
      if (live.length === 0) return true
      const pick = live[Math.floor(Math.random() * live.length)]
      const cands = setsContaining(cnt, pick)
      for (let i = cands.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[cands[i], cands[j]] = [cands[j], cands[i]]
      }
      for (const s of cands) {
        if (++nodes > nodeCap) { hitCap = true; return false }
        apply(cnt, s, -1)
        if (rec()) return true
        apply(cnt, s, +1)
        undone++
        if (hitCap) return false
      }
      return false
    }
    rec()
    if (hitCap) capped++
    results.push(undone)
  }
  const sorted = [...results].sort((a, b) => a - b)
  return {
    mean: results.reduce((a, b) => a + b, 0) / trials,
    median: sorted[Math.floor(trials / 2)],
    capped,
  }
}

export interface BoardTraps {
  /** Maximal horizontal segments on the starting board (each is a valid set). */
  rows: number
  /** Segments that survive intact in NO solution: the player must break them. */
  rowsMustBreak: number
  /** Rack tiles that visibly extend a board set (run end, or 4th colour of a group). */
  tempting: number
  /** Of those, the ones whose extension is a dead end. */
  temptingDead: number
}

/**
 * PROXY 5 — BOARD TRAPS. The two things a player sees at move zero: finished-
 * looking rows, and rack tiles that fit on the end of one.
 */
export function boardTraps(grid: Grid, rack: Tile[]): BoardTraps {
  const segs: Tile[][] = []
  for (const row of grid) {
    let cur: Tile[] = []
    for (const t of [...row, null]) {
      if (t) cur.push(t)
      else { if (cur.length) segs.push(cur); cur = [] }
    }
  }
  const bag = [...segs.flat(), ...rack]
  const deadWithout = (set: Tile[]): boolean => {
    const ids = new Set(set.map(t => t.id))
    const rest = bag.filter(t => !ids.has(t.id))
    return rest.length > 0 && !solveBagM2(rest).solvable
  }
  let rowsMustBreak = 0
  for (const s of segs) if (deadWithout(s)) rowsMustBreak++
  let tempting = 0
  let temptingDead = 0
  for (const t of rack) {
    const fits = segs.filter(s => isValidRun([...s, t]) || isValidGroup([...s, t]))
    if (fits.length === 0) continue
    tempting++
    if (fits.every(s => deadWithout([...s, t]))) temptingDead++
  }
  return { rows: segs.length, rowsMustBreak, tempting, temptingDead }
}

export interface TechniqueLadder {
  /** Deduction steps taken at each technique level, [L0, L1, L2, L3]. */
  steps: [number, number, number, number]
  /** Hardest technique the puzzle needed (0-3). Free choices do not count. */
  maxLevel: number
  /**
   * Steps where no technique applied because nothing needed deducing: some tile
   * had two or more sets that EACH leave a solvable bag, so the solver just took
   * one. On a bag with one distinct solution these are cuts of a long run.
   */
  freeChoices: number
}

/**
 * PROXY 6 — TECHNIQUE LADDER, the analogue of a sudoku grader. The bag is
 * solved one committed set at a time, always using the weakest technique that
 * makes progress:
 *
 *   L0  single     a tile has exactly one valid set it can still join
 *   L1  stranding  all but one of a tile's sets, if committed, would leave
 *                  some other tile with no set at all
 *   L2  chain      all but one of a tile's sets, if committed and followed by
 *                  forced singles, runs into a stranded tile
 *   L3  oracle     none of the above works: the step needs deeper search (or,
 *                  when the bag has several solutions, is a free choice)
 *
 * Every elimination is sound, so the walk always ends in a real solution.
 */
export function techniqueLadder(bag: Tile[]): TechniqueLadder {
  const cnt = countsOf(bag)
  const steps: [number, number, number, number] = [0, 0, 0, 0]
  let freeChoices = 0

  const labels = (): number[] => {
    const out: number[] = []
    for (let i = 4; i < cnt.length; i++) if (cnt[i] > 0) out.push(i)
    return out
  }
  const stranded = (): boolean => labels().some(i => setsContaining(cnt, i).length === 0)
  /** Commit forced singles until none remain; true if a tile ends up stranded. */
  const singlesContradict = (): boolean => {
    const undo: LSet[] = []
    let bad = false
    for (;;) {
      if (stranded()) { bad = true; break }
      let forced: LSet | null = null
      for (const i of labels()) {
        const c = setsContaining(cnt, i)
        if (c.length === 1) { forced = c[0]; break }
      }
      if (!forced) break
      apply(cnt, forced, -1)
      undo.push(forced)
    }
    for (const s of undo) apply(cnt, s, +1)
    return bad
  }
  const survivors = (i: number, level: 1 | 2): LSet[] =>
    setsContaining(cnt, i).filter(s => {
      apply(cnt, s, -1)
      const bad = level === 1 ? stranded() : singlesContradict()
      apply(cnt, s, +1)
      return !bad
    })

  while (total(cnt) > 0) {
    let pick: LSet | null = null
    let level = 0
    for (const i of labels()) {
      const c = setsContaining(cnt, i)
      if (c.length === 1) { pick = c[0]; break }
    }
    for (const lv of [1, 2] as const) {
      if (pick) break
      for (const i of labels()) {
        const c = survivors(i, lv)
        if (c.length === 1) { pick = c[0]; level = lv; break }
      }
    }
    if (!pick) {
      // Nothing weaker works. Before calling it L3, separate the two cases the
      // old fallback merged: a FREE CHOICE (a tile with >= 2 sets that each keep
      // the bag solvable: nothing to deduce, take the largest) and a genuine L3
      // step (every tile has exactly one workable set, but L0-L2 cannot see it).
      // Grading free choices as L3 is what made every groups-to-runs bag with a
      // run of six or more read as "hardest technique 3".
      let forcedPick: LSet | null = null
      let freePick: LSet | null = null
      for (const i of labels()) {
        const ok = setsContaining(cnt, i).filter(s => {
          apply(cnt, s, -1)
          const good = total(cnt) === 0 || solvable(cnt)
          apply(cnt, s, +1)
          return good
        })
        if (ok.length >= 2) { freePick = ok.reduce((a, b) => (b.length > a.length ? b : a)); break }
        if (ok.length === 1 && !forcedPick) forcedPick = ok[0]
      }
      if (freePick) { apply(cnt, freePick, -1); freeChoices++; continue }
      if (!forcedPick) break // unsolvable bag: nothing to grade
      pick = forcedPick
      level = 3
    }
    apply(cnt, pick, -1)
    steps[level]++
  }
  return { steps, maxLevel: steps[3] ? 3 : steps[2] ? 2 : steps[1] ? 1 : 0, freeChoices }
}

/**
 * How much reasoning it takes to see that committing `committed` is a mistake.
 *   0  it is not a mistake: the remainder is still solvable
 *   1  some remaining tile is left with no set at all (visible at once)
 *   2  no tile is stranded yet, but following forced singles strands one
 *   3  the remainder is unsolvable, yet neither of the above shows it
 * The trap layers' "tempting" commitments are graded with this: depth 1 is a
 * trap that announces itself, depth 2+ only fails after a further forced step.
 */
export function refutationDepth(bag: Tile[], committed: Tile[]): 0 | 1 | 2 | 3 {
  const ids = new Set(committed.map(t => t.id))
  const rest = bag.filter(t => !ids.has(t.id))
  if (rest.length === 0 || solveBagM2(rest).solvable) return 0
  const cnt = countsOf(rest)
  const live = (): number[] => {
    const out: number[] = []
    for (let i = 4; i < cnt.length; i++) if (cnt[i] > 0) out.push(i)
    return out
  }
  const stranded = (): boolean => live().some(i => setsContaining(cnt, i).length === 0)
  if (stranded()) return 1
  for (;;) {
    let forced: LSet | null = null
    for (const i of live()) {
      const c = setsContaining(cnt, i)
      if (c.length === 1) { forced = c[0]; break }
    }
    if (!forced) return 3
    apply(cnt, forced, -1)
    if (stranded()) return 2
  }
}

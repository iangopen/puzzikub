import type { Difficulty, Puzzle } from '../types'
import {
  buildChain, buildChainVariant, buildComposed, buildComposedVariant, buildCutPoint, buildDecoy, buildDecoyVariant,
  buildRedHerring, buildRedHerringVariant, buildGroupsToRuns, buildRunsToGroups, groupsToRunsShipsAt, type ArchetypeType, type ArchetypeResult,
} from './archetypes'
import { shipVerdict } from './tierBands'

const BUILDERS: Record<ArchetypeType, (diff: Difficulty) => ReturnType<typeof buildGroupsToRuns>> = {
  'groups-to-runs': buildGroupsToRuns,
  'runs-to-groups': buildRunsToGroups,
}

/**
 * Optional trap layers, hard/extreme only. All are runs-to-groups boards with
 * tempting-but-dead-end tiles whose par flows through the normal `optimalMoves`
 * field: decoy = ONE tempting tile (DECOY_DESIGN.md); red herring = TWO tempting
 * extenders at opposite ends of one run, coupled through a single hybrid
 * reorganization (RED_HERRING_DESIGN.md); composed = a one-ended trap on one
 * colour AND a two-ended trap on another, on the same board, coupled through a
 * shared run-only high end (see buildComposedAt in archetypes.ts).
 *
 * A single random roll picks at most ONE layer via DISJOINT probability bands
 * ([0,composed) → composed, then decoy, then red herring). Composed is the
 * deepest and rarest; all three bands are visibly larger at extreme than hard.
 */
const COMPOSED_PROB: Partial<Record<Difficulty, number>> = { hard: 0.12, extreme: 0.25 }
const DECOY_PROB: Partial<Record<Difficulty, number>> = { hard: 0.20, extreme: 0.30 }
// Red herring at HARD was cut from 0.14 to 0.08 in the trap-variety session: at
// the sizes hard uses (L=5,6) it cannot be lifted above technique level L1 (see
// HERRING_SHIPPED in archetypes.ts), so it is the weakest layer in the tier. The
// freed 0.06 falls through to the base archetypes. Extreme is unchanged because
// extreme now ships only the L=7/8 filler variants, which are L2.
const REDHERRING_PROB: Partial<Record<Difficulty, number>> = { hard: 0.08, extreme: 0.22 }

/**
 * The cut-point layer (m=2 Step 11) — MEDIUM ONLY, and deliberately its own
 * band rather than a fourth entry in the trap sequence above: it is not a
 * runs-to-groups board with a tempting tile, it is a different puzzle entirely
 * (duplicate second copies that force an already-valid run to be cut apart).
 *
 * It cannot collide with the trap bands because those are hard/extreme only and
 * this is medium only, so the two roll ranges never apply to the same tier.
 */
const CUTPOINT_PROB: Partial<Record<Difficulty, number>> = { medium: 0.25 }

/**
 * The chain layer — EASY ONLY since the uniqueness/tier session (it was medium
 * only). Its par is 9 and every one of its eight steps is a forced single
 * (technique level 0), so in medium it sat below the whole easy tier on both
 * measures. It is the same roll as the cut-point band; the two layers are in
 * different tiers, so at most one can apply to a puzzle.
 *
 * Like cut-point it is a deduction puzzle rather than a trap puzzle: the board
 * is a set of already-valid rows, and the work is figuring out the unique
 * partition, which can only be deduced in sequence (see buildChainAt).
 */
const CHAIN_PROB: Partial<Record<Difficulty, number>> = { easy: 0.20 }

/**
 * Builder calls made and builder calls that returned null, across every retry
 * loop below. Read (and reset) by the audit and the harnesses: a retry loop hides
 * a builder that has started rejecting most of its draws, this does not.
 * `notUnique` and `outOfBand` are the two reasons `shipVerdict` gives; the rest
 * of `rejected` is builders returning null.
 */
export const generationStats = { attempts: 0, rejected: 0, notUnique: 0, outOfBand: 0 }

/**
 * DEV-ONLY escape hatch for playtesting a specific variant. Not reachable from
 * any UI control — PlayScreen only honours it when the developer deliberately
 * types ?forceArchetype=... into the URL. See FORCE_TYPES below.
 */
export type ForceType =
  | 'pure-groups-to-runs'
  | 'pure-runs-to-groups'
  | 'decoy'
  | 'red-herring'
  | 'composed'
  | 'cut-point'
  | 'chain'
  // Sub-families of the four layers above, so one can be played by name.
  // '<layer>' alone draws any shipped variant; '-classic' is the original puzzle.
  | 'decoy-classic'
  | 'decoy-mirror'
  | 'red-herring-classic'
  | 'red-herring-split'
  | 'composed-classic'
  | 'composed-mirror'
  | 'composed-third'
  | 'chain-classic'
  | 'chain-mirror'

/** The accepted values, for validating untrusted input (e.g. a query param). */
export const FORCE_TYPES: readonly ForceType[] = [
  'pure-groups-to-runs', 'pure-runs-to-groups', 'decoy', 'red-herring', 'composed', 'cut-point', 'chain',
  'decoy-classic', 'decoy-mirror', 'red-herring-classic', 'red-herring-split',
  'composed-classic', 'composed-mirror', 'composed-third', 'chain-classic', 'chain-mirror',
]

export function isForceType(v: string | null | undefined): v is ForceType {
  return !!v && (FORCE_TYPES as readonly string[]).includes(v)
}

/**
 * Direction is chosen ~50/50 per puzzle so players meet both across a session.
 * It is recorded on archetypeId for internal use only — nothing player-facing
 * reveals it, since naming the mechanic gives away the solution.
 *
 * If the chosen direction cannot build a puzzle, the other one is tried rather
 * than failing outright.
 *
 * `forceType` (dev-only) bypasses the probability bands entirely and calls one
 * builder directly. When it is undefined — the only case a real player ever hits
 * — nothing below changes: the same Math.random() draws happen in the same order
 * as before this parameter existed, so generation odds are untouched.
 *
 * A forced variant does NOT fall back to another archetype when its builder
 * cannot produce a puzzle (e.g. the trap layers are hard/extreme only, so
 * forcing 'decoy' at easy returns null). Failing visibly is the point of a dev
 * flag — silently handing back a different variant would defeat it.
 */
export function generatePuzzle(diff: Difficulty, forceType?: ForceType): Puzzle | null {
  if (forceType) {
    switch (forceType) {
      case 'pure-groups-to-runs': return generateArchetype('groups-to-runs', diff)
      case 'pure-runs-to-groups': return generateArchetype('runs-to-groups', diff)
      case 'decoy': return generateDecoy(diff)
      case 'red-herring': return generateRedHerring(diff)
      case 'composed': return generateComposed(diff)
      case 'cut-point': return generateCutPoint(diff)
      case 'chain': return generateChain(diff)
      case 'decoy-classic': return generateDecoy(diff, buildDecoy)
      case 'decoy-mirror': return generateDecoy(diff, d => buildDecoyVariant(d, v => v.mirror))
      case 'red-herring-classic': return generateRedHerring(diff, buildRedHerring)
      case 'red-herring-split': return generateRedHerring(diff, d => buildRedHerringVariant(d, v => v.split))
      case 'composed-classic': return generateComposed(diff, buildComposed)
      case 'composed-mirror': return generateComposed(diff, d => buildComposedVariant(d, v => v.mirror))
      case 'composed-third': return generateComposed(diff, d => buildComposedVariant(d, v => v.lowOnClean))
      case 'chain-classic': return generateChain(diff, buildChain)
      case 'chain-mirror': return generateChain(diff, d => buildChainVariant(d, v => v.mirror))
    }
  }

  // The two deduction layers (cut-point at medium, chain at easy) share ONE
  // roll, so at most one can apply to a puzzle.
  const cutPointP = CUTPOINT_PROB[diff] ?? 0
  const chainP = CHAIN_PROB[diff] ?? 0
  if (cutPointP + chainP > 0) {
    const deductionRoll = Math.random()
    if (deductionRoll < cutPointP) {
      const cut = generateCutPoint(diff)
      if (cut) return cut // else fall through to the ordinary archetypes
    } else if (deductionRoll < cutPointP + chainP) {
      const chain = generateChain(diff)
      if (chain) return chain
    }
  }

  const roll = Math.random()
  const composedP = COMPOSED_PROB[diff] ?? 0
  const decoyP = DECOY_PROB[diff] ?? 0
  const herringP = REDHERRING_PROB[diff] ?? 0
  if (roll < composedP) {
    const composed = generateComposed(diff)
    if (composed) return composed // else fall through to the ordinary archetypes
  } else if (roll < composedP + decoyP) {
    const decoy = generateDecoy(diff)
    if (decoy) return decoy
  } else if (roll < composedP + decoyP + herringP) {
    const herring = generateRedHerring(diff)
    if (herring) return herring
  }
  // groups-to-runs has no extreme size (see paramsFor in archetypes.ts). The coin
  // is still flipped so the draws at the other tiers are unchanged.
  const coin = Math.random() < 0.5
  if (!groupsToRunsShipsAt(diff)) return generateArchetype('runs-to-groups', diff)
  const first: ArchetypeType = coin ? 'groups-to-runs' : 'runs-to-groups'
  const second: ArchetypeType = first === 'groups-to-runs' ? 'runs-to-groups' : 'groups-to-runs'
  return generateArchetype(first, diff) ?? generateArchetype(second, diff)
}

type TrapBuilder = (diff: Difficulty) => ArchetypeResult | null

/**
 * THE ONE RETRY LOOP every archetype goes through. A build is shipped only if
 * `shipVerdict` passes it: its bag has exactly one distinct solution (proved by
 * an exhaustive search that stops at the second, never sampled) and its par is
 * inside the tier's band (tierBands.ts). Anything else is counted and redrawn.
 *
 * `archetypeId` is the hidden internal tag; nothing player-facing reads it.
 * Exported so the harness can feed it a builder that returns a known
 * two-solution puzzle and watch it get refused (uniqueness.verify.ts).
 */
export function generateWith(diff: Difficulty, archetypeId: string, build: TrapBuilder): Puzzle | null {
  for (let i = 0; i < 40; i++) {
    const result = build(diff)
    generationStats.attempts++
    if (!result) { generationStats.rejected++; continue }
    const verdict = shipVerdict(diff, result.allTiles, result.minMoves)
    if (verdict !== 'ok') {
      generationStats.rejected++
      if (verdict === 'not-unique') generationStats.notUnique++
      else generationStats.outOfBand++
      continue
    }
    return {
      id: `gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: `${diff} puzzle`,
      diff,
      grid: result.grid,
      rack: result.rack,
      optimalMoves: result.minMoves,
      generated: true,
      archetypeId,
    }
  }
  return null
}

/** Chain puzzles: already-valid rows whose unique partition is deduced in sequence. */
const generateChain = (diff: Difficulty, build: TrapBuilder = buildChainVariant): Puzzle | null =>
  generateWith(diff, 'chain', build)

/** Cut-point puzzles: duplicate second copies force an already-valid run to be cut apart. */
const generateCutPoint = (diff: Difficulty): Puzzle | null => generateWith(diff, 'cut-point', buildCutPoint)

/** Composed puzzles: decoy + red herring on one board. */
const generateComposed = (diff: Difficulty, build: TrapBuilder = buildComposedVariant): Puzzle | null =>
  generateWith(diff, 'runs-to-groups-composed', build)

const generateDecoy = (diff: Difficulty, build: TrapBuilder = buildDecoyVariant): Puzzle | null =>
  generateWith(diff, 'runs-to-groups-decoy', build)

const generateRedHerring = (diff: Difficulty, build: TrapBuilder = buildRedHerringVariant): Puzzle | null =>
  generateWith(diff, 'runs-to-groups-redherring', build)

export function generateArchetype(type: ArchetypeType, diff: Difficulty): Puzzle | null {
  return generateWith(diff, type, BUILDERS[type])
}

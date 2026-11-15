/**
 * What each difficulty tier is allowed to ship. Pure module, no React.
 *
 * A tier's band is on PAR, because par is the one difficulty number that (a) the
 * builders are parameterised to hit, (b) the player is shown, and (c) orders the
 * tiers at all. The technique ladder in difficultyProxy.ts does not: plain easy
 * runs-to-groups and the extreme trap layers both top out at L2 (see
 * GENERATOR_AUDIT.md section 8). The bands are disjoint and cover 9..32 with no
 * gap, so every generated puzzle rates as exactly one tier.
 *
 * `generatePuzzle` rejects any build whose par is outside its tier's band or
 * whose bag does not have exactly one distinct solution, and the audit
 * (`generatorAudit.ts`) re-checks both independently on its own sample.
 */
import type { Difficulty, Tile } from '../types'
import { distinctSolutions } from './difficultyProxy'

export const PAR_BAND: Record<Difficulty, readonly [number, number]> = {
  easy: [9, 11],
  medium: [12, 16],
  hard: [17, 24],
  extreme: [25, 32],
}

export const TIERS: readonly Difficulty[] = ['easy', 'medium', 'hard', 'extreme']

/** The tier a par value rates as, or null when it is outside every band. */
export function tierOfPar(par: number): Difficulty | null {
  for (const d of TIERS) if (par >= PAR_BAND[d][0] && par <= PAR_BAND[d][1]) return d
  return null
}

export const parInBand = (diff: Difficulty, par: number): boolean => tierOfPar(par) === diff

/** Proved unique: the exhaustive search found one solution and no second. */
export const hasUniqueSolution = (bag: Tile[]): boolean => distinctSolutions(bag, 2).count === 1

export type ShipVerdict = 'ok' | 'not-unique' | 'out-of-band'

/** The gate every generated puzzle passes through. */
export function shipVerdict(diff: Difficulty, bag: Tile[], par: number): ShipVerdict {
  if (!parInBand(diff, par)) return 'out-of-band'
  if (!hasUniqueSolution(bag)) return 'not-unique'
  return 'ok'
}

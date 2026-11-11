# Session history

## 2026-11-11 — generator audit (branch `generator-audit`)
- Wrote `GENERATOR_AUDIT.md`: 200 puzzles per archetype and tier, six non-par
  difficulty proxies (`src/lib/difficultyProxy.ts`, `src/lib/generatorAudit.ts`).
- Found runs-to-groups generation at 1.1-1.5 s per build (over the 1 s budget).
  Replaced the L! search in `planValueGroupGoal` with an occupied-row search,
  proven equal to the kept exhaustive original (`valueGroupPlanner.verify.ts`).
- Added a uniqueness gate to runs-to-groups (29% of easy builds had a cheaper
  second solution).
- Recalibrated extreme runs-to-groups to L=8 / par 23.
- Three harness loops (`valueGroupPlanner`, `verifyEngine`, `pairingMin`) treated
  a `null` build as a failure; each was changed to retry, as the generator does.
- Not merged, not deployed. Open leads ranked in `GENERATOR_AUDIT.md` §5.

## 2026-11-11 — trap variety (branch `trap-variety`, off `generator-audit`)
- Probed every candidate variant at the bag level first; shipped only those
  measured unique with dead traps (`GENERATOR_AUDIT.md` §7.2 lists the walls).
- Generalised decoy / red herring / composed into one core each, with named
  proof steps; added mirror + row-order variants to chain.
- Extreme red herring moved to L=7/8 with a middle filler (L2); hard band cut.
- New harness `trapVariants.verify.ts` (118). The new uniqueness step also
  rejected the unshipped `buildComposedAt(8)` with no filler (5 solutions).
- Added 30 exhaustive comparisons each at L=7 and L=8 for the group planner,
  and rejection-rate reporting to the retrying harnesses and the audit.
- Not merged, not deployed.

## 2026-11-11 — merge + deploy, then Library Play fix (branch `library-play-fix`)
- Fast-forwarded `generator-audit` and `trap-variety` into `main` and deployed.
- Wired Library Play through `App` into `PlayScreen` (`savedPuzzle` prop). Par is
  hidden for hand-built puzzles. Added `data-tile-id` test hooks.
- New committed rigs: `verify:library` (37, mutation-tested) and `verify:live` (14).
- First `verify:library` run had 8 failures, all test bugs: Undo keeps `moves`
  by design; the NavBar's bold button was read as the pill; the rack "+" matched
  "+ add row"; generated extreme puzzles can coincide, so F was re-anchored on
  the hand-built puzzle.

## 2026-11-11 — dependency audit (branch `deps-audit`)
- Added `npm run verify` / `verify:full` (`scripts/verify-all.mjs`). The first
  version ran harnesses in parallel and trusted exit codes. It reported 14/14 OK
  while redherring and cutpoint had failed timing budgets. Fixed: sequential
  timed harnesses, and failures read from summary lines.
- `npm audit fix` (no --force): 18 → 10 findings; 12 of 13 GitHub alerts fixed.
  minimatch (eslint 10 chain, major bump) is left and documented.

## 2026-11-11 — repo polish (branch `repo-polish`)
- Real README with screenshots (`scripts/screenshots.mjs`); quick-start proven
  in a fresh clone.
- DarkVeil credited after reading the React Bits license (MIT + Commons Clause)
  and ogl's (Unlicense).
- Lint 8 → 0 and added to `npm run verify`.

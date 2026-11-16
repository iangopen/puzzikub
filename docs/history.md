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

## 2026-11-15 — uniqueness gate + tier bands (branch `generator-uniqueness-tiers`)
- Baseline first, on `main`, with a seeded audit (n=1000 per tier): 29.4% of
  medium puzzles had two solutions; hard and extreme had none. The recorded
  "16 / 81 solutions" were cuts of one solution.
- Added `distinctSolutions` (exhaustive, stops at the second), `tierBands.ts`,
  one gated retry loop in `generator.ts`, and `uniqueness.verify.ts` (51).
- The new harness failed once: 17 of 3,971 random bags disagreed with brute
  force. Root cause was in the brute-force side, a duplicate-ordering bug
  inherited from `partitionCount`. Fixed there; the search was right.
- groups-to-runs medium rack 3 → 4; chain medium → easy; extreme runs-to-groups
  L=8 → L=9 (par 26).
- Not merged, not deployed.


## 2026-11-15 (later) — finish check, cut-vs-par, sticky rack, timing checks (same branch)
- Baseline: `verify` 16/16; `verify:full` FAILED (uniqueness max-time check, 4/4
  tiers, under load).
- Finish check: no bug. Reducer moved to `src/lib/playReducer.ts`; new
  `finishLayouts.verify.ts` (20) plays every strict partition through it.
  Found that out-of-order runs are accepted; pinned, not changed.
- Cut vs par: new `cutRunPlanner.ts` + `cutVsPar.ts`. Groups-to-runs par was
  beaten on 890/1,178 puzzles (n=1000/tier). Par is now `planRunGoal`;
  groups-to-runs left extreme; hard uses L=6. `GENERATOR_AUDIT.md` §9.
- Removed the rig's redraw-until-rack-visible loop; sticky rack in PlayScreen;
  chain-forced touch suite added to `verify:mobile`; rig cell pickers skip cells
  under the rack. Screenshot `docs/screenshots/phone-chain.png`.
- Timing checks made load-robust: red herring (median after warm-up, mutation
  tested), uniqueness (node count + median), pairingMin (coverage loop's clock
  cap 480 s → 1200 s after it failed under a slow `verify:full`).
- Not merged, not deployed.

## 2026-11-15 — runs must read ascending (branch `generator-uniqueness-tiers`)
- Baseline `verify` 16/17: redherring's extreme timing check failed while a probe of
  mine ran alongside it; alone it was 25/0.
- Rule: ascending left to right (Tutorial.tsx:11, "consecutive order"; direction from the
  Rummikub convention). `isOrderedRun` in the grid check only.
- `runOrder.verify.ts`: 10/5 before the fix, 15/0 after. finishLayouts pin flipped.
- Exposed and fixed an unsound memo key in `existsNoRelocationWin`.
- After: `verify` 18/18; cut-vs-par PASS; chain phone screenshot regenerated.
- Not merged, not deployed.

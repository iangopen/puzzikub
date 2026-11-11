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

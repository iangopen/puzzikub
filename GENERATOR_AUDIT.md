# Generator audit

*Session of 2026-11-11, branch `generator-audit`. Not merged, not deployed.*

Every number here is real executed output from `npx tsx src/lib/generatorAudit.ts 200`
(200 puzzles per row, generated through the real `generatePuzzle()` path).
Re-run it after any change to `archetypes.ts` or `generator.ts`; a second argument
filters rows (`... 200 decoy`). The proxies live in `src/lib/difficultyProxy.ts`.

## 1. Summary

| | finding | status |
|---|---|---|
| 1 | Generation was over the 1 s budget: hard p95 1197 ms, extreme p95 1128 ms, caused by one archetype (runs-to-groups, 1.3-1.5 s per build) | **fixed**: p95 54 ms / 79 ms |
| 2 | 29% of easy runs-to-groups puzzles had a second, cheaper solution that never dismantles the board | **fixed**: 100% unique |
| 3 | Extreme runs-to-groups was the same puzzle as hard (L=7, par 20) | **fixed**: L=8, par 23 (deliberate recalibration) |
| 4 | Trap layers have 3 structural shapes each (6 for composed, 6 for chain) | **done on `trap-variety`**: 18-48 per tier, see §7 |
| 5 | Red herring needs a weaker technique than plain easy runs-to-groups | **extreme done** (L2), hard band cut, see §7.3 |
| 6 | groups-to-runs has 2 / 16 / 81 solutions at medium / hard / extreme | open |
| 7 | Medium mixes technique levels 0-3 and par 9-16 | open |

Par is not a difficulty measure across archetypes, and no single proxy below is
either. The technique ladder (proxy 6) is the closest thing to a shared yardstick
and is the one the rankings lean on.

## 2. The proxies: what each one captures and what it misses

All are computed on the bag (board + rack tiles, positions ignored) unless noted,
and all treat the two copies of a duplicate tile as interchangeable.

| # | proxy | captures | misses |
|---|---|---|---|
| 1 | **Solution count**: label-distinct partitions of the bag into valid sets (capped at 1000) | Whether there is one answer to find or many to stumble into. More than one usually means a cheaper answer than par exists. | Says nothing about how hard the one answer is to find. |
| 2 | **Trap density**: of every valid set formable from the bag, the share that appears in no solution | How often "this looks like a set" is wrong. | Saturated: 78-91% on every archetype, so it does not rank them. Weights an obscure set the same as an obvious one. |
| 3 | **Myopic cascade** (the chain archetype's model, extended to duplicates): rounds in which some tile has exactly one set it can still join | Whether a player can make progress with "where can this tile even go?" alone, and how long that chain is. | Stalls at round 0 on every archetype except chain, so it only describes chain. |
| 4 | **Guesswork cost**: commitments undone by a random backtracking solver before its first solution (mean of 20 runs) | Raw search-space size for a player with no insight. | Dominated by tile count. Humans do not search randomly, so it overstates insight puzzles. |
| 5 | **Board traps** (uses the grid): board rows that survive in no solution; rack tiles that visibly extend a board set, and how many of those extensions are dead | The two things visible at move zero: finished-looking rows and tiles that seem to fit. The only proxy that sees temptation. | Counts temptations, not how convincing they are. |
| 6 | **Technique ladder**: solve the bag one set at a time using the weakest technique that works. **L0** single (a tile has one possible set). **L1** stranding (all but one of a tile's sets would leave another tile with no set). **L2** chain (all but one would, after following forced singles, strand a tile). **L3** none of these: deeper search, or a free choice when the bag has several solutions. | The kind of reasoning the bag demands, in the way a sudoku grader ranks by hardest technique. Comparable across archetypes. | Bag only: blind to layout, to how tempting a wrong move looks, and to the move-planning that par measures. L3 on a multi-solution bag means "pick one", not "hard". Greedy, so step counts are one valid path, not the shortest. |

None of these has been checked against a human solver. They rank puzzles by
structure; whether that matches how hard a puzzle feels is for playtesting.

## 3. Baseline (before any change)

### A. Par, size, variety, generation time

| archetype / tier | n | par (value:count) | tiles | grid rows x cols | distinct exact | distinct structural | gen ms mean / p95 / max |
|---|---|---|---|---|---|---|---|
| pure-groups-to-runs / easy | 200 | 10:83 11:113 12:4 | 14:200 | 6x8 | 200 | 195 | 0.2 / 0.4 / 2.3 |
| pure-groups-to-runs / medium | 200 | 11:4 12:28 13:85 14:62 15:21 | 19:200 | 6x9 | 200 | 200 | 0.2 / 0.4 / 0.5 |
| pure-groups-to-runs / hard | 200 | 16:1 17:8 18:29 19:25 20:66 21:71 | 24:200 | 7x10 | 200 | 200 | 0.4 / 0.5 / 0.8 |
| pure-groups-to-runs / extreme | 200 | 20:1 21:3 22:22 23:11 24:70 25:80 26:13 | 28:200 | 8x11 | 200 | 200 | 0.6 / 1.1 / 14.5 |
| pure-runs-to-groups / easy | 200 | 11:200 | 17:200 | 7x7 | 192 | 10 | 16.1 / 25.5 / 66.5 |
| pure-runs-to-groups / medium | 200 | 16:200 | 22:200 | 8x8 | 189 | 6 | 149.7 / 190.4 / 318.8 |
| pure-runs-to-groups / hard | 200 | 20:200 | 26:200 | 9x9 | 162 | 3 | 1272.3 / 1475.9 / 1810.5 |
| pure-runs-to-groups / extreme | 200 | 20:200 | 26:200 | 9x9 | 177 | 3 | 1129.4 / 1366.1 / 1593.3 |
| decoy / hard | 200 | 22:200 | 22:200 | 7x9 | 170 | 3 | 0.7 / 2.1 / 4.2 |
| decoy / extreme | 200 | 25:200 | 25:200 | 8x10 | 162 | 3 | 0.5 / 0.9 / 1.5 |
| red-herring / hard | 200 | 21:200 | 21:200 | 7x8 | 164 | 3 | 2.9 / 4.1 / 18.0 |
| red-herring / extreme | 200 | 24:200 | 24:200 | 8x9 | 167 | 3 | 3.3 / 4.5 / 15.3 |
| composed / hard | 200 | 24:200 | 24:200 | 8x9 | 173 | 6 | 4.6 / 6.1 / 17.6 |
| composed / extreme | 200 | 27:200 | 27:200 | 9x10 | 183 | 6 | 5.3 / 6.4 / 42.3 |
| cut-point / medium | 200 | 12:200 | 26:200 | 8x12 | 195 | 87 | 8.4 / 16.3 / 37.1 |
| chain / medium | 200 | 9:200 | 24:200 | 10x6 | 47 | 6 | 1.7 / 2.5 / 9.0 |
| SHIPPED MIX / easy | 200 | 10:31 11:168 12:1 | 14:90 17:110 | cols 7/8 | 195 | 100 | 8.4 / 17.7 / 53.1 |
| SHIPPED MIX / medium | 200 | 9:29 11:1 12:55 13:21 14:19 15:12 16:63 | 19:60 22:63 24:29 26:48 | cols 6/8/9/12 | 192 | 111 | 40.9 / 134.7 / 153.3 |
| SHIPPED MIX / hard | 200 | 17:5 18:10 19:6 20:63 21:48 22:40 24:28 | 21:26 22:40 24:81 26:53 | cols 8/9/10 | 195 | 68 | 306.5 / 1196.8 / 1480.7 |
| SHIPPED MIX / extreme | 200 | 20:23 21:1 22:1 23:1 24:48 25:74 26:3 27:49 | 24:39 25:63 26:23 27:49 28:26 | cols 9/10/11 | 190 | 41 | 132.3 / 1127.8 / 1231.6 |

### B. Non-par difficulty proxies

| archetype / tier | solutions median (min-max) | unique | plausible sets | dead sets | board rows that must break | tempting rack tiles dead/total | forced at move 0 | myopic depth | guesswork undos | ladder steps L0 / L1 / L2 / L3 | hardest technique (level:count) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pure-groups-to-runs / easy | 1 (1-1) | 100% | 23.0 | 83% | 100% | 0.0/0.0 | 0% | 0.0 (stalls 100%, 0% placed) | 31.2 | 0.6 / 3.4 / 0.0 / 0.0 | 1:200 |
| pure-groups-to-runs / medium | 2 (2-2) | 0% | 41.0 | 80% | 100% | 0.0/0.0 | 0% | 0.0 (stalls 100%, 0% placed) | 151.2 | 1.0 / 2.5 / 0.0 / 1.0 | 3:200 |
| pure-groups-to-runs / hard | 16 (16-16) | 0% | 65.0 | 82% | 100% | 0.0/0.0 | 0% | 0.0 (stalls 100%, 0% placed) | 906.8 | 2.0 / 2.0 / 0.0 / 4.0 | 3:200 |
| pure-groups-to-runs / extreme | 81 (81-81) | 0% | 90.0 | 78% | 100% | 0.0/0.0 | 0% | 0.0 (stalls 100%, 0% placed) | 4010.9 | 0.0 / 2.0 / 2.0 / 4.0 | 3:200 |
| pure-runs-to-groups / easy | 1 (1-17) | 71% | 31.0 | 69% | 71% | 0.0/0.0 | 0% | 0.0 (stalls 100%, 0% placed) | 63.5 | 1.3 / 1.4 / 1.6 / 0.6 | 2:141 3:59 |
| pure-runs-to-groups / medium | 1 (1-1) | 100% | 52.0 | 88% | 100% | 0.0/0.0 | 0% | 0.0 (stalls 100%, 0% placed) | 700.8 | 0.3 / 3.4 / 2.0 / 0.3 | 2:174 3:26 |
| pure-runs-to-groups / hard | 1 (1-1) | 100% | 72.0 | 90% | 100% | 0.0/0.0 | 0% | 0.0 (stalls 100%, 0% placed) | 3241.3 | 0.0 / 4.6 / 2.0 / 0.4 | 2:126 3:74 |
| pure-runs-to-groups / extreme | 1 (1-1) | 100% | 72.0 | 90% | 100% | 0.0/0.0 | 0% | 0.0 (stalls 100%, 0% placed) | 3122.3 | 0.0 / 4.7 / 2.0 / 0.3 | 2:139 3:61 |
| decoy / hard | 1 (1-1) | 100% | 53.0 | 87% | 100% | 1.0/1.0 | 0% | 0.0 (stalls 100%, 0% placed) | 527.6 | 3.0 / 2.0 / 2.0 / 0.0 | 2:200 |
| decoy / extreme | 1 (1-1) | 100% | 70.0 | 89% | 100% | 1.0/1.0 | 0% | 0.0 (stalls 100%, 0% placed) | 1726.7 | 3.0 / 2.0 / 3.0 / 0.0 | 2:200 |
| red-herring / hard | 1 (1-1) | 100% | 48.0 | 85% | 100% | 2.0/2.0 | 0% | 0.0 (stalls 100%, 0% placed) | 281.8 | 4.0 / 3.0 / 0.0 / 0.0 | 1:200 |
| red-herring / extreme | 1 (1-1) | 100% | 63.0 | 87% | 100% | 2.0/2.0 | 0% | 0.0 (stalls 100%, 0% placed) | 1039.7 | 5.0 / 3.0 / 0.0 / 0.0 | 1:200 |
| composed / hard | 1 (1-1) | 100% | 64.0 | 88% | 100% | 3.0/3.0 | 0% | 0.0 (stalls 100%, 0% placed) | 939.1 | 4.0 / 3.0 / 1.0 / 0.0 | 2:200 |
| composed / extreme | 1 (1-1) | 100% | 83.0 | 89% | 100% | 3.0/3.0 | 0% | 0.0 (stalls 100%, 0% placed) | 3432.1 | 4.0 / 3.0 / 2.0 / 0.0 | 2:200 |
| cut-point / medium | 1 (1-1) | 100% | 72.0 | 89% | 100% | 0.0/0.0 | 0% | 0.0 (stalls 100%, 0% placed) | 1373.6 | 0.9 / 7.1 / 0.0 / 0.0 | 1:200 |
| chain / medium | 1 (1-1) | 100% | 30.0 | 73% | 60% | 0.0/0.0 | 8% | 8.0 | 139.1 | 8.0 / 0.0 / 0.0 / 0.0 | 0:200 |
| SHIPPED MIX / easy | 1 (1-17) | 85% | 27.4 | 76% | 85% | 0.0/0.0 | 0% | 0.0 (stalls 100%, 0% placed) | 48.8 | 1.2 / 2.2 / 0.9 / 0.3 | 1:90 2:79 3:31 |
| SHIPPED MIX / medium | 1 (1-2) | 70% | 50.3 | 84% | 94% | 0.0/0.0 | 1% | 1.2 (stalls 86%, 14% placed) | 623.0 | 1.8 / 3.5 / 0.6 / 0.4 | 0:29 1:48 2:53 3:70 |
| SHIPPED MIX / hard | 1 (1-16) | 74% | 62.1 | 86% | 100% | 0.9/0.9 | 0% | 0.0 (stalls 100%, 0% placed) | 1396.4 | 2.2 / 3.0 / 1.1 / 1.1 | 1:26 2:104 3:70 |
| SHIPPED MIX / extreme | 1 (1-81) | 87% | 74.7 | 87% | 100% | 1.4/1.4 | 0% | 0.0 (stalls 100%, 0% placed) | 2488.1 | 2.9 / 2.7 / 1.9 / 0.6 | 1:39 2:127 3:34 |

### C. Shipped archetype mix

| tier | archetypes |
|---|---|
| easy | runs-to-groups 55%, groups-to-runs 45% |
| medium | runs-to-groups 32%, groups-to-runs 30%, cut-point 24%, chain 15% |
| hard | groups-to-runs 27%, runs-to-groups 27%, runs-to-groups-decoy 20%, runs-to-groups-composed 14%, runs-to-groups-redherring 13% |
| extreme | runs-to-groups-decoy 32%, runs-to-groups-composed 25%, runs-to-groups-redherring 20%, groups-to-runs 13%, runs-to-groups 12% |

Invariant (a)-(d) failures: 0
partitionCount vs solveBagM2 disagreements: 0

### Reading the baseline

- **Par and the technique ladder disagree about the order of archetypes.**
  Chain (par 9) is forced singles all the way (L0, 8 steps). Cut-point (par 12)
  and red herring (par 21 / 24) need only stranding (L1). Decoy and composed need
  chain reasoning (L2). Plain runs-to-groups needs L2 at every tier, and 13-37%
  of medium/hard builds need a step beyond it (L3).
- **Red herring is the weakest hard/extreme layer by technique** (L1 only), below
  plain runs-to-groups at easy (L2). What it has that the ladder cannot see is
  two tempting dead tiles on the board (proxy 5: 2.0/2.0).
- **Guesswork cost tracks tile count, not archetype.** Runs-to-groups hard (26
  tiles) scores 3241; decoy hard (22 tiles) scores 528.
- **groups-to-runs is the only archetype with many solutions**: exactly 2, 16
  and 81 at medium, hard and extreme. Its L3 steps are free choices. Whether
  some of those solutions beat par was not tested.
- **Variety.** "Distinct structural" counts boards up to a value shift and a
  colour relabelling. groups-to-runs is effectively never repeated (195-200 of
  200). Everything else is a handful of shapes: runs-to-groups hard 3, decoy 3,
  red herring 3, composed 6, chain 6. For the trap layers the only thing that
  varies is which of the three rows holds the trap colour.
- **Generation time.** Runs-to-groups hard and extreme took 1.1-1.3 s on
  average (p95 1.4-1.5 s), which put the shipped hard and extreme mixes at
  p95 1.2 s and 1.1 s. CLAUDE.md recorded about 0.5 s; this machine measures
  double that.
- **Medium is the least calibrated tier**: par 9 to 16 and hardest-technique
  levels 0, 1, 2 and 3 all appear.
- All 4,000 generated puzzles passed invariants (a)-(d), and the independent
  partition counter never disagreed with `solveBagM2`.

## 4. What was shipped on this branch

Three changes, all to runs-to-groups, made and verified one at a time.

### 4.1 `planValueGroupGoal` no longer searches L! value orders

Cost is `boardTiles + rack − fixed − cycles`. A tile is fixed only if it already
sits on its goal cell, and a cycle is a closed walk through occupied goal cells,
so a value assigned to a goal row with no board tile on it contributes nothing,
whichever empty row it gets. Only the ordered choice of values for the occupied
goal rows matters: `L!/(L−k)!` candidates for `k` occupied rows instead of `L!`.
Builder boards occupy 3 rows, so L=7 goes from 5040 orders to 210.

This is the same minimum, not an approximation. The exhaustive original is kept
as `planValueGroupGoalExhaustive` (no builder calls it) and
`src/lib/valueGroupPlanner.verify.ts` compares the two:

```
=== 1. builder boards: new planner == exhaustive planner ===
  L=3 rack=1: built 40, equal to exhaustive 40, equal to 3L+rack-6 40
  L=4 rack=2: built 40, equal to exhaustive 40, equal to 3L+rack-6 40
  L=5 rack=2: built 40, equal to exhaustive 40, equal to 3L+rack-6 40
  L=6 rack=4: built 30, equal to exhaustive 30, equal to 3L+rack-6 30
  L=7 rack=5: built 6, equal to exhaustive 6, equal to 3L+rack-6 6
=== 2. scrambled boards: new planner == exhaustive planner ===
  400 scrambled boards, 400 agree, 400 had fixed tiles or cycles in the optimum
  occupied rows per board: 1:9 2:68 3:93 4:76 5:68 6:44 7:32 8:10
  400 plans replayed through the reducer to a validateGrid win in exactly par
=== 3. builder plans replay through the reducer ===
  easy: 10 builds, 10 replay to a validateGrid win in par; par = 11
  medium: 10 builds, 10 replay to a validateGrid win in par; par = 16
  hard: 10 builds, 10 replay to a validateGrid win in par; par = 20
  extreme: 10 builds, 10 replay to a validateGrid win in par; par = 23
=== 5. timing (ms per buildRunsToGroupsAt, 10 builds each) ===
  L=5 rack=2: median 5.5  max 12.4  par 11
  L=6 rack=4: median 16.6  max 19.5  par 16
  L=7 rack=5: median 39.5  max 49.9  par 20
  L=8 rack=5: median 78.5  max 94.8  par 23
  for reference, the exhaustive planner on one L=7 board: 1117 ms
=== SELF-CHECKS: 27 passed, 0 failed ===
```

When every goal row is occupied the search is still L!, never worse than before.

### 4.2 Uniqueness gate on runs-to-groups

When three consecutive values carry no rack tile, those nine board tiles can stay
where they are as three short runs. That is a second solution that leaves most
of the board alone, so par overstates the puzzle and the transpose insight is
optional. It happened on 29% of easy builds (L=5, rack at offsets {0,1}, {3,4} or
{0,4}) and never at medium or above. `buildRunsToGroupsAt` now rejects any build
whose bag has more than one partition, using the measured count, not the pattern.

### 4.3 Extreme runs-to-groups is L=8 / par 23 (deliberate recalibration)

Extreme used the same parameters as hard (L=7, rack 5, par 20) only because L=8
cost about 5 s under the old planner. It now builds in about 0.1 s. Rack size 5
(par 23) was chosen over 6 (par 24) because six offsets out of eight allow only
one no-three-consecutive pattern, which would be a single board shape. The board
is 10 columns wide, inside the 12-column phone limit.

No other par moved: easy 11, medium 16, hard 20, decoy 22/25, red herring 21/24,
composed 24/27, cut-point 12, chain 9.

### 4.4 Before and after (same metrics, 200 puzzles per row)

| row | metric | before | after |
|---|---|---|---|
| runs-to-groups / easy | unique solution | 71% | 100% |
| | board rows that must break | 71% | 100% |
| | hardest technique | L2 141, L3 59 | L2 200 |
| | guesswork undos | 63.5 | 79.6 |
| | distinct structural shapes | 10 | 7 |
| | gen ms mean / p95 | 16.1 / 25.5 | 3.4 / 3.7 |
| runs-to-groups / medium | par, unique, shapes | 16, 100%, 6 | 16, 100%, 6 |
| | gen ms mean / p95 | 149.7 / 190.4 | 9.2 / 9.6 |
| runs-to-groups / hard | par, unique, shapes | 20, 100%, 3 | 20, 100%, 3 |
| | gen ms mean / p95 | 1272.3 / 1475.9 | 41.9 / 58.1 |
| runs-to-groups / extreme | par | 20 | 23 |
| | tiles, grid | 26, 9x9 | 29, 10x10 |
| | distinct structural shapes | 3 | 16 |
| | plausible sets | 72 | 91 |
| | ladder steps L0/L1/L2/L3 | 0.0 / 4.7 / 2.0 / 0.3 | 0.3 / 4.0 / 2.9 / 0.8 |
| | hardest technique | L2 139, L3 61 | L2 92, L3 108 |
| | guesswork undos | 3122 | 8971 |
| | gen ms mean / p95 | 1129.4 / 1366.1 | 84.0 / 106.0 |
| SHIPPED MIX / easy | unique solution | 85% | 100% |
| | gen ms p95 | 17.7 | 4.6 |
| SHIPPED MIX / medium | gen ms p95 | 134.7 | 10.0 |
| SHIPPED MIX / hard | gen ms mean / p95 / max | 306.5 / 1196.8 / 1480.7 | 15.3 / 54.3 / 78.8 |
| SHIPPED MIX / extreme | gen ms mean / p95 / max | 132.3 / 1127.8 / 1231.6 | 9.3 / 79.1 / 109.0 |
| | par range | 20-27 | 22-27 |

What this does and does not show. The extreme runs-to-groups board is larger and
its bag more often needs a step beyond chain reasoning (54% of builds, up from
about 30%). That is a structural measurement on 200 bags. It is not evidence that
a person finds it harder; the puzzle is still the same single insight (transpose
the block) on a bigger board. The uniqueness gate removes a shortcut; it does not
add difficulty to the puzzles that were already unique.

Full after-tables for the changed rows:

### A. Par, size, variety, generation time

| archetype / tier | n | par (value:count) | tiles | grid rows x cols | distinct exact | distinct structural | gen ms mean / p95 / max |
|---|---|---|---|---|---|---|---|
| pure-runs-to-groups / easy | 200 | 11:200 | 17:200 | 7x7 | 184 | 7 | 3.4 / 3.7 / 12.3 |
| pure-runs-to-groups / medium | 200 | 16:200 | 22:200 | 8x8 | 184 | 6 | 9.2 / 9.6 / 12.3 |
| pure-runs-to-groups / hard | 200 | 20:200 | 26:200 | 9x9 | 169 | 3 | 41.9 / 58.1 / 63.5 |
| pure-runs-to-groups / extreme | 200 | 23:200 | 29:200 | 10x10 | 189 | 16 | 84.0 / 106.0 / 113.4 |

### B. Non-par difficulty proxies

| archetype / tier | solutions median (min-max) | unique | plausible sets | dead sets | board rows that must break | tempting rack tiles dead/total | forced at move 0 | myopic depth | guesswork undos | ladder steps L0 / L1 / L2 / L3 | hardest technique (level:count) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pure-runs-to-groups / easy | 1 (1-1) | 100% | 31.0 | 84% | 100% | 0.0/0.0 | 0% | 0.0 (stalls 100%, 0% placed) | 79.6 | 1.3 / 1.4 / 2.3 / 0.0 | 2:200 |
| pure-runs-to-groups / medium | 1 (1-1) | 100% | 52.0 | 88% | 100% | 0.0/0.0 | 0% | 0.0 (stalls 100%, 0% placed) | 709.1 | 0.4 / 3.3 / 2.0 / 0.3 | 2:166 3:34 |
| pure-runs-to-groups / hard | 1 (1-1) | 100% | 72.0 | 90% | 100% | 0.0/0.0 | 0% | 0.0 (stalls 100%, 0% placed) | 3183.2 | 0.0 / 4.6 / 2.0 / 0.4 | 2:127 3:73 |
| pure-runs-to-groups / extreme | 1 (1-1) | 100% | 91.0 | 91% | 100% | 0.0/0.0 | 0% | 0.0 (stalls 100%, 0% placed) | 8971.1 | 0.3 / 4.0 / 2.9 / 0.8 | 2:92 3:108 |

Invariant (a)-(d) failures: 0
partitionCount vs solveBagM2 disagreements: 0

### A. Par, size, variety, generation time

| archetype / tier | n | par (value:count) | tiles | grid rows x cols | distinct exact | distinct structural | gen ms mean / p95 / max |
|---|---|---|---|---|---|---|---|
| SHIPPED MIX / easy | 200 | 10:38 11:159 12:3 | 14:99 17:101 | cols 7/8 | 199 | 106 | 2.0 / 4.6 / 9.9 |
| SHIPPED MIX / medium | 200 | 9:38 12:52 13:21 14:21 15:5 16:63 | 19:53 22:63 24:38 26:46 | cols 6/8/9/12 | 185 | 101 | 4.7 / 10.0 / 11.4 |
| SHIPPED MIX / hard | 200 | 17:3 18:6 19:10 20:78 21:40 22:34 24:29 | 21:24 22:34 24:84 26:58 | cols 8/9/10 | 196 | 70 | 15.3 / 54.3 / 78.8 |
| SHIPPED MIX / extreme | 200 | 22:2 23:18 24:53 25:72 26:1 27:54 | 24:45 25:60 27:54 28:26 29:15 | cols 9/10/11 | 186 | 46 | 9.3 / 79.1 / 109.0 |

### B. Non-par difficulty proxies

| archetype / tier | solutions median (min-max) | unique | plausible sets | dead sets | board rows that must break | tempting rack tiles dead/total | forced at move 0 | myopic depth | guesswork undos | ladder steps L0 / L1 / L2 / L3 | hardest technique (level:count) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SHIPPED MIX / easy | 1 (1-1) | 100% | 27.0 | 83% | 100% | 0.0/0.0 | 0% | 0.0 (stalls 100%, 0% placed) | 56.7 | 1.0 / 2.4 / 1.1 / 0.0 | 1:99 2:101 |
| SHIPPED MIX / medium | 1 (1-2) | 74% | 49.5 | 84% | 92% | 0.0/0.0 | 2% | 1.5 (stalls 81%, 19% placed) | 590.1 | 2.2 / 3.3 / 0.6 / 0.3 | 0:38 1:46 2:56 3:60 |
| SHIPPED MIX / hard | 1 (1-16) | 73% | 62.8 | 86% | 100% | 0.8/0.8 | 0% | 0.0 (stalls 100%, 0% placed) | 1410.1 | 2.1 / 3.0 / 1.1 / 1.2 | 1:24 2:104 3:72 |
| SHIPPED MIX / extreme | 1 (1-81) | 87% | 76.1 | 87% | 100% | 1.6/1.6 | 0% | 0.0 (stalls 100%, 0% placed) | 2940.9 | 3.1 / 2.6 / 1.9 / 0.6 | 1:45 2:115 3:40 |

### C. Shipped archetype mix

| tier | archetypes |
|---|---|
| easy | runs-to-groups 51%, groups-to-runs 50% |
| medium | runs-to-groups 32%, groups-to-runs 27%, cut-point 23%, chain 19% |
| hard | runs-to-groups 29%, groups-to-runs 28%, runs-to-groups-decoy 17%, runs-to-groups-composed 15%, runs-to-groups-redherring 12% |
| extreme | runs-to-groups-decoy 30%, runs-to-groups-composed 27%, runs-to-groups-redherring 23%, groups-to-runs 13%, runs-to-groups 8% |

Invariant (a)-(d) failures: 0
partitionCount vs solveBagM2 disagreements: 0

### 4.5 Sample boards after the change

```
--- pure-runs-to-groups / extreme (10 columns) ---
#1  par 23
     .  4k  5k  6k  7k  8k  9k 10k 11k   .
     .  4r  5r  6r  7r  8r  9r 10r 11r   .
     .  4b  5b  6b  7b  8b  9b 10b 11b   .
   rack: 7a 9a 10a 5a 4a
#2  par 23
     .  1r  2r  3r  4r  5r  6r  7r  8r   .
     .  1a  2a  3a  4a  5a  6a  7a  8a   .
     .  1k  2k  3k  4k  5k  6k  7k  8k   .
   rack: 7b 2b 1b 4b 5b
#3  par 23
     .  6r  7r  8r  9r 10r 11r 12r 13r   .
     .  6b  7b  8b  9b 10b 11b 12b 13b   .
     .  6a  7a  8a  9a 10a 11a 12a 13a   .
   rack: 8k 10k 13k 12k 7k
#4  par 23
     .  1k  2k  3k  4k  5k  6k  7k  8k   .
     .  1a  2a  3a  4a  5a  6a  7a  8a   .
     .  1r  2r  3r  4r  5r  6r  7r  8r   .
   rack: 3b 6b 8b 1b 5b
#5  par 23
     .  3k  4k  5k  6k  7k  8k  9k 10k   .
     .  3r  4r  5r  6r  7r  8r  9r 10r   .
     .  3b  4b  5b  6b  7b  8b  9b 10b   .
   rack: 5a 10a 8a 7a 3a

--- pure-runs-to-groups / easy (7 columns) ---
#1  par 11                               #2  par 11
     .  7r  8r  9r 10r 11r   .               .  9b 10b 11b 12b 13b   .
     .  7k  8k  9k 10k 11k   .               .  9a 10a 11a 12a 13a   .
     .  7a  8a  9a 10a 11a   .               .  9k 10k 11k 12k 13k   .
   rack: 9b 11b                            rack: 12r 10r
#3  par 11                               #4  par 11
     .  6b  7b  8b  9b 10b   .               .  1k  2k  3k  4k  5k   .
     .  6a  7a  8a  9a 10a   .               .  1b  2b  3b  4b  5b   .
     .  6r  7r  8r  9r 10r   .               .  1a  2a  3a  4a  5a   .
   rack: 7k 8k                             rack: 3r 4r
#5  par 11
     .  2a  3a  4a  5a  6a   .
     .  2k  3k  4k  5k  6k   .
     .  2b  3b  4b  5b  6b   .
   rack: 4r 2r
```

In every easy sample no three consecutive values are free of a rack tile, which
is what the gate enforces.

## 5. Open findings, ranked by expected gain against risk

Each is a lead with the measurement behind it, not a conclusion.

1. **Trap-layer variety — DONE on `trap-variety`, see §7.** Mirror, filler sets
   and colour assignment shipped; staggered rows deliberately not used. What
   remains: red herring hard and composed hard stop at 18 shapes (§7.2).
   Original write-up follows.
   *(gain: high for variety, risk: low to medium.)*
   Decoy, red herring and composed each produce 3-6 structural shapes. Three
   cheap sources of variety, in order of safety:
   - *Mirror the decoy.* The rules are symmetric under value reflection, so a
     decoy at `s−1` with a low short run is as sound as the shipped one at `s+L`.
     Par may differ by a move or two because the layout is not mirrored, so the
     harness pins would need a second value; measure first.
   - *Randomise decoy fillers.* `decoyFillerOffsets` returns the first valid set;
     enumerate all of them and pick one. Rack size, and so par, will vary.
   - *Stagger or reorder board rows.* All trap boards are three left-aligned
     rows. Offsetting rows changes `fixed`, so par moves and needs re-pinning.
   Verify with `decoy.verify.ts` / `composed.verify.ts` and this audit's
   "distinct structural" column.

2. **A layer that needs two kinds of reasoning (gain: highest for difficulty,
   risk: high, design session).** No hard/extreme archetype goes beyond L2 on a
   unique bag except by size. Chain is the only archetype where myopic deduction
   runs at all, and it is L0 throughout. A chain ladder whose last rung is a decoy
   trap (singles get you most of the way, then a tempting dead extension has to
   be rejected by chain reasoning) would be the first puzzle with a forced
   sequence *and* a trap. Needs its own probe for uniqueness, as chain did.
   Target on this audit: ladder shows both L0 steps ≥4 and L2 steps ≥1, with
   tempting-dead ≥1.

3. **Red herring is technique-light — extreme DONE, hard MITIGATED, see §7.3.**
   Extreme now ships only L2 variants; hard cannot be lifted above L1 at its
   sizes, so its band went from 0.14 to 0.08. What remains: an L2 red herring
   small enough for hard. Original write-up follows.
   *(gain: medium, risk: low to try.)* L1 only
   (stranding), 4-5 singles, on 21-24 tiles. It ships at 14% of hard and 22% of
   extreme. Either lower its extreme band in favour of composed (L2, three
   tempting tiles), or look for a variant with fillers that pushes it to L2.
   The band change is one line in `generator.ts` but is a feel decision, so it
   was left for playtesting.

4. **groups-to-runs has many solutions (gain: medium, risk: medium).** 2 / 16 /
   81 at medium / hard / extreme, against 1 for every other archetype. The rack's
   boundary tiles force some colours into runs, but colours without a boundary
   tile can stay as groups. Not tested: whether any of those solutions costs
   fewer moves than par (if so par overstates it, as it did for easy
   runs-to-groups). A partition-count gate plus a rack that puts a boundary tile
   on more colours is the obvious experiment; it will change the par spread.

5. **Medium calibration (gain: medium, risk: low, feel decision).** Medium ships
   chain (L0, par 9), cut-point (L1, par 12), groups-to-runs (2 solutions, par
   11-15) and runs-to-groups (L2/L3, par 16). By technique, chain reads as the
   gentlest thing in the tier and may belong at easy as well; by guesswork cost
   cut-point (1374) is above every other medium archetype and could carry a
   share of hard. Both are band edits plus a `ParamsFor` entry; neither was
   made because par 9-12 puzzles in a par-20 tier is a judgement about what
   the par display should mean.

6. **Cut-point beyond medium (gain: low, risk: low).** L=13 would give par 16
   but needs 15 columns. At the 50% board scale that is roughly 400 px against
   about 350 px usable, so it pans even at the smallest preset. Par 16 is also
   still under hard's 20. The scale/pan work removed the hard block, but the
   result is a wide medium puzzle, not a hard one.

7. **Duplicates in the trap layers (gain: unknown, risk: medium).** Decoy, red
   herring and composed are m=1-shaped. A second copy of the decoy tile's
   neighbours would let the tempting run and the true short run coexist, which
   may remove the trap rather than deepen it. Probe with `solveBagM2` before
   building anything.

8. **Coupled blocks (gain: unknown, risk: high).** Still blocked on the
   contested-resource redesign in `COUPLED_DESIGN.md`. Nothing here changes that.

9. **Board layout legibility — staggering RULED OUT by Ian** (he had a staggered
   layout removed and prefers aligned rows). The observation stands; any fix has
   to keep every row starting at the same column.
   *(gain: unknown, unmeasured.)* Runs-to-groups
   boards are three aligned rows, so each column already reads top to bottom as
   the group it will become. No proxy here sees layout. Worth a playtest
   question before any work.

## 6. Limits of this audit

- Proxies 1-4 and 6 ignore the grid. Only proxy 5 and par see layout.
- 200 puzzles per row; for the deterministic archetypes that is 200 samples of
  3-16 shapes, so their rows have almost no variance to estimate.
- Timings are one Windows laptop, single runs, with tsx; relative changes are
  large enough (20-30x) not to depend on that, absolute values will differ.
- Nothing here was played by a person.

## 7. Trap variety session (branch `trap-variety`, 2026-11-11)

Not merged, not deployed. Addresses §5 items 1 and 3; item 9 (staggered rows) was
ruled out by Ian, so every row still starts at column 1 with a one-cell margin.
Evidence: `npx tsx src/lib/trapVariants.verify.ts` (118 checks) and
`npx tsx src/lib/generatorAudit.ts 200 "decoy / ,red-herring / ,composed / ,chain / ,SHIPPED MIX / hard,SHIPPED MIX / extreme"`.

### 7.1 Before and after (200 puzzles per row)

| row | distinct shapes | par | hardest technique | builder rejections | gen p95 |
|---|---|---|---|---|---|
| decoy / hard | 3 → **30** | 22 → 19-23 | L2 200 → L2 200 | 0% → 0% | 1.4 → 1.6 ms |
| decoy / extreme | 3 → **46** (48 exist) | 25 → 22-27 | L2 200 → L2 200 | 0% → 0% | 0.4 → 2.1 ms |
| red-herring / hard | 3 → **18** | 21 → 20-24 | L1 200 → L1 200 | 0% → 0% | 7.0 → 2.8 ms |
| red-herring / extreme | 3 → **35** (36 exist) | 24 → 27-32 | L1 200 → **L2 200** | 0% → 0% | 10.2 → 20.0 ms |
| composed / hard | 6 → **18** | 24 → 24 | L2 200 → L2 200 | 0% → 0% | 16.1 → 3.6 ms |
| composed / extreme | 6 → **36** | 27 → 27 or 31 | L2 200 → L2 200 | 0% → 0% | 18.5 → 10.4 ms |
| chain / medium | 6 → **192** | 9 → 9 | L0 200 → L0 200 | 0% → 0% | 3.0 → 1.4 ms |
| SHIPPED MIX / hard | 70 → 109 | 17-24 → 17-24 | L1 29, L2 98, L3 73 → L1 16, L2 101, L3 83 | 0% → 0% | 44.2 → 22.5 ms |
| SHIPPED MIX / extreme | 46 → 119 | 22-27 → 21-32 | L1 54, L2 114, L3 32 → **L1 0**, L2 169, L3 31 | 0% → 0% | 80.2 → 41.7 ms |

Technique-ladder step counts (L0 / L1 / L2 / L3), before → after: red herring
extreme 5.0 / 3.0 / 0 / 0 → 3.0 / 4.8 / 2.0 / 0; decoy hard 3.0 / 2.0 / 2.0 / 0 →
2.2 / 3.0 / 1.8 / 0; composed extreme 4.0 / 3.0 / 2.0 / 0 → 4.0 / 3.5 / 2.0 / 0.
All 1,800 audited puzzles passed invariants (a)-(d).

What these columns do and do not say. "Distinct shapes" counts boards up to a
value shift and a colour relabelling, so it measures how often a returning player
meets a board they have not seen, not how different the boards feel. The
technique level is a property of the bag: it says extreme red herring can no
longer be finished with stranding alone, not that a person finds it harder. Par
rose on extreme red herring because the boards are bigger (28-32 tiles against
24), which is a size change as much as a reasoning one.

### 7.2 What varies now, and what the probe ruled out

Each layer has one core that takes a variant; the original puzzle is the default
variant, so the old harnesses and their pinned pars still run the same code.
Every build runs named proof steps against the real solver and is rejected at the
first that fails: invariants (a)-(d), each tempting tile visibly extends a run,
every tempting commitment and every combination of them leaves an unsolvable
remainder, exactly one partition, and the goal is reached with a par witness.

| layer | degrees of freedom | shapes | walls found by the probe |
|---|---|---|---|
| decoy | mirror (decoy below the block) × filler set × trap row | hard 2×5×3 = 30, extreme 2×8×3 = 48 | L=6 fillers {0} leaks (leftover 1,2,3 stays a run). L=7 {1} and {3}: trap dead but 10 and 5 solutions. |
| red herring | split (the two extenders on different colours) × size × filler set × rows | hard (3+6)×2 = 18, extreme (3+6)×4 = 36 | L≤6 admits no filler: any middle tile of the fourth colour makes three in a row with the supports. L≥7 with no filler leaks (7 and 14 solutions). L=7 admits only {3}; L=8 admits {3}, {4}, {3,4}. |
| composed | mirror × which colour carries the opposite-end extender (herring colour, or the third colour) × size × rows | hard 2×(6+3) = 18, extreme 2×(6+3)×2 = 36 | L=6 and L=7 are unique only with no filler (L=7 {3}: 2 solutions). L=8 is unique only with filler {3} (none: 5-7 solutions and a leak; {4}: 2). |
| chain | mirror (descending ladder) × order of the five board rows | 2×120 = 240 possible, 192 seen in 200 | none |

**Ceilings below the target of 25.** Red herring hard and composed hard stop at
18. Both are structural at the sizes hard uses: with no filler possible, the only
freedom is which rows carry the tempting tiles (9 arrangements), times two sizes
for red herring and times the mirror for composed. Reaching 25 at hard means
admitting the next size up (red herring L=7, par 27-28; composed L=7, par 27),
which is a one-line change to `HERRING_SHIPPED.hard` / `COMPOSED_SHIPPED.hard`.
It was not made because those are larger than anything else in the tier.

**Chain: be clear about what 192 means.** Only the mirror changes the tiles; the
ladder's structure is fixed by the 13-value range (links=4 is the only depth that
fits), so there are 2 genuinely different chains. The other 190 are the same two
chains with the board rows in a different order, which hides where the ladder
starts but does not change the deduction.

### 7.3 Red herring: strengthened at extreme, band cut at hard

The request was for a wrong commitment whose failure only shows after a further
forced step, so that the layer needs more than L1.

- **Extreme: done.** Extreme now ships only L=7 and L=8 with a middle filler. The
  filler forces a group in the middle, which is the extra step: "extend both
  ends" no longer strands anything at once, it fails only after that group is
  placed. Technique level L2 on 200 of 200 (was L1 on 200 of 200). Refutation
  depth of the tempting commitments (`refutationDepth`, 1 = a tile is stranded at
  once, 2 = only after following forced singles): one colour, low 1 / high 1 /
  both 2; split, low 2 / high 2 / both 1. So in the split variants each single
  wrong extension fails only after a forced step, and in the one-colour variants
  the extend-both commitment does.
- **Hard: not possible soundly, so the band was cut from 0.14 to 0.08.** At L=5
  and L=6 there is no filler to add, and the layer stays L1 whatever the colour
  arrangement. Split variants were still added at hard, since their single wrong
  extensions have depth 2 where the original's have depth 1. The freed 0.06 goes
  to the base archetypes.
- This is a deliberate par recalibration: **extreme red herring par is 27-32**
  (was 24). Hard is 20-24 (was 21): L=5 at 20-21 and L=6 at 23-24.

### 7.4 Par for the new variants

Par comes from `bindMinCostGoal` on each variant's deterministic goal, and the
witness is replayed through a transcription of the DROP reducer in the harness
(6 builds per variant, 300 replays, all landing on a `validateGrid` win in exactly
par). The originals are unchanged: decoy 22/25, red herring 21 (L=5) and 24 (L=6),
composed 24/27, chain 9. New values, all pinned in `trapVariants.verify.ts`:

| variant | par |
|---|---|
| decoy hard, extra filler | 23 |
| decoy hard, mirrored | 19-22 |
| decoy extreme, alternative fillers | 26-27 |
| decoy extreme, mirrored | 22-26 |
| red herring split, L=5 / L=6 | 20-21 / 23-24 |
| red herring L=7 {3} | 27-28 |
| red herring L=8 | 30-32 |
| composed mirrored or third-colour, L=6 / L=7 | 24 / 27 |
| composed L=8 {3} (all four kinds) | 31 |
| chain mirrored, any row order | 9 |

Where a range is shown, par depends on which board row carries the trap colour:
the goal layout is fixed, so a different row leaves a different number of tiles
already in place. Mirrored decoys come out 1-3 moves under the original for that
reason. As everywhere in this engine, par is exact for the goal the builder aims
at and an upper bound over all layouts.

### 7.5 The proof can fail

Four deliberately broken variants, each rejected at the step named:

```
decoy L=6 fillers [0]  (leftover 1,2,3 is a run: the trap leaks)
    ok   (a) board valid at move zero
    ok   (c) rack is not a set on its own
    ok   (b) bag solvable under solveBagM2
    ok   (d) no no-relocation win (exhaustive)
    ok   OBVIOUS the decoy visibly extends a board run
    FAIL TRAP extending the run is a dead end
decoy L=7 fillers [1]  (trap is dead, but 10 solutions)
    ok   ... through TRAP extending the run is a dead end
    FAIL UNIQUE exactly one partition
red herring L=7, no filler  (extend-both leaves middle runs)
    ok   ... through TRAP the high extension is a dead end
    FAIL TRAP every combination of extensions is a dead end
composed L=7 fillers [3]  (2 solutions)
    ok   ... through TRAP every combination of extensions is a dead end
    FAIL UNIQUE exactly one partition
```

The uniqueness step is new for all three layers. It also caught something
pre-existing: `buildComposedAt(8)` with no filler, which `composed.verify.ts`
used to assert as buildable, has 5 solutions. It was never shipped; the harness
now builds L=8 with filler {3} and records the rejection.

### 7.6 Sample boards

```
decoy, mirrored, hard (9 columns)            decoy, alternative fillers, extreme (10 columns)
#1 par 21                                    #1 par 26
   .  4b  5b  6b  7b  8b  9b                    .  3a  4a  5a  6a  7a  8a  9a
   .  4a  5a  6a  7a  8a  9a                    .  3b  4b  5b  6b  7b  8b  9b
   .  4r  5r  6r  7r  8r  9r                    .  3r  4r  5r  6r  7r  8r  9r
   rack: 3r 4k 5k 7k                            rack: 5k 6k 8k 9k 10b
#2 par 22                                    #2 par 27
   .  2b  3b  4b  5b  6b  7b                    .  4a  5a  6a  7a  8a  9a 10a
   .  2a  3a  4a  5a  6a  7a                    .  4b  5b  6b  7b  8b  9b 10b
   .  2r  3r  4r  5r  6r  7r                    .  4r  5r  6r  7r  8r  9r 10r
   rack: 1a 2k 3k 6k 7k                         rack: 4k 6k 7k 9k 10k 11r

red herring, split, hard (8-9 columns)       red herring with filler, extreme (10-11 columns)
#1 par 23                                    #1 par 27
   .  2k  3k  4k  5k  6k  7k                    .  2k  3k  4k  5k  6k  7k  8k
   .  2b  3b  4b  5b  6b  7b                    .  2a  3a  4a  5a  6a  7a  8a
   .  2r  3r  4r  5r  6r  7r                    .  2b  3b  4b  5b  6b  7b  8b
   rack: 1k 2a 3a 6a 7a 8r                      rack: 1a 2r 3r 5r 7r 8r 9b
#2 par 21                                    #2 par 31
   .  4a  5a  6a  7a  8a                        .  4a  5a  6a  7a  8a  9a 10a 11a
   .  4k  5k  6k  7k  8k                        .  4b  5b  6b  7b  8b  9b 10b 11b
   .  4r  5r  6r  7r  8r                        .  4k  5k  6k  7k  8k  9k 10k 11k
   rack: 3a 4b 5b 7b 8b 9k                      rack: 3k 4r 5r 7r 10r 11r 12k

composed, mirrored, hard (9 columns)         composed, third-colour extender, extreme (10-11 columns)
#1 par 24                                    #1 par 27
   .  7r  8r  9r 10r 11r 12r                    .  3b  4b  5b  6b  7b  8b  9b
   .  7b  8b  9b 10b 11b 12b                    .  3r  4r  5r  6r  7r  8r  9r
   .  7a  8a  9a 10a 11a 12a                    .  3k  4k  5k  6k  7k  8k  9k
   rack: 6r 6b 9k 11k 12k 13r                   rack: 2k 2b 5a 8a 9a 10r
#2 par 24                                    #2 par 31
   .  2a  3a  4a  5a  6a  7a                    .  5b  6b  7b  8b  9b 10b 11b 12b
   .  2k  3k  4k  5k  6k  7k                    .  5r  6r  7r  8r  9r 10r 11r 12r
   .  2b  3b  4b  5b  6b  7b                    .  5k  6k  7k  8k  9k 10k 11k 12k
   rack: 1k 1b 4r 6r 7r 8b                      rack: 4k 5a 6a 8a 10a 13b 13r

chain, mirrored, rows shuffled, medium (6 columns)
#1 par 9                                     #2 par 9
   .  2r  2b  2a                                .  7b  8b  9b 10b
   .  2k  3k  4k  5k                            .  1b  1a  1k
   .  8b  9b 10b 11b                            .  1r  2r  3r  4r
   . 11a 12a 13a                                .  4k  5k  6k  7k
   .  5r  6r  7r  8r                            . 10a 11a 12a
   rack: 5b 5a 8a 8k 11r 11k                    rack: 4b 4a 7r 7a 10r 10k
```

The harness prints five of each. The widest new board is 11 columns (red herring
and composed at L=8), inside the 12-column phone limit.

### 7.7 Playing a variant by name

`?forceArchetype=` now also accepts `decoy-classic`, `decoy-mirror`,
`red-herring-classic`, `red-herring-split`, `composed-classic`,
`composed-mirror`, `composed-third`, `chain-classic` and `chain-mirror`. The
plain layer names (`decoy`, `red-herring`, `composed`, `chain`) draw any shipped
variant. Nothing player-facing names a variant.

### 7.8 Other changes in this session

- `valueGroupPlanner.verify.ts` compared only 6 boards at L=7 and none at L=8.
  It now compares 30 of each against the exhaustive planner: 60 boards, 0
  mismatches (600 boards in total across the harness).
- A retrying harness cannot see a builder that starts rejecting most draws, so
  each one now prints its rejection rate on its own line (`verifyEngine`,
  `pairingMin`, `valueGroupPlanner`, `trapVariants`), and the audit has a
  "builder rejections" column fed by `generationStats` in `generator.ts`.
- `refutationDepth` was added to `difficultyProxy.ts`.

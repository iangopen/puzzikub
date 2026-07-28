# Puzzikub — m=2 migration & archetype session log

*Moved out of `CLAUDE.md` so it stops loading into every session. Nothing is
changed or lost: this is the verbatim per-step record with all measured
numbers, timings and rationale. The AUTHORITATIVE current model lives in
`CLAUDE.md` under "m=2 ARCHITECTURE — CURRENT TRUTH" — where this log
disagrees with that section, THAT SECTION WINS.*

---

## Part 1 — the m=2 migration, step by step (Steps 1-12 + build unblock)

**m=2 MIGRATION — Step 1 DONE (types.ts only).** `Tile` now carries a
stable `id: string` in addition to `n`/`c`; `{n,c}` alone can't tell the
two m=2 copies of a (value,colour) pair apart. Two new exports in
`types.ts`: `TILE_COPIES = 2` (the copy count, named in one place, not
scattered as literal 2s) and `makeTile(n, c, copy = 0)` which mints tiles.

**ID-SCHEME DECISION (recorded per MIGRATION_M2.md Step 1): STRUCTURED,
not opaque.** The id is `` `${n}_${c}_${copy}` `` (e.g. `5_r_0`), chosen
over a uuid/global-counter because it (1) stays readable in verify-harness
output and (2) is a PURE function of `(n, c, copy)`, so it survives a JSON
round-trip with no remap table and lets Step 8's legacy-save migration
re-mint ids deterministically from `(n, c, occurrenceIndex)`.
**Signature note / deviation justified:** the doc wrote `makeTile(n, c)`,
but a pure structured id genuinely needs the copy index as input —
otherwise disambiguating the second copy requires hidden global state,
which is opaque-by-another-name and breaks per-puzzle scoping and the
round-trip purity the scheme exists for. So `copy` is an explicit third
argument defaulting to `0`, leaving `makeTile(n, c)` callable exactly as
the doc writes it (m=1-shaped construction only ever needs copy 0).

Step 1 is intentionally types-only: the rest of the codebase does NOT
compile until later steps swap `{n,c}` literals for `makeTile`. `tsc -p
tsconfig.app.json` reports 131 errors, ALL of them missing-`id`
construction sites (TS2741/TS2345/TS2322), zero logic errors — that error
list IS the Step 1 deliverable (it enumerates every call site later steps
must touch). Note `npx tsc --noEmit` alone is a no-op here: root
`tsconfig.json` has `files: []` + project references, so the real
typecheck is `tsc -b` / `tsc -p tsconfig.app.json`.

**m=2 MIGRATION — Step 2 DONE (solver.ts: `solveBagM2` added alongside
`solveBag`).** `solveBag` is UNTOUCHED; existing archetypes keep calling it
until Step 7. `solveBagM2` is the m=2 partition oracle: per-colour state is
an unordered pair of saturating run lengths (10 states/colour), at each
value 0-2 groups are chosen then the remaining copies extend runs; rejects
>`TILE_COPIES` copies up front; `assignment` is keyed by **`tile.id`** (the
old `${n}_${c}` key would collide on the two copies of a duplicate).

*Verification (real executed output, temp probe since deleted):*
- Hand-traced: two simultaneous same-colour runs ✓; only-one-of-two-copies-
  can-extend (red 1-8 + dup2 → unsolvable) ✓; owner red 1-8 + dup3 + dup6 →
  **solvable** ✓; two groups at one value ✓.
- 28-pair cut-point sweep reproduces exactly the §0.3 pairs `(2,3)(3,4)(3,5)
  (3,6)(4,5)(4,6)(5,6)(6,7)`, 0 oracle mismatches.
- Differential fuzz vs an independent brute-force oracle: **11,500 instances
  (7,478 duplicate-bearing), 0 mismatches.**
- `assignment`: on 333 solvable bags, every tile id present (both copies of
  duplicates) and re-partitioning by label passes isValidRun/isValidGroup.
- Timing: **0.0097 ms/call on the full 104-tile m=2 universe, 0.0043 ms on a
  typical bag** — in the prototype's 0.002-0.004 ms range. NOTE: the first
  implementation ran ~40x slower (0.15 ms); the cause was re-enumerating the
  bag-independent group multisets per call. Fix: precompute them once in a
  module-level 81-entry table (`M2_CHOICES_BY_COUNT`), plus integer-encoded
  state (pair-index per colour, numeric memo keys) so the DP allocates
  nothing per node.

*tsc after Step 2: still 131 errors, UNCHANGED.* The 2 pre-existing solver.ts
errors are inside `solveBag`'s `reconstructAssignment` (`tileKey({n,c})`,
lines 124/127) — Step 2 must NOT modify `solveBag`, so they correctly remain
(they clear in a later step / Step 7 retirement). `solveBagM2` itself added
zero new errors. (The Step 2 brief anticipated a drop of 2 here; that was a
misread — those 2 errors are `solveBag`'s, not something Step 2 resolves.)

**m=2 MIGRATION — Step 3 DONE (validator.ts: confirmation only, ZERO code
changes, per the plan).** The audit claim held: `isValidRun` sorts and
requires strict consecutiveness, so a duplicated value breaks the chain
naturally; `isValidGroup` compares distinct-colour count to array length, so
a duplicated colour breaks that naturally. Neither function references
`tile.id`, and none needed to.

*Verification (real executed output, `src/lib/verifyEngine.ts`, permanent —
added to the existing `=== m=2 STEP 3: VALIDATOR DUPLICATE-AWARENESS
(confirmation only) ===` section rather than a new file):*
```
  PASS  isValidRun rejects a duplicate value ([3r#0,3r#1,4r#0])
  PASS  isValidGroup rejects a duplicate colour ([5r#0,5r#1,5b#0])
  PASS  isValidGroup rejects a duplicate colour even at 4 tiles ([7r#0,7r#1,7b#0,7a#0])
  PASS  validateGrid accepts duplicate (value,colour) tiles split across two valid runs
  PASS  validateGrid still rejects an incomplete run even when it duplicates board values
  PASS  getInvalidCells flags only the incomplete duplicate-bearing row
  PASS  getInvalidCells leaves the complete duplicate-bearing row (row 0) unflagged
  PASS  getNewlyValidCells reports exactly the row that became valid, duplicate values notwithstanding
```
The real case (not just the rejection cases) is `validateGrid` on a 2-row
board where row 0 = `3r#0,4r#0,5r#0` and row 1 = `3r#1,4r#1,5r#1` — same
three (value,colour) pairs duplicated across two independently valid runs
— `=== true`. Full suite: `=== SELF-TESTS: 52 passed, 0 failed ===` (was 44
before these 8 were added; nothing else changed or regressed).

*tsc after Step 3: still 131 errors, UNCHANGED* — expected, since
`validator.ts` was not touched at all.

**m=2 MIGRATION — Step 4 DONE (`mixedGoalPlanner.ts`: id-keyed goals + concrete
resolver).** The planner now speaks tile ids, not `(value,colour)` labels, so the
two m=2 copies of a duplicate are placed and moved independently.

*What changed (only `mixedGoalPlanner.ts` + its verify harness — no other file):*
- `tileKey` is now `t => t.id` (was `${n}_${c}`). A new INTERNAL `labelKey =
  ${n}_${c}` keys the `(value,colour)` MULTISET in feasibility only — the two
  concepts genuinely split under m=2 (a window spec "red 4" is a label demand; a
  goal cell needs a specific copy id).
- `windowsPartitionBag`: presence check → **COUNT check**. Rejects a
  `(value,colour)` only when it appears **> `TILE_COPIES`** in the bag (not merely
  > once). Demand/supply are matched as label multisets; two windows may now both
  claim a label (legal when the bag holds two copies). Its internal solvability
  sanity check moved from `solveBag` → **`solveBagM2`** — required so a genuine
  duplicate bag (which m=1 `solveBag` rejects outright) can pass; on duplicate-free
  bags the two agree (Step 10 probe: 5,400 bags, 0 mismatches), so m=1 verdicts are
  unchanged. (This is a consequence of the count-check change, NOT the Step 7
  builder-call-site swap — no archetype call site was touched.)
- `windowTiles(w)` no longer keys goals: it mints copy-0 SPEC tiles for validation
  and length only. Goal binding goes through the new resolver `bindWindowTiles`.

*RESOLVER DESIGN DECISION — built BOTH (a) and (b), (b) as the default:* the doc's
"subtle part" (a window spec "red 4" can match two real tiles; never silently pick
"whichever is first"). `bindWindowTiles(windows, bag, pinned?)` binds each window
slot to a CONCRETE bag tile id, never mints one. When a `(value,colour)` has two
demanded copies (it lands in a run window AND a group window — a single window never
repeats a label), the choice is resolved by a **deliberate, documented rule: consume
copies in ASCENDING id order** (the pool bucket is explicitly sorted by id, so the
choice depends ONLY on ids — proven independent of bag/scan order by a test that
binds the natural, 3a-reversed, and fully-shuffled bag to byte-identical results).
Its safety claim is scoped precisely: it always yields a VALID injective binding
(every copy → exactly one slot, no collision) whose move cost `mixedLayoutMoves`
computes exactly (== move-BFS for that binding). It does **NOT** claim the MIN-cost
pairing when a duplicate copy is already on the board — a test exhibits an instance
where the ascending default costs 1 but the reverse pairing costs 0, and BFS confirms
each. Choosing the cheapest pairing is **Step 6's** minimisation, which drives this
resolver via the `pinned` override (design (a): pin explicit ids per label) to
enumerate the 2^d candidate pairings. Step 4 deliberately stops at "correct per
binding", which is exactly the Step 10 note's requirement.

*Verification (real executed output; `npx tsx src/lib/mixedGoalPlanner.verify.ts`):*
- **Regression (requirement 1):** the 16 original m=1 checks (sections 1-5) pass
  UNCHANGED — DECOY hybrid par=19, the 2/3-cycle + path BFS crafts, the 800-instance
  random sweep (493 BFS-checked, 0 witness/BFS mismatches), same as before. The only
  edits to those sections were mechanical: bare `{n,c}` → `makeTile(n,c)` and
  hardcoded goal keys `"7_r"` → `k(7,'r')` (= `7_r_0`), forced by `tileKey → id`.
- **New m=2 duplicate cases (requirement 2), all BFS-cross-checked:** 21 new checks
  (total **37 passed / 0 failed**). The canonical case — value-3 colour-a in both a
  run `{1,2,3}a` and a group `{3:a,b,k}` (bag holds 3a#0 AND 3a#1) — verified for
  BOTH the default binding (P0, analytic=witness=BFS=1) and the pinned reverse (P1,
  =0), proving the pairing matters and each binding's cost is exact. Plus resolver
  determinism (natural==reversed==shuffled binding), the count check
  (2-copy bag feasible; 3-copy rejected citing `TILE_COPIES`), and a **369-instance
  random m=2 sweep, all 369 BFS-checked, 0 witness and 0 BFS mismatches**, every one
  with both duplicate copies on the board.

*tsc delta (requirement 3): 131 → **102** (−29), verified by reading the diff.* The
29 resolved errors are EXACTLY the fabricated-`{n,c}`-literal construction sites in
the two files I touched (`mixedGoalPlanner.ts` 2 + `mixedGoalPlanner.verify.ts` 27),
now minting ids via `makeTile`. Zero new errors; `archetypes.ts` stayed at 25 (my
added `bindWindowTiles` export and unchanged `windowTiles`/`mixedLayoutMoves`
signatures did not affect it). Remaining 102: verifyEngine 53, archetypes 25, storage
21, solver 2, TilePicker 1 — all later-step construction sites.

**m=2 MIGRATION — Step 5 DONE (`archetypes.ts` id-keyed plumbing). ZERO behavioural
change: every harness green, every par number EXACT.** The Step 4/5 boundary noted
below is CLOSED — the three trap harnesses are green again.

*What changed (mechanical only — this relabels which string identifies a tile, never
what gets built):*
- `tileKey` is now `t => t.id` (was `${n}_${c}`), matching `mixedGoalPlanner`'s
  `tileKey` — the one every hybrid goal map is read through. `GoalPlan.goal` and
  every `goal.set(...)` are keyed by id.
- All **17** `{ n, c }` literals in `archetypes.ts` → `makeTile(n, c)`.
- **The actual Step 4/5 fix:** the three hybrid-goal sites (`buildDecoyAt`,
  `buildRedHerringAt`, `buildComposedAt`) now bind window specs to the **CONCRETE
  grid+rack tiles via `bindWindowTiles`** instead of minting fresh copy-0 spec
  tiles. Under m=1 a minted id and the real id coincide, so this is behaviour-
  neutral today; it is required by MIGRATION_M2.md §0.5's note and makes "exactly
  one tile per (value,colour), so the binding is unambiguous" an *asserted* fact
  (`bindWindowTiles` returns null if a slot has no concrete tile) rather than a
  hope. `buildComposedAt`'s `span` likewise selects from `allTiles` now.
- One judgement call recorded: `planValueGroupGoal`'s internal `rank` map is keyed
  by minted copy-0 ids. Safe *because that planner already rejects any value
  carrying a colour twice*, so it never sees a duplicate — commented in place.
- Harness edits forced by the same swap, **no assertion loosened**: `verifyEngine.ts`
  53 tile literals → `makeTile` + `plan.goal` lookups by `t.id`; the three trap
  harnesses' goal lookups by `t.id`. `verifyEngine`'s `allTiles` collision check
  stays a **LABEL** key deliberately — it asserts the builders still emit m=1-shaped
  puzzles, which IS Step 5's contract (Step 11 is what relaxes it).

*Verification (real executed output):*
```
verifyEngine.ts             === SELF-TESTS: 52 passed, 0 failed ===
                            === INVARIANTS (a)-(d): ALL PASSED on every generated puzzle ===
                            (a)-(e) 25/25 per archetype per difficulty, 0 duplicates
decoy.verify.ts             === SELF-CHECKS: 23 passed, 0 failed ===
redherring.verify.ts        === SELF-CHECKS: 25 passed, 0 failed ===
composed.verify.ts          === SELF-CHECKS: 32 passed, 0 failed ===
mixedGoalPlanner.verify.ts  === SELF-CHECKS: 37 passed, 0 failed ===
```
**Par: EXACT on all seven recorded numbers — 20 fresh builds each, zero spread**
(observed value set printed per row, not narrated):
```
EXACT  easy       (runs-to-groups)  expected 11  observed [11]
EXACT  medium     (runs-to-groups)  expected 16  observed [16]
EXACT  hard       (runs-to-groups)  expected 20  observed [20]
EXACT  decoy      hard/extreme      expected 22/25  observed [22]/[25]
EXACT  redherring hard/extreme      expected 21/24  observed [21]/[24]
EXACT  composed   hard/extreme      expected 24/27  observed [24]/[27]
--> ALL EXACT
```
`groups-to-runs` par is per-instance variable by construction (it always was);
its measured averages are unchanged too — 10.4 / 13.4 / 19.8 / 24.3 vs the
previously recorded 10.6 / 13.4 / 20.6 / 24.2.

*The `goal.get(undefined) → null` path is gone:* `buildDecoy` / `buildRedHerring` /
`buildComposed` each return non-null **100/100** at hard AND extreme (was: null on
every call after Step 4), and all three layers are emitted by real
`generatePuzzle()` again — e.g. extreme/200: composed 43, decoy 59, red herring 52,
base 46.

*tsc delta, read from the actual diff: **102 → 24 (−78)**.* Exactly the two files
touched: `archetypes.ts` 25 → 0 and `verifyEngine.ts` 53 → 0. Zero new errors, and
no other file's count moved. The remaining 24 are all later-step construction
sites: `storage.ts` 21 (Step 8 legacy-save migration), `solver.ts` 2 (inside
`solveBag`'s `reconstructAssignment` — retired in Step 7), `TilePicker.tsx` 1.

**🐞 SEPARATE PRE-EXISTING BUG FOUND IN STEP 9, NOT FIXED (out of scope) —
THE LIBRARY'S "PLAY" BUTTON DOES NOT PLAY THE SAVED PUZZLE.** `App.tsx`'s
`handlePlay(_puzzle)` **discards its argument** and only calls `setScreen('play')`;
`PlayScreen` takes no puzzle prop and generates its own on mount. So clicking Play
on any library entry silently shows a freshly generated puzzle instead. The
leading underscore suggests it was knowingly stubbed. Fixing it means threading a
puzzle into `PlayScreen` — a real feature change, its own session. **Note this
blocks any future "load a saved puzzle and check X" verification**, as it did here.

**m=2 MIGRATION — Step 9 CLOSED (`Rack.tsx` keyed by id; duplicate drag identity
verified in a REAL browser).** Harness: `src/lib/dragIdentity.verify.ts`
(`npx tsx src/lib/dragIdentity.verify.ts`, **29 passed / 0 failed**).

*The one code change:* `Rack.tsx` `key={i}` → `key={tile.id}`. The rack is spliced
on every RACK→GRID drop and appended on every displacement, so index keys remount
surviving tiles and restart their animations. Ids are unique within a puzzle, so
this is a legal sibling key even with both copies of a duplicate in the rack.

***THE CONSTRAINT THAT MUST NEVER BE VIOLATED:*** `dimmed={draggingRackIdx === i}`
compares the rack **INDEX** and is left unchanged, now with a comment saying why.
Two copies of a duplicate are visually identical — **if this ever became a
value+colour comparison, dragging ONE copy would dim BOTH**, which looks broken and
leaks to the player that the two tiles are "the same", something real Rummikub
never reveals. The harness encodes the counterfactual: the forbidden form dims 2
tiles, the shipped form dims 1.

*`Board.tsx` / `DragPreview.tsx` / `useDrag.ts` / `TileFace.tsx` — confirmed by
READING, not by trusting §0.2:* Board keys cells `${r}-${c}` and dims via
`srcRow === r && srcCol === c`; `invalid`/`lockIn`/`hovered` all key on `${r},${c}`;
`useDrag` carries a positional `DragSrc`; `TileFace` renders from `tile.n`/`tile.c`
and never reads `tile.id`. **Zero changes needed**, and a repo-wide grep found NO
value+colour comparison anywhere in components/hooks/screens — the only `.c ===`
hit is `dragSrc.col === target.col`, a *column*.

***DESIGN DECISION — duplicates get NO visual distinction.*** Followed the
document's recommendation: real Rummikub tiles are indistinguishable, and marking
them would leak puzzle structure. This needed no code (TileFace already renders
from `(n,c)` only) and is now **asserted by the harness** so it cannot regress.

*Verified in a REAL browser (Chrome automation was available this session — unlike
some earlier sessions).* Test vehicle built through the **actual editor UI**:
board group `1r/1b/1k` + **two copies of `1a`** in the rack.
```
Step 8 cap, live: adding a THIRD 1a refused ->
    "Only 2 copies of any tile are allowed."   rack stayed at 2
Saved to real localStorage: rack ids ["1_a_0","1_a_1"], both rendering "1a"
Drag held on copy #0 : copy#0 opacity 0.35 scale 0.93 | copy#1 opacity 1, no transform
Drag held on copy #1 : ["1", "0.35"]                  (mirror case)
REAL mouse drag of the 2nd rack tile onto the board, React props read back:
    board gained 1_a_1   |   rack kept 1_a_0
```
That last one is the strongest evidence: **the specific copy moved, not "whichever
matches (1,a)"**. A temporary `PlayScreen` shim was needed to get the puzzle on
screen (because of the `handlePlay` bug above) and was **fully reverted** — the
commit touches only `Rack.tsx` and `tsconfig.app.json`.

*Method note:* reading computed styles immediately after dispatching `mousedown`
races React's re-render, and a follow-up screenshot in a separate round trip ends
the drag. Hold the drag and capture **within one `browser_batch`**, or allow a
~250ms settle before reading.

*`tsconfig.app.json` gained `"node"` in `types`* — `src/lib` holds seven
tsx-executed harnesses and `dragIdentity.verify.ts` reads component source via
`node:fs`. **Trade-off accepted knowingly and noted in the file: Node globals are
now visible to real browser code**, so `process`/`fs` in a component would
typecheck and then fail in the browser. Keep app code free of Node APIs.

*A `dup-test` puzzle now sits in the real `puzzikub_library` localStorage* — left
deliberately as a manual duplicate-drag fixture. Delete it from the Library screen
whenever it is no longer wanted.

**m=2 MIGRATION — Step 10 FORMALLY CLOSED (re-verification session, no code
changes).** Distinct from "resolved by probe": the 10a probe (§10a, still the
correct citation for *why* the swap is safe) proved the claim once, in isolation,
before Steps 4-9 existed. This session re-ran the full suite on the CURRENT
codebase — post Step 9, all of Phase A/B/C complete — to confirm the resolution
held through every subsequent implementation step, not just at the moment it was
first probed.

*All eight harnesses green, real pasted output, nothing regressed since Step 9:*
```
decoy.verify.ts             === SELF-CHECKS: 23 passed, 0 failed ===
redherring.verify.ts        === SELF-CHECKS: 25 passed, 0 failed ===
composed.verify.ts          === SELF-CHECKS: 32 passed, 0 failed ===
verifyEngine.ts             === SELF-TESTS: 52 passed, 0 failed ===
                             === INVARIANTS (a)-(d): ALL PASSED on every generated puzzle ===
mixedGoalPlanner.verify.ts  === SELF-CHECKS: 37 passed, 0 failed ===
pairingMin.verify.ts        === SELF-CHECKS: 31 passed, 0 failed ===
storage.verify.ts           === SELF-CHECKS: 37 passed, 0 failed ===
dragIdentity.verify.ts      === SELF-CHECKS: 29 passed, 0 failed ===
```

*Par, all seven numbers exact — confirmed independently by TWO sources (each
archetype's own harness AND `pairingMin.verify.ts`'s own regression section),
`actual [expected]`:*
```
easy       11 [11]     medium 16 [16]     hard 20 [20]
decoy      22 [22] / 25 [25]
redherring 21 [21] / 24 [24]
composed   24 [24] / 27 [27]
--> ALL SEVEN PAR NUMBERS UNCHANGED
```

*TRAP mechanics specifically re-confirmed on FRESH puzzles, not fixed cases* — both
`decoy.verify.ts` and `redherring.verify.ts` independently rebuild 25 puzzles per
difficulty EVERY run (confirmed by the varying example puzzle printed each
invocation — this run's decoy example was `{13a} s=7 L=6`, an arbitrary draw, not
a hardcoded fixture) and recompute the trap property THEMSELVES on each fresh
instance by calling `solveBagM2` directly on the reduced bag, rather than trusting
the builder's own internal boolean. This run: decoy TRAP=25/25 (hard) and 25/25
(extreme); red herring TRAP(hi)=25/25 and TRAP(lo)=25/25 at both tiers; composed
TRAP(decoy/hi/lo/both)=25/25 across the board. The property held on every fresh
draw, not just on cases baked into the harness at write-time.

*Strict build gate — `npm run build` (`tsc -b && vite build`), not the narrower
`tsc -p tsconfig.app.json` alone (per the lesson from the build-unblock session
below):* succeeds cleanly — `106 modules transformed, built in 234ms`, zero tsc
errors. (`tsc -p tsconfig.app.json` also independently checked at zero, so the two
gates agree.)

**Nothing surprised, nothing failed.** The 10a probe's claim — `solveBagM2` agrees
with `solveBag` on every duplicate-free bag, so the existing traps (built and
checked entirely on duplicate-free bags) cannot be silently defused by the Step 7
solver swap — held through Steps 4 through 9 exactly as predicted. **The genuine
duplicate-defusal risk remains entirely Step 11's to prove from scratch**, per
10a's own scoping: Step 11's archetype is the first one whose reduced bags can
actually gain a second copy, so it needs its own trap proof and cannot inherit
this one.

**m=2 MIGRATION — Step 11 CLOSED: the CUT-POINT ARCHETYPE ships. This is the
payoff the entire migration existed for — the first construction that genuinely
REQUIRES duplicate tiles.** `buildCutPoint(diff)` / `buildCutPointAt(L, blocks)`
in `archetypes.ts`; harness `src/lib/cutpoint.verify.ts` (`npx tsx
src/lib/cutpoint.verify.ts`, **36 passed / 0 failed**). Wired into
`generator.ts` as its own band, **MEDIUM ONLY**, hidden `archetypeId:
'cut-point'`, `CUTPOINT_PROB` 0.25 (measured emission ~25-28%).

*The construction:* board = one already-valid run per colour (2 colours, values
`s..s+L-1`, L=10, one row each). Rack = **second copies** at 3 interior cut
values per colour. The player must break each apparently-finished run so every
piece is still a valid run (≥3). Board 8×12, 26 tiles, rack 6, **par 12**.

***THE DESIGN QUESTION THE MIGRATION DOC LEFT OPEN IS ANSWERED BY MEASUREMENT,
AND THE ANSWER IS "ONE SHAPE, NOT TWO".*** The doc asked whether adjacent
duplicates (two-run answer) and spread duplicates (three-run answer) should ship
as one archetype or two calibrated constructions. Neither: **only SPREAD ships,
because ADJACENT is structurally inferior, not merely different.** The
discriminator is SOLUTION UNIQUENESS, measured over every (d1,d2) at each L:
```
   L= 8:  SPREAD solvable= 3 unique= 3   ADJACENT solvable= 5 unique=1
   L=10:  SPREAD solvable=10 unique= 7   ADJACENT solvable= 7 unique=0
   L=11:  SPREAD solvable=15 unique= 6   ADJACENT solvable= 8 unique=0
   L=12:  SPREAD solvable=21 unique= 3   ADJACENT solvable= 9 unique=0
   L=13:  SPREAD solvable=28 unique= 1   ADJACENT solvable=10 unique=0
```
Adjacent duplicates are **never** uniquely solvable at any L≥10. That matters
because of the next point.

***UNIQUENESS IS THE TRAP — and it is a strictly stronger trap than
decoy/red-herring/composed's.*** A bag of ONE colour admits no group at all
(`isValidGroup` needs ≥3 distinct colours), so every part of the answer is a
run; a uniquely-partitionable bag therefore makes **every** wrong cut fatal.
Where decoy/red-herring/composed each verify a handful of specific tempting
commitments, this is verified EXHAUSTIVELY over every run a player could commit
to. Per Step 10's explicit instruction the trap proof is built **from scratch**
— it inherits nothing from the existing traps, whose unsolvability arguments are
m=1 facts about different constructions:
```
  TRAP detail: wrong commitments tested=1600, ALL fatal=true
               true parts tested=200,        ALL survive=true
```

***THE TWO-COLOUR CAP IS LOAD-BEARING, NOT A TUNING KNOB.*** Two colours can
never form a group, so the bag stays runs-only and the puzzle's solution count
is the PRODUCT of the per-colour counts. A third colour at shared values makes
groups available, explodes the solution space and destroys uniqueness — and with
only 13 values, three blocks of the length this needs cannot avoid sharing.
`buildCutPointAt` **REFUSES** `blockCount > 2` rather than clamping it. Do not
"generalise" this to more colours.

*What is PROVEN (real executed output, `cutpoint.verify.ts` 36/0). The harness
re-derives everything INDEPENDENTLY of the builder — its own brute-force
partitioner, its own candidate-run enumeration, its own par-over-all-layouts
search, its own DROP-reducer transcription:*
- **25/25 builds**: (a)-(e) all 25, **UNIQUE=25**, **TRAP=25**, **NODUP=25**,
  `pars={12}`, `grids={8x12}`, ALL=25.
- **NODUP is the sharpest statement that this needed the migration**: the m=1
  `solveBag` **REJECTS** every one of these bags outright while `solveBagM2`
  solves them. This archetype could not have existed before m=2.
- **Step 6b's pairing minimisation does real work here for the FIRST time in a
  shipped archetype** (previously only exercised in isolated tests): every
  duplicated value has one copy on the board and one in the rack, so the binding
  decides which copy keeps the board cell. `candidates=64 enumerated=[6 labels]
  spread=5` — **6 duplicate labels, exactly at `MAX_ENUMERATED_DUPLICATES`=6**,
  and `spread>0` on 12/12 builds, i.e. the pairing genuinely mattered every time.
- **par is honest, not merely self-consistent**: builder par == **min over EVERY
  layout** (independently re-searched over all independent sets of pieces that
  could keep their board cells) == a real simulated win, 6/6:
  `par=12 minOverAllLayouts=12 simulated=12 validateGrid win`.
- **The distinguishing property**: starting board already valid 10/10, and
  **every rack tile has ZERO obvious spots** 10/10 — a duplicate can never
  legally extend the run it duplicates. Unlike every other archetype there is
  nothing to "fill in"; the only way to win is to DISMANTLE something that
  already validates.
- The doc's own worked example reproduces: red 1..8 + dups 3 and 6 →
  **solutions=1** → `[1..3][3..6][6..8]`, and `solveBagM2` over all 28 pairs
  returns exactly the documented `(2,3)(3,4)(3,5)(3,6)(4,5)(4,6)(5,6)(6,7)`.
- Timing ~5 ms/build. Emission: cut-point 56/200 at medium, base archetypes
  still 73/71; **leaked into easy/hard/extreme: 0**.

***MEDIUM ONLY — and the two caps that force it are real, measured, and should
not be quietly "fixed" later.***
1. **UI WIDTH, the binding constraint.** `Board.tsx` renders a FIXED
   `repeat(cols, 46px)` grid with no responsive scaling or overflow handling:
   width = `cols*46 + (cols-1)*6 + 32`. The previous widest board ever shipped
   was 10 cols = 546px. L=10 → 12 cols = **650px**, already the widest this game
   has shipped. Longer runs verify perfectly clean and reach higher par —
   **L=13/k=3 gives par 8 per block, and two such blocks reach par 16, an exact
   match for medium's par** — but need 15-16 cols (~860px) and would overflow.
   **Revisit only alongside a responsive Board**, not by bumping the table.
2. **UNIQUENESS vs PAR are in direct tension.** High par needs wide middle
   pieces; wide middles break uniqueness. Under uniqueness, max par per block is
   5 with 2 duplicates and 8 with 3 (measured across L=7..13, par computed as
   min over all layouts). Hard (20) and extreme (24-27) are **structurally
   unreachable** for this archetype — they would need 3+ colour blocks, which
   destroys uniqueness per the cap above.

***KNOWN LIMITATION, STATED PLAINLY: par UNDERSTATES this archetype's
difficulty.*** par measures MOVES; this puzzle's difficulty is SEARCH — finding
where to cut. par 12 sits below medium's base 16 while the reasoning is
arguably harder. Precedent exists for intra-tier par spread (hard: base 20,
decoy 22, red herring 21, composed 24), so 12-vs-16 is acceptable, but do not
read par 12 as "easier than a base medium puzzle". Also honest: the two colour
blocks are INDEPENDENT sub-puzzles (no group can couple them) — the player
solves the same insight twice. That is more work, not deeper work, and it is
what makes par additive; it is not claimed as coupling (see COUPLED_DESIGN.md
for why genuine coupling is a separate unsolved problem).

*One deliberate change to an existing harness, worth knowing about:*
`verifyEngine.ts`'s player-facing `generatePuzzle()` bag check ran on the m=1
`solveBag`, which **rejects any duplicate outright** — so it would have scored
every cut-point puzzle as invalid. It now checks with `solveBagM2`, and the
differential value of keeping `solveBag` alive is **preserved rather than
discarded**: on every duplicate-FREE generated puzzle the two solvers must still
agree, now asserted explicitly (`149 duplicate-free puzzles, 0 disagreements`).
`verifyEngine` is 52 → **53 checks** for that reason.

*Full suite after Step 11, nothing regressed:* `cutpoint` **36/0** ·
`verifyEngine` **53/0** + invariants (a)-(d) all passed, all four tiers 40/40 ·
`decoy` **23/0** · `redherring` **25/0** · `composed` **32/0** ·
`mixedGoalPlanner` **37/0** · `storage` **37/0** · `dragIdentity` **29/0** ·
`pairingMin` **31/0** with all seven shipped par numbers still EXACT. Strict
build gate `npm run build` (`tsc -b && vite build`) succeeds: `106 modules
transformed, built in 174ms`.

*Still open after Step 11:* **Step 12** (end-to-end pass, a real browser
playthrough of a duplicate puzzle, and folding the m=2 model into this file's
main sections) — note the `handlePlay` Library bug below still blocks
"load a saved puzzle and check X" verification. The L≤10 UI cap above is the
one place where a straightforward future win exists (responsive Board → L=13 →
par 16). COUPLED still needs its contested-resource redesign.

**CHAIN ARCHETYPE — BUILT, WIRED AND VERIFIED (session after the m=2 migration).**
`buildChain` / `buildChainAt` in `archetypes.ts`; harness `src/lib/chain.verify.ts`
(**28 passed / 0 failed**). Wired into `generator.ts` sharing ONE roll with the
cut-point band so the two medium-only layers are disjoint; `CHAIN_PROB` medium
0.20 (measured emission ~18%). Hidden `archetypeId: 'chain'`. See "m=2
ARCHITECTURE §4b" above for the design, the theorem behind it, and the two
prior failures it avoids.

*Real executed output:*
```
25/25 builds | a=25 b=25 c=25 d=25 e=25 UNIQUE=25 DEPTH=25 GENUINE=25  ALL=25
pars={9} grids={10x6} cascadeDepths={8} genuineSteps={7}
e.g. {1r 2r 3r}{3b 3a 3k}{4b 5b 6b}{6r 6a 6k}{7a 8a 9a}{9r 9b 9k}{10k 11k 12k}{12r 12b 12a}
```
*The chain proof — all 8 links, each with real solveBagM2 evidence that the
rival candidate sets it rules out are genuinely unsolvable:*
```
round 1: 1r(initial 1)  2r(initial 1)
round 2: 3a(4) 3k(4)      3a: 3 rivals at move zero, 3 proven UNSOLVABLE
round 3: 4b(3) 5b(3)      4b: 2 rivals, 2 proven UNSOLVABLE
round 4: 6r(4) 6k(4)      6r: 3 rivals, 3 proven UNSOLVABLE
round 5: 7a(3) 8a(3)      7a: 2 rivals, 2 proven UNSOLVABLE
round 6: 9r(4) 9b(4)      9r: 3 rivals, 3 proven UNSOLVABLE
round 7: 10k(3) 11k(3)    10k: 2 rivals, 2 proven UNSOLVABLE
round 8: 12r(4) 12b(4) 12a(4)  12r: 3 rivals, 3 proven UNSOLVABLE
```
*The crux the brief demanded be tested rather than assumed — "is this just decoy
with extra steps?" NO, measured: ambiguous tiles per round*
```
22 -> 19 -> 16 -> 13 -> 10 -> 7 -> 4 -> 0     (gradual cascade, not a collapse)
baseline, same measurement: runs-to-groups / decoy / composed all STALL at depth 0
```
*par honesty:* `par=9  minOverAllLayouts=9  simulated=9  validateGrid win`, 6/6.
*Timing* 1.17 ms/build. *Emission:* chain 35/200 at medium, cut-point still 49,
both base directions present, **0 leaks into easy/hard/extreme**.

*Suite after this change — nothing regressed:* `verifyEngine` **53/0** +
invariants (a)-(d) · `decoy` **23/0** · `redherring` **25/0** · `composed`
**32/0** · `cutpoint` **36/0** · `chain` **28/0** · `mixedGoalPlanner` **37/0** ·
`pairingMin` **31/0** with all seven original par numbers EXACT · `storage`
**37/0** · `dragIdentity` **29/0**. `npm run build` clean.

*Worth noting: the strict build gate earned its keep again* — `tsx` ran the new
harness fine while `tsc -b` caught an unused import in it. Harnesses are
typechecked by the build; `tsx` does not typecheck.

**m=2 MIGRATION — Step 12 CLOSED. THE MIGRATION IS COMPLETE (Steps 1-12).**
See "m=2 ARCHITECTURE — CURRENT TRUTH" near the top of this file for the
consolidated model; everything below this point is history.

*FULL HARNESS SWEEP — all nine, real pasted counts, one place:*
```
verifyEngine.ts             === SELF-TESTS:  53 passed, 0 failed ===
                            === INVARIANTS (a)-(d): ALL PASSED ===
decoy.verify.ts             === SELF-CHECKS: 23 passed, 0 failed ===
redherring.verify.ts        === SELF-CHECKS: 25 passed, 0 failed ===
composed.verify.ts          === SELF-CHECKS: 32 passed, 0 failed ===
cutpoint.verify.ts          === SELF-CHECKS: 36 passed, 0 failed ===
mixedGoalPlanner.verify.ts  === SELF-CHECKS: 37 passed, 0 failed ===
pairingMin.verify.ts        === SELF-CHECKS: 31 passed, 0 failed ===
storage.verify.ts           === SELF-CHECKS: 37 passed, 0 failed ===
dragIdentity.verify.ts      === SELF-CHECKS: 29 passed, 0 failed ===
                                    TOTAL: 303 checks, 0 failures
```
*Par — all seven original numbers plus cut-point, `actual [expected]`:*
```
  easy       (runs-to-groups)   11 [11]      medium  16 [16]     hard 20 [20]
  decoy      hard 22 [22]   extreme 25 [25]
  redherring hard 21 [21]   extreme 24 [24]
  composed   hard 24 [24]   extreme 27 [27]
  cut-point  medium 12 [12]        --> ALL EIGHT EXACT
```

***REAL BROWSER PLAYTHROUGH — a cut-point puzzle played to an actual win.***
Reached through ordinary gameplay via the dev override
(`?forceArchetype=cut-point`, then click **medium**); Library was not involved,
so the `handlePlay` bug did not block it. Puzzle generated live:
```
board  blue 4..13 (r1c1..c10)   red 1..10 (r2c1..c10)   -- all copy 0
rack   6_b_1 9_b_1 11_b_1 4_r_1 6_r_1 8_r_1             -- ALL copy 1
       (blue cuts 6/9/11, red cuts 4/6/8)               par 12
```
Solved in **exactly par**, final state read back from live React props and
INDEPENDENTLY re-validated in-page (segments recomputed from the DOM and each
checked as a run), not judged from the screenshot:
```
r1:[6b#0 7b#0 8b#0 9b#0] VALID    r1:[11b#0 12b#0 13b#0] VALID
r2:[1r#0 2r#0 3r#0 4r#0] VALID    r2:[6r#0 7r#0 8r#0]    VALID
r3:[4b#0 5b#0 6b#1]      VALID    r3:[9b#1 10b#0 11b#1]  VALID
r4:[4r#1 5r#0 6r#1]      VALID    r4:[8r#1 9r#0 10r#0]   VALID
every duplicate pair SPLIT ACROSS TWO RUNS (6_b,9_b,11_b,4_r,6_r,8_r)
tiles=26  rackEmpty=true  allSegmentsValid=true
banner: "cleared ✓ perfect!  12 moves"
```
That last line is the whole migration in one screenshot: **both copies of six
(value,colour) pairs on the board at once, each pair split across two different
runs** — impossible before m=2.

***METHOD NOTE THAT WILL SAVE THE NEXT BROWSER SESSION HOURS.*** Automated
drags are only reliable when they are SHORT and VERTICAL. Long or diagonal
`left_click_drag` calls silently drop on the WRONG cell, because `PlayScreen`'s
mouseup handler closes over `hoverTarget` state and its effect re-subscribes on
`[drag, hoverTarget]` — if React has not re-rendered before mouseup, the STALE
target is used. Two ways through:
- Choose a goal layout whose board moves are all vertical (legal — any valid
  final arrangement wins, the layout is the player's choice).
- Or drive it deterministically: dispatch `mousedown` → `mousemove` →
  `mouseover` on the target → **wait ~170 ms** → `mouseup`.
  **The trap:** dispatch that `mouseover` with **NO `relatedTarget`**. React's
  EnterLeaveEventPlugin BAILS OUT of `mouseover` when `relatedTarget` is a node
  already inside the React tree (it expects the paired `mouseout` to drive it),
  so setting `relatedTarget` to the source element suppresses the very
  `onMouseEnter` the drop depends on, and the drag silently does nothing.

*Strict build gate:* `npm run build` → `106 modules transformed, built in
220ms`, zero errors. (See THE BUILD GATE standing instruction at the top.)

*One small fix made this session:* `PlayScreen`'s `?forceArchetype=` doc comment
listed the accepted values but had not been updated for `cut-point`; it now
lists it and states that each variant is tier-restricted.

**✅ BUILD IS UNBLOCKED — standalone build-fix session, NOT a numbered migration
step.** `npm run build` (`tsc -b && vite build`) had failed ever since Step 1 added
`Tile.id`, on 2 errors in `solveBag`'s `reconstructAssignment`
(`tileKey({n,c})`). Fixed: `tileKey({ n: v, c })` → `tileKey(makeTile(v, c))` at
both sites, plus the `makeTile` import. **That is the whole functional change — 2
lines.** `npm run build` now succeeds (`106 modules transformed, built in 177ms`)
and **`tsc -p tsconfig.app.json` is at ZERO errors** — the Step 1 error list is
fully discharged (131 → 102 → 24 → 2 → 0).

*Why this provably could not change `solveBag`'s behaviour* — which matters because
Step 7 keeps `solveBag` alive as the independent oracle `solveBagM2` is checked
against, so a silent change here would have corrupted every differential test since
Step 2:
- `tileKey` is `` t => `${t.n}_${t.c}` `` — it reads `n`/`c` and **ignores `id`**, so
  `makeTile(v, c)` yields a byte-identical key string to the old literal.
- `reconstructAssignment` runs **only after `dp()` has already returned true**; it
  builds the assignment map and cannot influence `solvable`.
- The DP itself (duplicate rejection, range check, group enumeration, run-state
  transitions, memo) is untouched, and `solveBagM2` does not appear in the diff.

*Proven, not argued — differential against the pre-fix implementation extracted
verbatim from git (it runs fine under `tsx`; the failure was type-level, not
runtime), comparing BOTH `solvable` and the full assignment map:*
```
13 explicit known cases, each with a stated expected value : expected met AND
   fixed === pre-fix on all 13 (incl. empty bag, run of 2, duplicate,
   out-of-range, dangling pair, 3x4 dual block)
30,000 constructed bags, 22,607 solvable : 0 solvable disagreements,
                                           0 assignment-map disagreements
74 structured block bags : 0 disagreements; assignment still re-partitions
                           into genuinely valid runs/groups, 74/74
6,000 duplicate-free bags : solveBag vs solveBagM2 still agree, 0 mismatches
```
`verifyEngine`'s own original SOLVER SELF-TESTS also pass unchanged. **Method note
worth keeping:** the first sweep used purely *random* bags and produced only
**8 solvable out of 30,000** — which would have left the one changed function
essentially untested. Bags are now built from real runs/groups and then perturbed.
Random bags are almost never partitionable; don't trust a solver sweep that doesn't
report its solvable count.

**This does NOT mean the branch is shippable.** `m2-migration` still must not be
merged to main — Steps 9-13 remain. A green build means a deploy *would* work, not
that it should happen.

**m=2 MIGRATION — Step 8 CLOSED (`storage.ts` + editor). Legacy saves migrate
safely; proven against reconstructed-real data.** Harness:
`src/lib/storage.verify.ts` (`npx tsx src/lib/storage.verify.ts`, **37 passed /
0 failed**).

***THE MIGRATION STRATEGY — a pure function, which is exactly what Step 1's
STRUCTURED id scheme was chosen for.*** `id = ${n}_${c}_${copyIndex}`, where
`copyIndex` is the tile's **occurrence position among same-(n,c) tiles within its
own puzzle**, scanned **grid row-major, then rack**. Same blob in, same ids out —
no remap table, no counter, no dependence on load order. `loadLibrary()` runs it;
`migrateLibrary()` is exported so it is testable without a browser.

*Three rules, each chosen because the alternative loses real user data:*
1. **A tile that already has an id is left completely alone** — so a
   post-migration save round-trips byte-identically. Re-minting would renumber
   copies and silently change which tile is which.
2. **Nothing is ever dropped.** Legacy data with MORE than `TILE_COPIES` of one
   (n,c) — possible, the old editor had no cap — still gets every tile a unique id
   (copy 2, 3, …). The condition is **reported** via `stats.countOverCap`, not
   silently "fixed" by deleting the extras.
3. **Mixed blobs work.** Minting skips copy indices already claimed in that puzzle,
   so a migrated tile can never collide with a surviving one.

*Two safety decisions worth not undoing:*
- **`loadLibrary` does NOT write the migrated result back.** Migration is
  deterministic and idempotent, so re-running costs nothing — and leaving the
  original blob untouched means a bug in the migrator **cannot destroy the saved
  library**. Verified: the stored blob is byte-unchanged after a load.
- **A single damaged entry no longer costs the whole library.** It is skipped
  (counted in `puzzlesSkipped`) and the rest load; seeds are only used when the
  blob yields nothing at all.

*On test data — stated plainly:* a session cannot read a browser profile's
localStorage, so the legacy blobs are **synthetic but not guessed** — the
pre-migration `Tile` was exactly `{n, c}` and the old `SEED_PUZZLES` literal is
reproduced verbatim, both read from **git at `aeafc4a`** (the commit before Step 1
added `id`). **The strongest evidence is the reconstructed-real test:**
```
100 REAL generated puzzles (25/difficulty, all archetype layers),
ids stripped — exactly what an old save of them looked like — then migrated:
   byte-identical to the original                : 100/100
   passes the full fresh-puzzle validity suite   : 100/100
   (validateGrid · no invalid cells · solveBagM2 · rack-alone ·
    no-relocation-win · not trivial · par > 0)
```
An m=1-shaped puzzle is all copy 0, so occurrence-index minting **must** reproduce
the original ids exactly — which makes this an exact-identity test, not a
plausibility check. Also verified: duplicate-bearing legacy blob numbers copies by
occurrence (`5_r_0,7_b_0,7_b_1,9_a_0,5_r_1,9_a_1`); fresh puzzles round-trip
save→load **40/40 unchanged with 0 tiles re-minted**; migration idempotent; corrupt
JSON falls back to seeds rather than throwing.

*The editor (`useEditor` + new `src/lib/editorRules.ts`):*
- The pure rules (`usedIds` / `mintTile`) live in **`src/lib/`, not the hook** —
  the cap is game logic per the architecture rule, and this makes it directly
  testable rather than only reachable through a rendered React hook.
- `setTileAt` / `addRackTile` / `updateRackTile` take a **`TileSpec`**, mint the id
  themselves (only they can — copy index is puzzle-scoped), and **return a
  boolean**: `false` means the cap refused it. `EditorScreen` surfaces that
  ("Only 2 copies of any tile are allowed."), never swallows it.
- New `types.ts` **`TileSpec = Pick<Tile,'n'|'c'>`**. `TilePicker` emits a spec, not
  a `Tile` — a component cannot scope a copy index correctly, and the type now
  stops it from trying. **Do not "simplify" this back to passing a `Tile`.**
- **Cap tested behaviourally, not asserted:** `add 5r ×3 → true, true, FALSE`, rack
  left holding exactly `5_r_0` and `5_r_1`; the cap spans grid+rack together;
  overwriting a slot is not counted as a new copy; unrelated tiles unaffected. And
  `solveBagM2` confirmed to reject an over-cap bag outright — which is *why* the
  cap exists (such a puzzle is unsolvable by construction).

*Existing suite, unchanged:* `verifyEngine` **52/0** + invariants (a)-(d) all
passed · `decoy` **23/0** · `redherring` **25/0** · `composed` **32/0** ·
`mixedGoalPlanner` **37/0** · `pairingMin` **31/0**.

*tsc: **24 → 2 (−22)**.* Diff-read: `storage.ts`'s 21 and `TilePicker.tsx`'s 1 both
cleared — exactly the Step 1 error list's entries for those files. The 2 remaining
are `solver.ts`'s (see the build warning above).

**Still open for Step 9 (UI):** `Rack.tsx` still uses `key={i}`; the
`dimmed={draggingRackIdx === i}` prop **must stay positional** — switching it to a
value+colour comparison is precisely the bug that would make dragging one copy of a
duplicate dim the other.

**m=2 MIGRATION — Step 7 CLOSED (builders on `solveBagM2`). `solveBag` is NOT
removed — see its retirement status below; this is the one place Step 7 deviates
from what an earlier note predicted.**

*The swap:* all **11** `solveBag` call sites in `archetypes.ts` → `solveBagM2` —
the (b) solvability gate in all five builders, plus all six trap-deadness checks
in decoy/redherring/composed. `solveBagM2`'s implementation untouched.

***`solveBag` RETIREMENT STATUS: still live, deliberately.*** No production code
calls it, but it is still imported by **four verification harnesses**
(`verifyEngine.ts`, `decoy.verify.ts`, `redherring.verify.ts`,
`composed.verify.ts`) — checked by grep, not assumed. **Keep it that way:** every
existing archetype emits an m=1-shaped bag, a strict subset of what `solveBagM2`
handles, so *builders on `solveBagM2` checked by harnesses on `solveBag`* is a live
differential test rather than a solver grading its own homework. Retire it only
when no harness needs an independent oracle. Note Step 11's duplicate-bearing
archetype **cannot** use it at all — m=1 `solveBag` rejects any duplicate outright.
The retirement rationale is also written at `solveBag`'s definition in `solver.ts`.

**Correction to the Step 2 note below:** it predicted Step 7 would clear
`solver.ts`'s 2 tsc errors by deleting `solveBag`. **That prediction was wrong** —
`solveBag` survives, so those 2 errors remain open indefinitely.

*Verification (real executed output):*
- Harnesses, **identical pass counts to Step 6**: `verifyEngine` **52/0** +
  invariants (a)-(d) all passed · `decoy` **23/0** · `redherring` **25/0** ·
  `composed` **32/0** · `mixedGoalPlanner` **37/0** · `pairingMin` **31/0**.
- **Real-batch regression — the check that actually matters, not fixed test
  cases:** 120 `generatePuzzle()` calls per difficulty = **480 real puzzles**, full
  invariant suite (a / b / c / d / d-literal / clean-cells / par>0 / not
  budget-exhausted): **480/480 passed, 0 failures**, budget-exhausted 0. All five
  layers emitted at hard and extreme (e.g. extreme: decoy 36, redherring 25,
  composed 23, runs-to-groups 19, groups-to-runs 17), per-layer par sets exactly as
  recorded — `runs-to-groups {20}`, decoy `{25}`, redherring `{24}`, composed `{27}`.
- **The Step 7 safety claim checked LIVE on those same 480 shipped bags** rather
  than inherited from the Step 10 probe: `solveBag(bag).solvable ===
  solveBagM2(bag).solvable`, **0 mismatches**.
- Par, 20 fresh builds each, `actual [expected]`: easy 11 [11] · medium 16 [16] ·
  hard 20 [20] · decoy 22 [22] / 25 [25] · redherring 21 [21] / 24 [24] · composed
  24 [24] / 27 [27] — **ALL SEVEN UNCHANGED**.

*tsc: **24 errors, UNCHANGED**.* Diff-read against the Step 6 list: the ONLY
difference is `solver.ts` line numbers 124/127 → 142/145, which is the doc comment
added above `solveBag` — same two errors, same code, same message. Remaining 24:
`storage.ts` 21 (Step 8), `solver.ts` 2 (above), `TilePicker.tsx` 1 (Step 9).

**m=2 MIGRATION — Step 6 GENUINELY CLOSED (6a design + 6b implementation + 6c
re-proof). ZERO par change for every shipped archetype.** `bindMinCostGoal()` in
`mixedGoalPlanner.ts`; harness `src/lib/pairingMin.verify.ts` (run `npx tsx
src/lib/pairingMin.verify.ts`, **31 passed / 0 failed**, ~9 min — it is BFS-bound).

*6b — the minimisation, driving Step 4's `pinned` override exactly as it was built
to be driven. No deviation from 6a's settled findings:*
- Enumerates ONLY duplicated labels with **≥1 copy already on the board**.
  Both-copies-in-rack duplicates are skipped outright (reported as
  `skippedRackOnly`) — rack tiles have no cell, so they can be neither `fixed` nor
  on a cycle, making the copies interchangeable.
- Each candidate: `bindWindowTiles(pinned)` → `mixedLayoutMoves`; **minimum wins**.
  Ties go to the earliest candidate, which IS the ascending-id default, so **d=0
  yields exactly ONE candidate with an empty pinned map — structurally identical to
  the Step 5 call.** That is the reason an m=1-shaped build *cannot* change par by
  adopting this; it is not a lucky measurement.
- **No min-cost bipartite matching.** Finding 3 proved 2^d enumeration sufficient;
  that machinery is deliberately not built.
- **Guard:** `d > MAX_ENUMERATED_DUPLICATES` (6) throws `PairingBlowupError` naming
  the offending labels — loud, never a silent 128-binding search.
- `archetypes.ts`: the three hybrid builders call it instead of
  `bindWindowTiles` + hand-built goal + `mixedLayoutMoves`. No construction,
  parameter or window shape changed. `planColorRunGoal`/`planValueGroupGoal` need
  nothing — both reject duplicate-bearing bags outright, so they never see one.

*6c — the re-proof, split into three NAMED links so each says what it actually
covers (real executed output):*
```
LINK 1  min-over-pairings == min-over-BFS-per-pairing
        instances=300  BFS-checked=300  BFS-refused(nodecap)=0  (998 BFS runs)
        BFS mismatches=0
        BFS-checked by tile count : 6t:101  9t:106  10t:93
        pairing mattered (spread>0) 300/300; naive strictly worse 20/300
LINK 2  realistic scale, wrapper == exhaustive over ALL 2^D pairings
        instances=300   tiles 19-30   d histogram d=1:55 d=2:65 d=3:103
                                                  d=4:36 d=5:19 d=6:22
        wrapper != exhaustive min : 0        (candidates avg 12.4, max 64)
LINK 3  every winning witness replayed through an independent DROP reducer
        length != par : 0     not a validateGrid win : 0
```
**BFS is run to EVERY candidate pairing's goal, not just the chosen one** — BFS-ing
only the chosen binding would re-test Step 4, not this step. LINK 2's exhaustive
reference includes the rack-only labels the wrapper skips, so **the skip is
re-proven at realistic scale rather than inherited from 6a** (also section 2: 300
instances, exhaustive spread 0 every time).

**What is NOT claimed, stated plainly:** BFS at 19-30 tiles. A 27-tile scramble
sits ~27 plies deep at ~300 successors/ply — unreachable by any BFS. What limits
BFS is search DEPTH, not tile count (branching ≈ tiles × cells per ply), which is
why LINK 1's instances are full-size but perturbed a *bounded* number of drops from
goal. The node cap was never hit at 6/9/10 tiles (`BFS-refused = 0`) — a measured
ceiling, not an assumed one. The harness header names all three links and their
limits; do not upgrade these claims when citing them later.

*The named case (6a's cut-point construction — red 1-8 + dup 3 + dup 6, d=2), real
output, all four pairings independently BFS-confirmed:*
```
  3r->[0,1] 6r->[0,1] : cost=2 (fixed=6 cycles=2)  BFS=2 ✓
  3r->[0,1] 6r->[1,0] : cost=1 (fixed=8 cycles=1)  BFS=1 ✓
  3r->[1,0] 6r->[0,1] : cost=1 (fixed=8 cycles=1)  BFS=1 ✓
  3r->[1,0] 6r->[1,0] : cost=0 (fixed=10 cycles=0) BFS=0 ✓
  bindMinCostGoal picked par=0, candidates=4, spread=2
  naive (ascending-id default) would have paid 2
```
So the wrapper demonstrably picks the cheaper pairing on the exact construction
Step 11 targets — not merely in a unit check.

*CRITICAL REGRESSION — all seven shipped par numbers unchanged, 20 fresh builds
each, `actual [expected]`:*
```
  easy 11 [11]   medium 16 [16]   hard 20 [20]
  decoy      22 [22] / 25 [25]
  redherring 21 [21] / 24 [24]
  composed   24 [24] / 27 [27]
  --> ALL SEVEN PAR NUMBERS UNCHANGED
```
`verifyEngine.ts` 52/0 + invariants (a)-(d) all passed; `decoy.verify.ts` 23/0;
`redherring.verify.ts` 25/0; `composed.verify.ts` 32/0; `mixedGoalPlanner.verify.ts`
37/0.

*tsc: **24 errors, UNCHANGED from Step 5**.* The two touched files contribute zero.
(One transient error appeared and was fixed in-session: `PairingBlowupError` used a
constructor parameter property, which this tsconfig's `erasableSyntaxOnly` forbids
— the field is now declared explicitly. Worth remembering for any future class.)
Remaining 24: `storage.ts` 21 (Step 8), `solver.ts` 2 (Step 7), `TilePicker.tsx` 1.

**⚠️ RESOLVED BY STEP 5 (kept for the record) — Step 4/5 BOUNDARY:
`decoy.verify.ts` / `redherring.verify.ts` / `composed.verify.ts` were RED after
Step 4, by design.** Root
cause (exact, for Step 5): `archetypes.ts:974` (and :1113, :1297) build `goal` keyed
by archetypes' LOCAL `tileKey = ${n}_${c}` over id-less `{n,c}` board tiles, then
call the now-id-keyed `mixedLayoutMoves`, which looks up `goal.get(t.id)` →
`goal.get(undefined)` → null → `buildDecoy`/etc. return null. Step 5's stated job —
"`{n,c}` literal → `makeTile(n,c)`; `GoalPlan.goal` and every `goal.set(...)` keyed
by id" — is precisely this fix. NOT broken by Step 4: **`verifyEngine.ts` 52/52
still green** (base archetypes don't use the planner) and **`generatePuzzle`
degrades gracefully** — a rolled trap layer returns null and falls through to the
base archetypes (`generator.ts:82/90-92`), so the live game still ships valid
base-only puzzles until Step 5 (just with wasted retry attempts on a trap roll).

---

## Part 2 — archetype and planner design sessions (decoy / red herring / composed / coupled / mixed-goal planner)

**DECOYS — feasibility settled, see `DECOY_DESIGN.md`.** A session tried to
add a "decoy" tile (obvious-but-wrong placement, genuine hidden home) as a
MODIFIER reusing the pure planners. A probe over 40 real puzzles (every
candidate tile, both directions, hard+extreme) proved it impossible that way:
`groups-to-runs` is inherently decoy-proof (board is full groups → zero obvious
board placements to be tempted by); `runs-to-groups` DOES have real board-visible
decoys (boundary run-extensions in a board colour — 39 found at hard, 27 at
extreme) but their true home is a HYBRID run+group layout that
`planValueGroupGoal` cannot represent (`purePlacesD = 0`), so invariant (e) and
par can't be computed by the existing machinery. Root cause: the run/group
duality that makes the archetypes fair also makes them decoy-resistant. Shipping
decoys therefore needs a NEW mixed-goal planner + fresh par proof — its own
Opus/plan-mode design session, spec'd in `DECOY_DESIGN.md`. **Do NOT re-attempt
as a bolt-on modifier, and do NOT pursue decoys for `groups-to-runs`.**

**COUPLED BLOCKS — feasibility settled, see `COUPLED_DESIGN.md`.** A session
tried "two dual blocks at non-overlapping value ranges sharing exactly one
colour, coupled by row-tightness." A feasibility probe (run before any build)
found three walls: (1) COLOUR BUDGET — a dual block needs ≥3 colours (a 2-colour
block has no valid group form), and any two ≥3-colour subsets of the 4 game
colours overlap in ≥2 colours, so "exactly one shared colour" is provably
impossible without a 5th colour; (2) with ≥2 shared colours, a gap between
ranges makes the shared colour non-contiguous → `planColorRunGoal` returns null
(pure-planner wall, as with decoy); (3) every representable variant DECOMPOSES —
sharing a colour across disjoint value ranges shares a label, not a resource, so
the halves solve independently, and the row-tightness mechanism never bites for
a pure-goal shape (any colour→row bijection is feasible). Genuine coupling needs
a contested resource (overlapping ranges or tight cell geometry) + a generalized
planner — its own session, spec'd in `COUPLED_DESIGN.md`. **Do NOT re-attempt
the "shared colour across non-overlapping ranges" construction.**

**RED HERRING — feasibility settled, see `RED_HERRING_DESIGN.md`.** A session
tried a "red herring" modifier (two rack tiles both plausible for the same
visible opportunity, only one correct, wrong one blocks). Probed before building;
hits the SAME mixed-goal wall as decoy/coupled, two ways: (A) the only "one spot,
two plausible tiles" configs on a valid board are a run's two ends (24/21 found
per 10 runs-to-groups puzzles; ZERO on groups-to-runs' full-group board), and
none of those extender tiles has a pure-planner home (`pairTilesWithPureHome=0`)
— their true home is hybrid; (B) pure shape-ambiguous tiles (both a run- and
group-home) DO exist and are pure-homed (20/40), but committing the "wrong" shape
is an ALTERNATE VALID WIN, never a block (`BLOCKING-herring=0` across all rows) —
the run/group duality means both readings solve. Root cause: dead-end temptations
need hybrid-home boundary tiles; pure ambiguities never dead-end. THIRD
independent convergence on the same missing capability — a MIXED-goal planner.
Do decoy first (red herring is a strict superset). **Do NOT attempt as a bolt-on
or on `groups-to-runs`.**

**MIXED-GOAL PLANNER — built and verified STANDALONE (this session).** The
shared prerequisite all three briefs converge on now exists as
`src/lib/mixedGoalPlanner.ts` (harness: `src/lib/mixedGoalPlanner.verify.ts`,
run `npx tsx src/lib/mixedGoalPlanner.verify.ts`). It is deliberately NOT wired
into `archetypes.ts`, `generator.ts`, or any modifier yet — that is follow-up
work. What it is: a generalization of the proven cost model to HETEROGENEOUS
final layouts, where each destination window is independently a run
(`{type:'run',color,start,length}`) or a group (`{type:'group',value,colors[]}`),
in any mixture, rather than the whole board being one pure shape.

*What is PROVEN (real executed output, `16 passed / 0 failed`, `tsc` clean):*
- **The crux claim holds.** `cost = totalTiles − fixed − cycles` (the
  `makeCostCtx` graph argument) does NOT depend on windows sharing a type — it
  needs only one current cell + one target cell per tile. Confirmed empirically:
  a random sweep of **800 mixed instances, 482 cross-checked against an
  unrestricted move-BFS over the real reducer semantics (GRID→GRID swap /
  RACK→GRID displaced→rack, re-read from usePlayState.ts), 0 witness mismatches,
  0 BFS mismatches, 478 of them containing genuine cross-window cycles** (a cycle
  passing through a run window AND a group window). Plus 3 hand-crafted
  BFS-checked cross-window cycle/path cases, all analytic==witness==BFS.
- **The DECOY_DESIGN concrete example materialises**: board r/b/a runs 1..5 +
  rack {2k,4k,5k,6r} → hybrid goal (run {4,5,6}r + five groups), 19 tiles,
  `reachedGoal=true`, `validGoal=true` (a real `validateGrid` win), par=19 with a
  witness of exactly 19 real drops.
- **API**: `windowsPartitionBag()` (feasibility, delegates bag solvability to
  `solveBag`), `mixedLayoutMoves(grid, rack, goalMap)` → exact moves + fixed +
  cycles + concrete witness `Drop[]` + `reachedGoal`/`validGoal` flags
  (O(tiles), **0.05–0.10 ms/call at 19–35 tiles** — use this directly when the
  layout is known, e.g. decoy), and `planMixedGoal(...)` which SEARCHES window→row
  placements.
- **Known limit (measured, not guessed):** `planMixedGoal`'s placement search is
  factorial in window count `W` — same `L!` wall as `planValueGroupGoal`: W=3
  27ms, W=4 722ms, **W=5 23.6s** (W≥6 extrapolates to ~15-20 min, so the harness
  caps the timing sweep at W=5). Callers that already know their intended layout
  must build the goal map and call `mixedLayoutMoves` directly, bypassing the
  search — the O(tiles) core has no blow-up. A future decoy/coupled/red-herring
  session should construct the goal deterministically, NOT lean on
  `planMixedGoal` for large W.

*Tractability note:* the BFS sweep skips instances >11 cells (318 of 800) as a
guard — those are still witness-checked, just not BFS-checked; the O(tiles)
analytic==witness identity is what covers realistic sizes, BFS only anchors it on
small instances.

**DECOY ARCHETYPE — built, wired, and verified (this session, on top of the mixed
planner above).** `buildDecoy(diff)` / `buildDecoyAt(L)` in `archetypes.ts` (harness:
`src/lib/decoy.verify.ts`, run `npx tsx src/lib/decoy.verify.ts`). Wired into
`generator.ts` as an optional layer, hard/extreme ONLY, hidden `archetypeId:
'runs-to-groups-decoy'` (nothing player-facing reads it). Par flows through the
normal `optimalMoves` field.

*The construction (runs-to-groups only, per DECOY_DESIGN finding 1 — never
`groups-to-runs`):* board = 3 colour runs at values `s..s+L-1`. Rack = one **decoy**
`D={s+L, c}` in a board colour `c` (visibly extends `c`'s run — the tempting move),
two **supports** (4th colour at `s+L-2`, `s+L-1`), and interior **fillers** (4th
colour) chosen by `decoyFillerOffsets`. The decoy's genuine home is a HYBRID goal
built DETERMINISTICALLY — short run `{s+L-2,s+L-1,s+L}c` + one group per value —
scored by `mixedLayoutMoves` directly (NO `planMixedGoal` search). The filler
placement is the crux: it fragments the two non-`c` colours' leftover values so
that committing `D` to the run-extension leaves an unsolvable remainder.

*What is PROVEN (real executed output: `decoy.verify.ts` 23/0, `verifyEngine.ts`
44/0, `tsc` clean):*
- All original invariants (a)-(e) hold on **25/25 builds per difficulty**, PLUS the
  two new ones printed per puzzle: **TRAP** (`solveBag(allTiles \ run-extension)
  .solvable === false`, 25/25) and **OBVIOUS** (`obviousSpots(board, D) > 0`, 25/25).
  `existsNoRelocationWin` confirmed goal-shape-agnostic by reading it (dumps rack
  into frontier cells, calls `validateGrid`) — win=false & not exhausted on all.
- **Par proven by real move-sim, not narrated:** the witness simulated through a
  faithful DROP-reducer transcription lands a `validateGrid` win in exactly par on
  6/6 per difficulty. Par is deterministic `= 3L + rackSize` (fixed=0, cycles=0 for
  this stacked layout): L=5→19, L=6→22, L=7→25, L=8→29. L=5 reproduces the mixed
  planner's own proven par=19.
- **Construction is fast — no cliff:** 0.4 ms/build avg (deterministic; a handful of
  `solveBag`/`existsNoRelocationWin` calls, no candidate search).
- `verifyEngine.ts` invariants (a)-(d) still pass on every `generatePuzzle()` output
  INCLUDING the emitted decoys; both base directions still appear.

*Parameters settled:* `decoyParamsFor` — **hard L=6 (par 22, grid 7×9), extreme L=7
(par 25, grid 8×10)**. Decoy probability `DECOY_PROB` in `generator.ts` — hard 0.35,
extreme 0.60 (measured emission ~32% / ~65%; extreme visibly > hard, as intended).
Par sits just above base runs-to-groups (hard 20 / extreme 20) — decoys are a touch
harder, which is appropriate.

*Decoy layout note:* placed on fresh rows (fixed=0/cycles=0 → par = 3L+rackSize);
a future pass could overlap goal with board to trim par or add cycle-based variety
if calibration ever wants it — not needed now.

**RED HERRING ARCHETYPE — built, wired, and verified (this session, superset of
decoy).** `buildRedHerring(diff)` / `buildRedHerringAt(L)` in `archetypes.ts`
(harness: `src/lib/redherring.verify.ts`). Wired into `generator.ts`, hard/extreme
only, hidden `archetypeId: 'runs-to-groups-redherring'`; par flows through the
normal `optimalMoves`. **Decoy and red herring are MUTUALLY EXCLUSIVE per puzzle**
— one random roll picks at most one via disjoint probability bands; composing both
on a single puzzle is INTENTIONALLY DEFERRED to a dedicated later session.

*The construction (runs-to-groups only):* board = 3 colour runs at `s..s+L-1`. The
rack carries TWO tempting extenders of the SAME run colour `c` at OPPOSITE ends —
`Lo={s-1,c}` (extends the bottom) and `H={s+L,c}` (extends the top) — plus four
kColour supports at `s, s+1, s+L-2, s+L-1`. Both extenders score as obvious
run-extensions (OBVIOUS ×2). The genuine solution splits `c` into a LOW short run
`{s-1,s,s+1}` and a HIGH short run `{s+L-2,s+L-1,s+L}`, keeps `c`'s middle as
`{c,o1,o2}` groups, and turns the four vacated end-values into `{o1,o2,k}` groups.

*The interaction (why it's a red herring, not two glued decoys):* both extenders'
true homes come from the SAME hybrid reorganization, so committing EITHER obvious
append makes `c` one contiguous block again and ORPHANS the other extender —
provably unreachable. TRAP is scoped to this coupling and verified both directions
with real `solveBag`: `solveBag(allTiles \ {c at s..s+L})` and
`solveBag(allTiles \ {c at s-1..s+L-1})` are BOTH unsolvable, while the hybrid goal
wins via `mixedLayoutMoves`. `existsNoRelocationWin` re-confirmed goal-shape-agnostic
by reading it again (win=false, not exhausted on all builds).

*What is PROVEN (real output: `redherring.verify.ts` 25/0, `verifyEngine.ts` 44/0,
`tsc` clean):* on **25/25 builds per difficulty** — (a)-(e), **OBVIOUS ×2**
(lo=25, hi=25), **TRAP ×2** (commit-high dead=25, commit-low dead=25), **HOME ×2**
(both extenders have a real goal cell, 25/25). Witness simulated through the real
DROP reducer == par with a `validateGrid` win, 6/6 per difficulty. Deterministic
par `= 3L + rackSize` (rackSize=6): **hard L=5 → par 21, extreme L=6 → par 24**.

*The L≤6 cap (measured, decisive):* with L≥7 the `c`-middle is ≥3 values, so
"extend BOTH ends fully" leaves `o1/o2` middle RUNS and becomes an ALTERNATE WIN —
the trap leaks. Probed directly before building: L=5/6 `extendBoth-dead=true`,
**L=7 `extendBoth-dead=false`**. `buildRedHerringAt` rejects L∉{5,6}. This caps
extreme at L=6 (par 24), so red-herring puzzles are a touch smaller than decoy's
L=6/7 — accepted; the discrimination task, not raw size, is the point.

*Timing — deterministic, NOT sub-ms like decoy (0.4ms), and here's why:* ~1.8ms
(hard) / ~2.2ms (extreme) per build. No candidate search (fully deterministic goal),
but each build runs more oracle calls than decoy — TWO `solveBag` trap checks plus
the (b) solvability check plus `existsNoRelocationWin` over a LARGER rack (6 tiles)
on an `(L+2)×(L+3)` grid with more empty cells; that exhaustive no-relocation search
dominates. Still ~2ms, far under any budget, no blow-up.

*Emission:* `REDHERRING_PROB` hard 0.20 / extreme 0.30 (`DECOY_PROB` lowered to
0.30 / 0.45 so the bands stay disjoint). Measured ~22% / ~34% red herring; both
trap layers and both base directions still appear at every applicable tier.

**COMPOSED ARCHETYPE — built, wired, and verified (this session). The deferred
composition question above is now CLOSED.** `buildComposed(diff)` /
`buildComposedAt(L)` in `archetypes.ts` (harness: `src/lib/composed.verify.ts`).
Wired into `generator.ts` as its own band, hard/extreme only, hidden `archetypeId:
'runs-to-groups-composed'`. One board carries decoy's ONE-ended trap on colour `cD`
AND red herring's TWO-ended trap on a different colour `cH` — the player must
resolve both deceptions to win.

*The naive superposition is PROVABLY impossible — probed with real `solveBag`
BEFORE building, and this is why the composition needed a redesign rather than a
merge of the two racks:*
1. **TILE COLLISION.** decoy wants kColour supports at `{s+L-2, s+L-1}`; red
   herring wants `{s, s+1, s+L-2, s+L-1}`. The 4th colour has ONE tile per value,
   so they collide on exactly 2 tiles at **every** L (measured L=5..8).
2. **GROUP BUDGET — the unfixable one.** Both traps' high ends finish in a short
   run containing `s+L`, and any valid run containing `s+L` also contains `s+L-1`
   and `s+L-2`. So `cD` and `cH` both vacate those two values, leaving
   `{third board colour, kColour}` = 2 colours — below `isValidGroup`'s minimum of
   3 (`isValidGroup([9a,9k]) === false`, printed). **No value range or grid size
   repairs this**; it is forced by run contiguity, not by parameter choice.

*The fix — a RUN-ONLY high end.* Rather than fight for a group at `s+L-2/s+L-1`,
the layout gives up on having one: the third board colour `cC` ALSO runs across
the high end (`{s+L-3..s+L-1}`), so all three board colours are in runs there and
no group is needed; kColour simply carries no tile at those values. Rack = `D={s+L,cD}`,
`Lo={s-1,cH}`, `H={s+L,cH}`, plus kColour supports at `s`, `s+1` (vacated by `cH`'s
low run) and `s+L-3` (vacated by `cC`'s run) — 6 tiles, all distinct.

*Why it's a genuine chain, not two puzzles sharing a grid:* `cC`'s run exists ONLY
because `cD` and `cH` both vacate the high end — remove either trap's short run and
`cC`'s tiles there need a group that no longer has three colours. The two traps are
load-bearing for each other through one shared reorganization.

*What is PROVEN (real output: `composed.verify.ts` **32/0**, `verifyEngine.ts` 44/0,
`decoy.verify.ts` 23/0, `redherring.verify.ts` 25/0, `tsc` clean):* on **25/25 builds
per difficulty** — (a)-(e), **OBVIOUS ×3** (decoy=25, lo=25, hi=25), **TRAP ×4**
(decoy-append, herring-high, herring-low, herring-extend-both — all dead, 25 each),
**HOME ×3** (25 each). Witness through the real DROP reducer == par with a
`validateGrid` win, 6/6 per difficulty. Deterministic par `= 3L + 6`: **hard L=6 →
par 24 (24 tiles, 8×9), extreme L=7 → par 27 (27 tiles, 9×10)** — the deepest tier
the engine ships, above decoy (22/25) and red herring (21/24).

*The COMPOSITION-SPECIFIC check neither prior session could run — the reduction risk
was real to test and came back clean, 25/25 both tiers:* with ONE trap correctly
resolved (that colour's genuine short run(s) committed and removed from the bag), the
remainder stays solvable AND the OTHER trap's obvious move is STILL a `solveBag`
dead end — herring-high dead=25, herring-low dead=25 after resolving decoy;
decoy-append dead=25 after resolving the herring. Also verified: resolving one trap
alone is NOT a `validateGrid` win (25/25). So progress on one deception never defuses
the other. Plus explicit collision checks (rack distinct, tile set distinct, goal is an
exact duplicate-free cover, goal cells distinct) — 25/25 both tiers.

*The L≥6 cap (measured, two independent reasons):* at L=5 the three kColour supports
land on `s, s+1, s+2` — three consecutive, a valid run on their own, breaking
invariant (c) — AND `decoy-c1-append dead=false`, i.e. the trap doesn't bite yet.
`buildComposedAt` rejects L<6. L=8 verifies clean (par 30, 10×11) and is available if
a deeper tier is ever wanted.

*Timing:* ~3.5 ms/build both tiers (hard avg 3.48, extreme avg 3.63) — deterministic,
no search. Higher than red herring's ~2 ms because each build runs FOUR `solveBag`
trap checks plus (b) plus `existsNoRelocationWin` over a 6-tile rack on a larger grid.
Still far under budget, no cliff.

*Emission (three disjoint bands, at most one layer per puzzle):* `COMPOSED_PROB` hard
0.12 / extreme 0.25, `DECOY_PROB` 0.20 / 0.30, `REDHERRING_PROB` 0.14 / 0.22. Measured:
composed ~15% / ~24%, decoy ~22% / ~32%, red herring ~14% / ~23%, base archetypes still
emitted at both tiers. Note the earlier band values were retuned mid-session: a first
pass (decoy 0.26/0.32, herring 0.18/0.22) made `redherring.verify.ts`'s "extreme rate >
hard rate" assertion statistically marginal and it failed 2 checks on one run — real
flakiness from too narrow a gap, fixed by widening rather than by loosening the test.

*Still open:* COUPLED still needs a contested-resource redesign (see
COUPLED_DESIGN.md), not just the mixed planner.

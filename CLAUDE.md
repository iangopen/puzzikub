# Puzzikub — CLAUDE.md
*Last updated: 2026-11-11 — main merged and deployed; branches `generator-audit` and `trap-variety` pushed, unmerged (see Current status).*

## Project overview
Rummikub-style clear-your-rack puzzle game on a free grid.
Stack: Vite + React + TypeScript, deployed to GitHub Pages.
Repo: https://github.com/iangopen/puzzikub.git

---

## CRITICAL: vite.config.ts
base must always be '/puzzikub/' — never change this, never remove it.

---

## Testing & verification workflow
- Local dev: `npm run dev` → http://localhost:5173/puzzikub/
- Live site: https://iangopen.github.io/puzzikub/
- Deploy: `npm run deploy` (builds + pushes dist/ to gh-pages branch)
  Changes are NOT live until this runs, even after `git push` to main.
- Correct order: git add/commit/push FIRST, then npm run deploy.
- Person reports bugs via: browser screenshots, browser console output,
  PowerShell terminal output (Windows environment).

### THE BUILD GATE — STANDING INSTRUCTION FOR EVERY SESSION
**The only build gate that counts is `npm run build` (= `tsc -b && vite
build`). Never substitute the narrower `tsc -p tsconfig.app.json`, and never
substitute bare `npx tsc --noEmit`.** Learned the hard way: the build stayed
BROKEN for several consecutive sessions after Step 1 added `Tile.id`, because
each session checked only a narrower target and reported "tsc clean". Two facts
make the narrow checks lie:
- Root `tsconfig.json` has `files: []` + project references, so `npx tsc
  --noEmit` alone typechecks **nothing** and always "passes".
- `tsc -p tsconfig.app.json` covers app sources but is not what `npm run
  build` runs, so it can pass while the real build fails.

`npm run build` is also the only check that exercises the Vite production
build itself. Run it before every commit that touches `src/`. And per the
ANTI-ILLUSION RULE below, a green build still proves only that the code
compiles — never that any logic is correct.

## Debugging protocol — MANDATORY

1. Read relevant files first. Never assume file contents.
2. Add temporary console.log, get real output, THEN fix.
3. Dynamic import() of .ts files does NOT work on deployed GitHub Pages.
4. ESCALATION RULE: if a bug survives one fix attempt, STOP patching.
   Diagnose first. State root cause explicitly. Then fix.
5. SESSION HEALTH: if a single prompt takes more than ~5 minutes of
   tool-call time, STOP it. Do not let a session run 10+ minutes or
   burn 40k+ tokens. Split into smaller single-file prompts instead.
   One fresh session per file change is the safe default for anything
   touching solver.ts, generator.ts, archetypes.ts, or validator.ts.
6. **ANTI-ILLUSION RULE — the most important one, added after repeated
   false "fixed!" reports:** `tsc --noEmit` passing is NOT evidence
   that logic is correct. It only proves the code is syntactically
   valid TypeScript — it says nothing about whether a solver returns
   the right answer, a generator produces a fair puzzle, or a bug is
   actually gone. Every claim that something "works" or "is fixed"
   MUST be backed by real executed output: run the code (via
   `npx tsx <file>`, a dev-only test block, or the running app),
   print real values, and report the actual printed output verbatim.
   A narrative summary ("verified successfully", "confirmed working")
   is not acceptable in place of pasted real output. This rule applies
   to every session touching src/lib/, not just the ones that
   originally motivated it.

---

## Model and effort selection

Not every session needs the strongest available model — match the
tool to the kind of work:

- **Strong reasoning model (Opus/Fable-tier) + plan mode**: genuine
  open-ended design work where a subtle mistake would be easy to make
  and hard to notice — e.g. designing the solver's DP transitions from
  scratch, designing a puzzle-construction algorithm that must satisfy
  several invariants simultaneously. Give these sessions the RULES and
  INVARIANTS, not a pre-written implementation — let the model design
  its own approach and require it to prove correctness with real
  executed test output (see Anti-illusion rule above) before reporting
  done.
- **Default model + auto mode**: mechanical work with no real design
  freedom — deleting superseded functions, wiring one function to call
  another, routing by difficulty, prop threading, styling. If a
  "mechanical" prompt starts inventing new algorithmic logic, that's a
  sign the task was mis-scoped as mechanical — stop and re-scope it as
  a design session instead.

---

## Architecture rules
- All game logic in src/lib/ — pure functions, zero React imports
- Components are presentational only; all state in hooks
- Drag: native mouse events (mousedown/mousemove/mouseup on document)
  NO HTML5 drag API, NO draggable attribute, NO ondragstart
- localStorage key: 'puzzikub_library'
- Styling: inline style={{}} props only — index.css for keyframes and
  CSS custom properties (theme vars) only
- Never import React hooks inside src/lib/

---

## m=2 ARCHITECTURE — CURRENT TRUTH (read this before any src/lib/ work)
*Consolidated at Step 12 close-out. **The m=2 migration is COMPLETE** (Steps
1-12). The dated step-by-step log further down is HISTORY, kept for its
rationale and measured numbers — where it disagrees with this section, THIS
SECTION WINS.*

### 1. The tile model
Every tile carries a stable identity, because `{n,c}` alone cannot tell the two
copies of a (value,colour) pair apart.
```ts
TILE_COPIES = 2                         // the copy count, named in ONE place
makeTile(n, c, copy = 0): Tile          // the ONLY way to mint a tile
Tile = { n, c, id }                     // id = `${n}_${c}_${copy}`, e.g. "5_r_0"
TileSpec = Pick<Tile,'n'|'c'>           // a tile REQUEST, no identity yet
```
**The id scheme is STRUCTURED, not opaque, and that is load-bearing.** Because
`id` is a pure function of `(n, c, copy)` it survives a JSON round-trip with no
remap table, which is exactly what let `storage.ts` migrate old id-less saves by
re-minting from `(n, c, occurrenceIndex)` — scanned grid row-major, then rack.
Do not replace it with a uuid or a global counter.

Rules that must not be broken:
- **Never construct a tile literal.** `{ n, c }` object literals are gone from
  `src/lib/`; always `makeTile`.
- **Components emit `TileSpec`, never `Tile`.** Only the editor hook can mint,
  because the copy index is puzzle-scoped. `TilePicker` deliberately cannot.
- **The editor caps at `TILE_COPIES`** (`src/lib/editorRules.ts`); a third copy
  is refused with a visible message, never silently dropped.
- **Ids are unique within a puzzle**, which is what makes `key={tile.id}` legal
  in `Rack.tsx`.

### 2. The solvers — and why there are two
```ts
solveBag(tiles)    // m=1: rejects ANY duplicate outright
solveBagM2(tiles)  // m<=2: the real oracle. assignment keyed by tile.id
```
`solveBagM2` is the m=2 partition oracle: per-colour state is an unordered pair
of saturating run lengths (10 states/colour); at each value it chooses 0-2
groups, then the remaining copies extend runs; bags with more than `TILE_COPIES`
of a label are rejected up front. Its `assignment` is keyed by **`tile.id`** —
the old `${n}_${c}` key collided on duplicates. ~0.01 ms/call.

**ALL production code calls `solveBagM2`.** `solveBag` is called by NO builder.

***`solveBag` IS DELIBERATELY NOT DELETED — do not "clean it up".*** It is kept
as an INDEPENDENT DIFFERENTIAL ORACLE. Every m=1-shaped bag is a strict subset
of what `solveBagM2` handles, so the two must agree on every duplicate-free bag,
and several harnesses check builds that way — a solver grading its own homework
would be worthless. That agreement is measured, not assumed (5,400 bags in the
Step 10a probe; re-checked live on every `verifyEngine` run, most recently
*150 duplicate-free generated puzzles, 0 disagreements*). Retire it only when no
harness needs an independent oracle. Note the cut-point archetype **cannot** use
it at all — `solveBag` rejects its bags outright, which is precisely the
NODUP proof that the archetype requires m=2.

### 3. The cost model (Step 6) — how par is computed
For a goal layout (an injective tile→cell map) the misplaced tiles form a
functional graph whose components are simple paths and simple cycles, so:
```
cost(goal) = boardTiles + rack − fixed(goal) − cycles(goal)
```
(a k-cycle unwinds in k−1 swaps; a k-path costs k). This holds for HETEROGENEOUS
layouts — windows may independently be runs or groups, in any mixture — because
it needs only one current cell and one target cell per tile.

**Under m=2 a goal is not fully determined by the window specs**, because a
window slot saying "red 4" can be filled by either copy. Therefore:
- `bindWindowTiles(windows, bag, pinned?)` binds each slot to a CONCRETE bag
  tile (never mints one); its default rule is **ascending id order**, chosen so
  the binding depends only on ids, not on bag/scan order.
- **`bindMinCostGoal(windows, grid, rack, cellOf)` is what builders should
  call.** It enumerates the 2^d copy-pairings for the `d` duplicate labels with
  **at least one copy on the board**, scores each with `mixedLayoutMoves`, and
  returns the CHEAPEST. Ties go to the ascending-id default, so a puzzle with no
  duplicates yields exactly one candidate and behaves identically to the
  pre-Step-6 code — which is why adopting it changed no shipped par.
- **Duplicates with BOTH copies in the rack are skipped** as provably free: a
  rack tile has no cell, so it can be neither `fixed` nor on a cycle.
- **The guard: `d > MAX_ENUMERATED_DUPLICATES` (6) THROWS `PairingBlowupError`**
  naming the offending labels. It is loud on purpose — silently degrading to a
  128-binding search would hide a construction bug behind a performance cliff.
  **The cut-point archetype sits at exactly d=6**, so lowering this constant
  breaks it; `cutpoint.verify.ts` pins the value.

Known scope limit, unchanged: par is exact for the goal family a builder aims
at, so it remains an **upper bound** on the true optimum over every conceivable
winning layout. Full-win BFS is infeasible at real tile counts. Player-facing UI
says "par", never "optimal".

### 4. The archetypes now shipping
| archetype | tiers | par | mechanic |
|---|---|---|---|
| `groups-to-runs` | all | 11/16/20/~24 | board = value groups, goal = colour runs |
| `runs-to-groups` | all | 11/16/20/23 | the mirror |
| `runs-to-groups-decoy` | hard, extreme | 22 / 25 (variants 19-23 / 22-27) | ONE tempting run-extension that dead-ends |
| `runs-to-groups-redherring` | hard, extreme | 21 / 24 (shipped: 20-24 / 27-32) | TWO tempting extenders, both dead ends |
| `runs-to-groups-composed` | hard, extreme | 24 / 27 (extreme also 31) | decoy + red herring on one board, coupled |
| `cut-point` | **medium only** | **12** | **duplicates force valid runs to be CUT APART** |
| `chain` | **medium only** | **9** | **a DEDUCTIVE chain: 8 forced deductions in sequence** |

`archetypeId` is internal only — nothing player-facing names the mechanic.
Dev-only `?forceArchetype=` accepts all of them (each still tier-restricted).
*The first par in each trap row is the ORIGINAL puzzle, still pinned by its own
harness; the bracket is what the `trap-variety` branch ships. See "Branch
`trap-variety`" under Current status.*

**The cut-point archetype is the payoff of this whole migration** — the first
construction that genuinely requires duplicate tiles. Board = one already-valid
run per colour; rack = second copies at interior values; the player must break
runs that already validate. Three facts fix its design, all measured:
1. **SPREAD cuts only, never ADJACENT.** The migration doc asked whether the
   two-run (adjacent duplicates) and three-run (spread) shapes should ship as
   one archetype or two. Neither: adjacent duplicates are **never uniquely
   solvable at any L≥10**, so only spread ships.
2. **Uniqueness IS the trap.** One colour admits no group, so every part of the
   answer is a run, and a uniquely-partitionable bag makes EVERY wrong cut
   fatal — a stronger trap than decoy/red-herring/composed, which each check a
   handful of specific commitments.
3. **At most TWO colour blocks, refused above that.** Two colours can never form
   a group, keeping the bag runs-only so solution counts multiply. A third
   colour enables groups and destroys uniqueness.

Its two caps are real and measured: **UI width** (`Board.tsx` is a fixed
`repeat(cols,46px)` grid with no responsive scaling — L=13 would reach par 16
but needs ~860px and would overflow) and **uniqueness-vs-par tension**, which
makes hard/extreme structurally unreachable. **Known limitation: par understates
this archetype** — par counts moves, but its difficulty is search.

### 4b. The CHAIN archetype — and the theorem that shapes it
**A chain mechanic failed TWICE here before. Read this before touching it.** The
deleted `buildDominoChain` modelled *"placing tile A physically pushes tile B out
of its set, which pushes C"*. That is impossible in this game, for two separate
reasons: the DROP reducer makes GRID→GRID an **unrestricted swap between any two
cells** (nothing is ever physically blocked), and its premise was a **misread
rule** — it assumed runs cap at length 4, but `isValidRun` has NO upper bound
(the 4-cap is `isValidGroup`'s, on colours). Nothing was ever pushed out. It also
punched holes in complete runs, so its boards failed `validateGrid` outright.

**The correct framing is a DEDUCTIVE chain**: moves may be executed in any order;
what is sequential is the REASONING.

***THE THEOREM (probed, not assumed) — it rules out the obvious formalisation:***
if a bag has a UNIQUE partition, a globally-reasoning solver determines every
tile's block in ONE step, because a second globally-consistent block for any tile
would itself extend to a second partition. **Deduction depth is therefore always
1 under global reasoning, so a chain cannot be defined that way.** The chain lives
in the LOCAL (myopic) model instead: a tile is determined when exactly ONE valid
set containing it can still be formed from the remaining bag, ignoring whether
the remainder stays solvable. That is how a player actually reasons, it is fully
computable, and it is SOUND — the true partition is always among the locally
possible sets, so a locally-forced deduction is always correct.

**The LADDER.** Alternating run → group, where each block consumes a *hinge* tile
that collapses the next block's options. Each run colour also owns a tile at the
previous hinge; that extra tile is exactly what keeps its run ambiguous until the
group there consumes it. `links=4` is the deepest the 13-value range allows
(hinges 3 apart): 24 tiles, unique partition, **cascade depth 8 with 7 genuine
steps** (a step counts as genuine only if the tile it determines had ≥2 candidates
at move zero). Every one of the 8 links is confirmed by real `solveBagM2` calls
showing the rival candidate sets are genuinely unsolvable.

**It is NOT "decoy with extra steps"** — measured, not asserted. Ambiguous tiles
fall **22 → 19 → 16 → 13 → 10 → 7 → 4 → 0** across the eight rounds: a gradual
cascade, not one insight that collapses everything. For contrast, every other
archetype stalls this cascade at depth 0 — myopic reasoning cannot even start on
them.

**Scope: m=1 deliberately.** Duplicates are not used even though the m=2
machinery exists — the concept does not need them, and stacking a twice-failed
mechanic onto new machinery would combine two risks for no benefit. An
m=2-enriched version is a natural lower-risk follow-up.

**Same low-par wall as cut-point, same structural cause:** a legal starting board
must be valid, and valid arrangements of these tiles are largely the goal blocks
± their hinge tile, so `fixed` is high and **par is 9** (verified as the true
minimum over every layout, not just the builder's choice). Difficulty here is
reasoning DEPTH, not move count — par understates it badly. Grid is 10×6, well
inside the `Board.tsx` width limit.

### 5. Open items
- **🐞 Library "Play" button is still BROKEN** (detailed note in
  `MIGRATION_M2_LOG.md`, Step 9).
  `App.tsx`'s `handlePlay(_puzzle)` discards its argument, so clicking Play on a
  saved puzzle shows a freshly generated one. **Deliberately still unfixed** —
  it is a real feature change (threading a puzzle into `PlayScreen`), its own
  session. It does NOT block playtesting: fresh puzzles and
  `?forceArchetype=` reach every archetype without touching Library.
- A responsive `Board.tsx` is the one straightforward future win — it would
  unlock cut-point at L=13 / par 16.
- COUPLED still needs its contested-resource redesign (`COUPLED_DESIGN.md`).
- `dup-test` may still sit in real `puzzikub_library` localStorage; delete from
  the Library screen when unwanted.

---

## Core types
See `src/types.ts` for the full definitions (Tile, Grid, Difficulty,
Screen, Puzzle, DragSrc, NUM_COLOR). Two non-obvious contracts not
expressed by the types themselves: `Puzzle.grid` is the starting board
— fully solved, NO gaps, ever; `Puzzle.optimalMoves` is computed from
construction, not searched.

**Full per-step migration history — `MIGRATION_M2_LOG.md`.** The dated Step 1-12
log, the build-unblock session, and the decoy / red herring / composed / coupled /
mixed-goal-planner design sessions live there verbatim, with every measured number,
timing and rationale. They are HISTORY: the sections above are the current truth.

---

## ENGINE ARCHITECTURE (src/lib/) — ground truth definitions

### The rule that matters most
**A puzzle is only valid to ship if the "obvious" move fails.** Every
prior generator version regressed to fill-in-the-blank because nothing
ever checked whether the naive placement wins. Whatever the exact
implementation, an `isTrivial`-equivalent gate must exist and must
actually reject puzzles where it fails — verified by generating real
puzzles and checking real counts, not by inspecting the construction
logic and assuming it's fine.

### Two failure modes actually observed in production (screenshots)
Any construction approach must be checked against both of these —
they are not hypothetical:

1. **Fill-in-the-blank**: board shows sets with visible gaps, rack
   tiles are exactly the missing pieces, each obviously belonging to
   one slot. E.g. board "6b 7b _ 9b 10b", rack "8b".
2. **Free-standing rack**: board is fully valid and untouched, but the
   rack tiles form a complete valid run/group entirely on their own
   (e.g. a full run of one color). Player places rack as a new row,
   never touches the board. E.g. rack "4,5,6,7,8" of one color.

### Solver (src/lib/solver.ts)
```ts
export interface SolveResult {
  solvable: boolean
  assignment?: Map<string, 'run' | 'group'>
}
export function solveBag(tiles: Tile[]): SolveResult    // m=1, oracle only
export function solveBagM2(tiles: Tile[]): SolveResult  // m<=2, USE THIS
```
Job: given a flat bag of tiles (no grid position), can they be
partitioned into valid runs/groups using every tile? Reference: van
Rijn, Takes, Vis, "The Complexity of Rummikub Problems"
(arXiv:1604.07553) — proves this is O(n) via DP for fixed k=4 colors,
m=1 copy, n=13 values.

**Post-migration: `solveBagM2` is the real oracle and the one all production
code calls; `solveBag` is kept ONLY as an independent differential oracle for
the harnesses. See "m=2 ARCHITECTURE" §2 above for the full rationale — do not
delete `solveBag`, and do not call it from a builder.** `solveBagM2`'s
`assignment` is keyed by `tile.id` (the old `${n}_${c}` key collided on
duplicates).

Known correctness requirements (verify with real executed test cases,
per the Anti-illusion rule, not by reading the code):
- `solveBag([])` must return `solvable: false` — an empty tile universe
  is never a valid puzzle. (A naive DP base case often gets this wrong
  by returning true when there's nothing to fail on — check explicitly.)
- `assignment` must be populated when solvable, mapping each tile to
  whether it landed in a run or a group — needed for `optimalMoves`
  and any goal-layout construction downstream.

Do NOT use solveBag as part of the live win condition — that's
validateGrid's job (below). A bag being partitionable in theory doesn't
mean the tiles are correctly positioned on the current grid. Conflating
these caused a real bug where placing tiles anywhere on the board
counted as a win.

### Validator (src/lib/validator.ts) — correct as of last audit
```ts
export function isValidRun(tiles: Tile[]): boolean
export function isValidGroup(tiles: Tile[]): boolean
export function validateGrid(grid: Grid): boolean
export function getInvalidCells(grid: Grid): Set<string>
export function getNewlyValidCells(prevGrid: Grid, newGrid: Grid): Set<string>
```
**Coverage is HORIZONTAL-ONLY** (corrected in the generator-audit session by
reading `validator.ts`; this section used to say "either direction", which the
code has not done for a long time): a tile is valid only if its maximal
contiguous segment within its own ROW is a valid run or group of length ≥3.
Vertical adjacency means nothing. Win condition: `rack.length === 0 && validateGrid(grid)` —
no bag-based fallback, ever.

### Generator + Archetypes (src/lib/generator.ts, src/lib/archetypes.ts)
**The exact construction algorithm is intentionally not dictated here**
— it's an open design problem, solved by whichever session designs it,
and re-verified independently by the harness (below) rather than
trusted from the design session's own report. What IS fixed, as
non-negotiable invariants any construction must satisfy:

1. `validateGrid(startBoard) === true` before any rack tile is placed.
2. `solveBag([...boardTiles, ...rack]).solvable === true`.
3. The rack (or any subset of it, size ≥3) does not form a valid run
   or group on its own.
4. Placing every rack tile at its single most "obvious" spot, with no
   board tile moved, does NOT produce a valid grid.

A known-good building block (available as a tool, not mandatory): an
N×L grid of tiles (N colors, L consecutive values, N∈{3,4}, L≥3)
decomposes validly both as N runs (rows) and as L groups (columns) —
same tiles, two structures. This is Latin-rectangle row/column duality
applied to Rummikub. Whoever designs the construction may use this,
extend it, combine multiple blocks, or use a different approach
entirely, provided the four invariants above hold and are verified
with real generated output.

`optimalMoves` should be computed directly from how the puzzle was
constructed (the builder knows how many tiles must move), not
recovered later via search.

### Verification harness (src/lib/verifyEngine.ts)
A standalone script, run via `npx tsx src/lib/verifyEngine.ts` (no
build step, no test framework dependency). Independently re-checks the
four invariants above against real generated puzzles, per difficulty,
and prints real pass/fail counts. This is not a one-time step — re-run
it after any change to solver.ts, generator.ts, or archetypes.ts, and
treat its printed terminal output (pasted in full, not summarized) as
the actual source of truth for whether the engine works. A session
that changes the generator and reports success without this file
being re-run and its raw output reviewed has not actually demonstrated
anything, per the Anti-illusion rule.

---

## Game state (src/hooks/usePlayState.ts) — unchanged, correct
```
loadPuzzle(p): grid=deepCopy(p.grid), rack=[...p.rack],
  initialState.current = deepCopy for reset()
drop(target): snapshot history, RACK→GRID / GRID→GRID / GRID→RACK,
  moves++, if rack.length===0: validateGrid → won or getInvalidCells
reset(): restore from initialState.current (NOT history[0])
undo(): pop history, won=false, clear invalidCells
```
Win condition: `rack.length === 0 && validateGrid(grid)` only.

---

## Drag system — CRITICAL RULES, NEVER VIOLATE
Plain mouse events + plain touch events, as two explicit paths sharing one
core. **NO HTML5 drag API, NO draggable attribute, NO Pointer Events, NO
setPointerCapture** — the capture model was abandoned here after real pain and
must not come back; unifying mouse and touch via Pointer Events would reinstate
it, which is exactly why the touch path is written separately.

Drop-target detection differs by input, deliberately:
- **mouse** — `onMouseEnter`/`onMouseLeave` on cells, as always.
- **touch** — `document.elementFromPoint` during `touchmove` ONLY, resolved via
  `.closest('[data-cell],[data-rack]')`. Touch has no `onMouseEnter` analogue
  because of implicit capture (below). Never hit-test at `touchend`.

Both paths then read the SAME accumulated `hoverTargetRef` at drop time.

*Two claims that used to live here were FALSE and were removed (verified by
reading the files, and corrected in the touch-drag session):* there is no
`data-nodrag` attribute anywhere in `src/` and never was, and `main.tsx` has no
mousedown/`[data-nodrag]` guard. **`main.tsx` is 12 lines and contains exactly
one global listener — capture-phase `dragstart` → `preventDefault`.** Do not
"restore" the mousedown guard or the `data-nodrag` attributes; they are phantom
code. Mouse-drag text selection is suppressed by `preventDefault()` inside
`startDrag` plus `user-select: none`, which is sufficient and is what actually
ships.

---

## MOBILE / TOUCH — COMPLETE. Touch drag is implemented, verified, and shipping.
*Two sessions after the CHAIN archetype: (1) groundwork — scroll container,
board scale, touch-action split; (2) the touch drag itself. Both UI-only:
nothing in `src/lib/` changed behaviourally, whole harness suite unchanged.*

**The game is now playable by touch end to end.** A finger on a tile drags it;
a finger on empty space pans the board. Both were verified with real dispatched
touch events, including the failure modes that make touch hard (compatibility
mouse events, touchcancel, multi-touch).

### THE TOUCH-ACTION SPLIT — the contract the next session depends on
Panning and tile-dragging need NO competing gesture code, because they are
separated by WHERE the touch starts. This is CSS only, and it is already in
place:

| element | `touch-action` | why |
|---|---|---|
| occupied board cell (`Board.tsx`) | `none` | reserved for DRAG — lets a future touchstart drag without the browser stealing the gesture for a scroll |
| rack tile (`Rack.tsx`) | `none` | same |
| empty board cell (`Board.tsx`) | `auto` | nothing to drag here — pans natively |
| board scroll container | `pan-x pan-y` | the scroller itself |
| board background/padding | `pan-x pan-y` | empty space |
| rack background | `pan-x pan-y` | empty space |

***Never set `touch-action: none` on the container or on empty cells*** — that
kills native panning and makes wide boards unreachable on touch. Verified from
COMPUTED styles, not from source: all six values above were read back with
`getComputedStyle` in a real Chrome.

### BOARD SCALE — real pixel dimensions, NEVER `transform: scale()`
Presets **50% / 75% / 100% / 125%**, default 100%, persisted at
`localStorage['puzzikub_board_scale']` (same pattern as background/tileStyle;
validated on read, unknown values fall back to 100%). All derived sizes come
from `tileMetrics(scale)` in the new **`src/lib/boardScale.ts`** (pure module,
no React) and are threaded as an optional `scale` prop — defaulting to 1 — into
`Board` / `Rack` / `TileFace` / `DragPreview`. `EditorScreen` renders its own
tiles and is deliberately untouched.

***The transform-vs-resize question was decided by measurement, and resize
wins for two independent reasons:*** (1) a transform does not change LAYOUT
size, so the scroll container would keep reserving the full unscaled width —
scaling down would not actually make the board fit, which is the entire point;
(2) `DragPreview` is `position: fixed` off `clientX/clientY` and so lives
OUTSIDE any board transform — it would render unscaled over a scaled board.
Resizing keeps layout, hit-testing and the preview in one coordinate system,
which is why **the existing mouse drag math needed no changes at all**.
`getComputedStyle(...).transform === 'none'` is asserted at every scale.

### ⚠️ `justify-content: safe center` — a real bug, caught by measuring
The scroll container centres the grid. With plain `center`, an overflowing flex
container pushes **half the overflow past the LEFT edge where scrolling cannot
reach it**: the 12-column cut-point board on a 390px viewport reported
`scrollWidth` **500 instead of 650** and a **150px pan range instead of 300px**
— the first three columns were permanently unreachable. `safe center` falls back
to start-alignment exactly when centring would overflow. **Do not "simplify" it
back to `center`.** Note also that the inner grid is a flex item now, so CSS
blockifies `inline-grid` → `grid`; the source says `grid` to match.

### Measured board fit (the numbers that motivated this)
Boards run 6-12 columns = `cols*46 + (cols-1)*6 + 32` = **338px-650px** at 100%,
against ~350px usable on a typical phone. Confirmed against the real widest
board (`?forceArchetype=cut-point`, 8×12) on a 390px viewport:
```
  100%  board 650px  scrollWidth 650  pan range 300px  both edges reachable
   50%  board 325px  fits with NO scrolling (325 < 350 available)
```
So **50% is what makes the widest board fit a phone outright**; scrolling covers
every case in between. 50% is the reason the preset list starts below 75%.

### Verification (real executed output)
*HISTORICAL — this was the groundwork session's own run, with a rig that was
later LOST (never committed). The current, re-runnable evidence is
`npm run verify:mobile`: see "THE BROWSER VERIFICATION RIG" below. The ~220ms
settle mentioned here is also obsolete — the `hoverTargetRef` fix removed it.*

The Chrome extension was NOT connected this session, so the browser checks were
driven over **CDP directly from Node** (Node 24 has a global `WebSocket`, so
this needed no new dependency) — launch headless Chrome with
`--remote-debugging-port`, then `Runtime.evaluate` + `Input.dispatchMouseEvent`.
CDP input events drive React's `onMouseEnter` naturally, so the drop-target
detection works without the extension's stale-`hoverTarget` workaround — though
the ~220ms settle before `mouseReleased` is still required, for the same reason
documented in the Step 12 method note.
```
MOBILE-GROUNDWORK CHECKS: 33 passed, 0 failed
  default 100% = the original 46x58, no visual change from before
  touch-action: all six computed values exactly as tabled above
  tile sizes 23/35/46/58 wide, 29/44/58/73 tall; transform 'none' at every scale
  DRAG+DROP completed at 0.75 / 1 / 1.25 — dragged tile lands in the target
    cell, rack shrinks by exactly 1, move counter increments (real CDP mouse)
  settings pill click -> persists 0.75 -> board re-renders at 35px immediately
WIDE-BOARD CHECKS: 15 passed, 0 failed   (cut-point 8x12 on a 390px viewport)
  drag+drop still completes on the wide board at 50% on a phone viewport
```
*Two failures during the run were TEST bugs, worth knowing if the rig is reused:*
`cursor` is an INHERITED property, so filtering on `cursor === 'grab'` counts
each rack tile twice (wrapper + `TileFace`); and on a fresh browser profile the
**first-run Tutorial modal overlays the board and swallows drops** — set
`localStorage['puzzikub_seen_tutorial']` first.

*Engine untouched, full suite re-run:* `verifyEngine` **53/0** + invariants
(a)-(d) · `decoy` **23/0** · `redherring` **25/0** · `composed` **32/0** ·
`cutpoint` **36/0** · `chain` **28/0** · `mixedGoalPlanner` **37/0** ·
`pairingMin` **31/0** with all seven par numbers EXACT · `storage` **37/0** ·
`dragIdentity` **29/0**. `npm run build` clean (`107 modules transformed`).

---

## THE TOUCH DRAG — how it works, and the five traps it had to survive
*Session 2 of the mobile arc. Files: `useDrag.ts`, `PlayScreen.tsx`,
`Board.tsx`, `Rack.tsx`, `DragPreview.tsx`, `index.css`.*

### Structure: ONE core, TWO thin wrappers
```ts
startDragAt(tile, src, x, y, pointer, touchId?)   // shared core — the only new logic
startDrag(e, tile, src)                            // mouse wrapper, behaviour UNCHANGED
startDragTouch(e, tile, src)                       // touch wrapper, NO preventDefault
```
`updatePos`, `endDrag`, `drop()` in `usePlayState`, and every Board/Rack/
TileFace/DragPreview render path were **already coordinate-based and were reused
verbatim** — confirmed by reading, not assumed. Nothing was duplicated.

`startDragTouch` deliberately does **not** call `preventDefault`: scroll
suppression is `touch-action: none` on tiles (the groundwork contract), not JS.

### Trap 1 — implicit capture. Touch has no `onMouseEnter`.
Every `touchmove`/`touchend` after `touchstart` dispatches to the **ORIGINAL**
element regardless of where the finger is. So the touch path hit-tests with
`document.elementFromPoint(...)` **during `touchmove` ONLY**, resolved through
`.closest('[data-cell],[data-rack]')`. `data-cell="r,c"` is on **both** Board
branches (occupied and empty) and `data-rack` on the rack container — these were
added this session; cells previously had only React keys.

***The drop NEVER hit-tests.*** Both inputs commit the LAST hover recorded
during movement, via one shared `commitDrop`. Hit-testing at `touchend` would
diverge from the mouse path and is unreliable anyway — a finger lifted a pixel
outside a cell would silently drop nowhere.

### Trap 2 — React attaches touch listeners as PASSIVE
`touchmove`, `touchend` **and** `touchcancel` are native
`document.addEventListener(..., { passive: false })` calls, mirroring the
existing mouse effect. **A `preventDefault()` inside a React `onTouchMove`
silently does nothing** (React 17+ registers root touch listeners as passive).
`onTouchStart` is fine as a React prop — it never needs `preventDefault`.

### Trap 3 — compatibility mouse events (the highest-risk item)
After `touchend`, browsers synthesise `mousedown`/`mousemove`/`mouseup`/`click`
at the same coordinates. Unguarded, one tap-drag fires the drag logic TWICE.
`touchEndedAtRef` records the touch-drag end and mouse input is ignored for
`TOUCH_MOUSE_SUPPRESS_MS` (500). The mouse effect is additionally scoped to
`drag.pointer === 'mouse'` so a synthetic `mouseup` can never end a touch drag.
**Not solved with Pointer Events** — that reinstates the `setPointerCapture`
model this project abandoned.

### Trap 4 — `touchcancel` (system gesture, notification, incoming call)
Without it `endDrag()` never runs and `document.body`'s `userSelect`/`cursor`
stay mutated forever with the preview stranded on screen. Its identifier check
is deliberately **LOOSER than `touchend`'s**: cancel if our finger is named in
`changedTouches` **OR** is simply no longer active, because browsers differ in
what a `touchcancel` carries (Chrome's CDP won't even accept touch points on
one). Being strict here risks the exact hang the handler exists to prevent.
`touchend` stays strict — there a wrong match would drop a tile.

### Trap 5 — multi-touch
`DragState.touchId` records the initiating `Touch.identifier`, and every later
event locates **that same identifier** in `touches`/`changedTouches`.
***Never index `touches[0]`*** — a second finger reorders those lists and the
drag would jump to the wrong finger. `changedTouches[0]` is correct in exactly
one place: inside `startDragTouch`, where that list holds only the finger that
just landed.

### ⚠️ The latent MOUSE bug fixed here too — `hoverTargetRef`
`PlayScreen`'s mouseup effect re-subscribed on `[drag, hoverTarget]`, so an
event arriving before React re-rendered read a **stale** hover target and
dropped on the wrong cell. That is the bug that forced a ~170-220ms settle in
earlier automated-drag sessions. Fix: `hoverTargetRef` is written
**synchronously** alongside `setHoverTarget` (state still drives rendering) and
`commitDrop` reads the **ref**. `hoverTarget` is out of the effect deps.
**Always write hover through `setHover` so the two cannot diverge.**
Measured: **8/8 rapid mouse drags with ZERO settle now land on the correct
cell**, where the settle used to be mandatory.

### Smaller items
- `DragPreview` lifts the tile **above** the finger on touch (`TOUCH_LIFT` 28px
  on top of the usual half-tile offset) — a fingertip contact patch is wider
  than a 46px tile and completely hides it at the mouse's dead-centre offset.
  Mouse offset is unchanged.
- `index.css` `*` rule gained `-webkit-user-select: none` (Safari/iOS still
  needs the prefix); tiles gained `-webkit-tap-highlight-color: transparent`.

### Verification — see "THE BROWSER VERIFICATION RIG" below
*The touch-drag session's original "26 passed, 0 failed" came from scripts that
lived in a temp scratch folder and were never committed — that evidence was
LOST, and for a while CLAUDE.md cited a number nothing could reproduce. The rig
was rebuilt and committed (next section); its numbers replace that one.*

### Still open
- **Real-device testing has STILL NOT happened — not on iOS Safari, not on any
  physical phone.** Everything above is Chrome's touch emulation via CDP, which
  dispatches genuine, trusted `TouchEvent`s through Chrome's real input pipeline
  (hit-testing, `touch-action`, native panning) but is not iOS Safari. The
  committed rig STRENGTHENS the emulated evidence; it does not change this fact. The likeliest real-device gaps are Safari's compatibility-event
  timing (the 500ms window is a judgement call, not a measured iOS value) and
  momentum-scroll interaction with the pan container.
- A responsive `Board.tsx` is now partly addressed — scale + scroll make L=13
  viable, though the cut-point L≤10 cap in `archetypes.ts` was NOT changed.
- The Library **Play** button bug is still open and still unrelated.


---

## THE BROWSER VERIFICATION RIG — committed, permanent, `npm run verify:mobile`
*Rebuilt in the session after touch drag, because the originals were lost.*
**`scripts/` is committed — do not rebuild it, run it.** Needs a local Chrome or
Edge (`CHROME_PATH` overrides; `HEADFUL=1` shows the window). No dependencies:
Node 24's global `WebSocket` speaks CDP; Vite's own `createServer` hosts the app.

```
scripts/lib/cdp.mjs            launch headless Chrome, CDP session, touch/mouse
                               dispatch, in-page event recorder
scripts/lib/app.mjs            dev server, openPlay(), DOM state reader, Checks
scripts/verify-mobile.mjs      groundwork: touch-action split, presets, persistence
scripts/verify-wide.mjs        cut-point 8x12 on a 390px phone: real touch panning
scripts/verify-touch.mjs       touch drag, compat guard, cancel, multi-touch, mouse
scripts/verify-mobile-all.mjs  what `npm run verify:mobile` runs (exit 1 on any FAIL)
```
Each `verify-*.mjs` also runs standalone (`node scripts/verify-touch.mjs`).

### Why these checks can be trusted — and the traps the rebuild hit
- **Every check asserts on what the PAGE RECEIVED, not only on what was sent.**
  An in-page recorder (capture + bubble listeners on `window`) logs each
  touch/mouse event's `isTrusted`, identifiers, `touches`, target, and whether
  the app's `preventDefault` took effect. A dispatch that never reached the app
  fails instead of passing vacuously.
- **Mutation-tested.** Four deliberate breakages of `PlayScreen.tsx` were each
  CAUGHT (then reverted, never committed): `findTouch` returning `list[0]` ->
  multi-touch FAIL (preview jumped 412px to the wrong finger); compat guard at
  0ms -> moves 0->2, a double action; no `touchcancel` listener -> body styles
  stuck at `none`/`grabbing`; `touchmove` listener `passive: true` ->
  preventDefault effective on 0/10 touchmoves. *Not mutation-tested:* the
  `hoverTargetRef` stale-target fix (the 8/8 zero-settle check exercises it but
  was not shown to fail without it).
- ***CDP `touchEnd` lists the finger(s) being LIFTED*** — the opposite of the
  intuitive reading. The first draft sent the *remaining* fingers and Chrome
  lifted exactly those: "lift finger 2" released finger 1, which would have made
  the multi-touch test lift the wrong finger. The driver self-check (section 0
  of verify-touch) re-proves this contract on every run. `touchCancel` still
  needs an EMPTY `touchPoints` array.
- Chrome orders `touches` by identifier, so the multi-touch test uses ids 7
  (dragging) and 3 (intruder): the intruder genuinely lands at `touches[0]`.
- **Seed `localStorage` only AFTER the app has mounted.** React commits after the
  `load` event and `App`'s mount effect writes the scale it read back to
  storage, so seeding on `load` was silently overwritten with the previous run's
  value — every preset then "measured" the wrong scale.
- Measure tile sizes with `offsetWidth`/`offsetHeight`: the `tile-land` keyframe
  (`scale 0.85 -> 1.05 -> 1`) makes `getBoundingClientRect` read ~47.6px mid-flight.
- cut-point's rack is second copies, so no rack tile is unique by
  `number|colour`; wide-board drops are asserted via board copy counts.
- `?forceArchetype=cut-point` renders NO board until "medium" is clicked (the
  screen mounts on easy, where the forced build deliberately fails).
- Headless Chrome emits NO compatibility mouse events after a CDP touch, so the
  compat test dispatches the mouse sequence itself; the recorder confirms it
  reached the tile 53ms after touchend, inside the 500ms window.

### Result (real executed output, `npm run verify:mobile`)
```
MOBILE-GROUNDWORK  42 passed, 0 failed
  default 46x58; all six touch-action values via getComputedStyle; at each of
  50/75/100/125%: tile, rack tile, empty cell = 23x29/35x44/46x58/58x73 LAYOUT
  size, board width = cols*w+gaps+padding, transform "none" on scroller/grid/
  cell/tile/rack tile, drag preview same size, TOUCH drag lands; MOUSE drag at
  75/100/125%; "75%" pill stores 0.75, re-renders at 35px, survives reload;
  stored "0.6" / "garbage" / "" fall back to 46px
WIDE-BOARD         24 passed, 0 failed
  cut-point confirmed via console, 8x12, scrollWidth 650, client 350, pan 300;
  column 0 fully visible at scrollLeft 0 (safe center); REAL touch swipes on the
  board background pan to scrollLeft 300 (col 11 visible) and back to 0; a swipe
  from an empty cell pans; a swipe from a TILE does not pan, it drags; rack tile
  touch-dropped into column 11 after panning; 50% has no overflow, all 12
  columns visible, touch drop into column 11
TOUCH-DRAG         54 passed, 0 failed
  0 driver self-check: trusted events, ids, lift semantics, touches order
  1 rack->board: 1/10/1 trusted events; implicit capture shown (every touchmove
    targets the rack); preventDefault effective 10/10; preview lifted (bottom
    150 vs finger 178); tile in cell, rack 2->1, moves 0->1, styles restored
  2 board->board  3 swap (one move)  4 board->rack
  5 COMPAT: mouse 53ms after touchend reached the tile and changed NOTHING;
    after the window the same mouse drag works (moves 1->2); tap+click no-op
  6 touchcancel: "none"->"", "grabbing"->"", preview gone, no drop, not wedged
  7 MULTI-TOUCH: touches=[3,7]; preview stayed on finger 7 (0.0px off, 412px
    from the intruder); lifting 3 dropped nothing; tile landed at finger 7's
    target; decoy empty; exactly ONE move
  8 MOUSE regression (desktop): rack->board, swap, board->board, board->rack,
    Undo restores exactly, no page exceptions
  9 8/8 ZERO-settle mouse drags landed on the correct cell
```
*`src/` untouched by the rig session — all ten harnesses re-run:* `verifyEngine`
**53/0** + invariants (a)-(d) · `decoy` **23/0** · `redherring` **25/0** ·
`composed` **32/0** · `cutpoint` **36/0** · `chain` **28/0** · `mixedGoalPlanner`
**37/0** · `storage` **37/0** · `dragIdentity` **29/0** · `pairingMin` **31/0**,
all par numbers EXACT. `npm run build` clean (107 modules).

---

## Theme system, Audio, Visual effects — unchanged, working
Five presets (minimalist/glass/wood/neon/paper) via src/lib/themes.ts +
TileFace.tsx. Web Audio synthesis in src/lib/audio.ts. Keyframes in
index.css. No changes needed to these systems.

---

## File responsibilities
```
src/lib/solver.ts         solveBagM2 (real oracle) + solveBag (differential only)
src/lib/validator.ts      DONE — duplicate-safe as-is, do not modify without cause
src/lib/mixedGoalPlanner.ts  cost model: mixedLayoutMoves + bindMinCostGoal
src/lib/archetypes.ts     puzzle construction — all six builders
src/lib/editorRules.ts    pure editor rules: usedIds / mintTile, TILE_COPIES cap
src/lib/storage.ts        save/load + legacy id-less blob migration
src/lib/generator.ts      routes generatePuzzle(diff) to archetype builder(s)
src/lib/difficultyProxy.ts   non-par difficulty proxies (solution count, technique
                             ladder, ...) + partitionCount, used by the
                             runs-to-groups uniqueness gate
src/lib/generatorAudit.ts    `npx tsx src/lib/generatorAudit.ts 200 [filter]` —
                             the tables in GENERATOR_AUDIT.md (~10 min unfiltered)
```
**Browser checks — `npm run verify:mobile` (120 checks: mobile 42, wide 24,
touch 54). Re-run after ANY change to Board/Rack/DragPreview/TileFace/useDrag/
PlayScreen/App or index.css.** See "THE BROWSER VERIFICATION RIG".

**Harnesses — run with `npx tsx <path>`. Re-run ALL of them after any
`src/lib/` change; there is no test framework, these ARE the tests:**
```
src/lib/verifyEngine.ts             53  (NOTE: not *.verify.ts — easy to miss
                                         in a loop over *.verify.ts files)
src/lib/decoy.verify.ts             23
src/lib/redherring.verify.ts        25
src/lib/composed.verify.ts          32
src/lib/cutpoint.verify.ts          36
src/lib/chain.verify.ts             28
src/lib/mixedGoalPlanner.verify.ts  37
src/lib/pairingMin.verify.ts        31   (~9 min — BFS-bound, run it in
                                          the background and keep working)
src/lib/storage.verify.ts           37
src/lib/dragIdentity.verify.ts      29
src/lib/trapVariants.verify.ts     118   (every shipped trap/chain VARIANT: proof,
                                          invariants, replay, pinned par, and
                                          four broken variants that must fail)
src/lib/valueGroupPlanner.verify.ts 29   (~6 min — 30 exhaustive L=8 boards;
                                          run it in the background.
                                          planValueGroupGoal vs its exhaustive
                                          original; pins runs-to-groups par
                                          11/16/20/23)
```

---

## Current status (update this after each session)
### Branch `trap-variety` (2026-11-11, off `generator-audit`) — pushed, NOT merged, NOT deployed
Variety and difficulty changes: play this branch before merging. Numbers and
method are in **`GENERATOR_AUDIT.md` §7**.

**Real and verified on that branch:**
- **One core per trap layer, taking a variant.** `buildDecoyAt(L, variant?)`,
  `buildRedHerringAt`, `buildComposedAt`; with no variant each builds the
  ORIGINAL puzzle, so the old harnesses and pars (22/25, 21/24, 24/27) are
  untouched. `buildXVariant(diff)` draws a random shipped variant and is what
  `generator.ts` calls. `proveXAt(L, variant)` returns the named proof steps.
- **Every build proves itself**: invariants (a)-(d), each tempting tile visibly
  extends a run, every tempting commitment AND every combination of them is a
  dead end (`solveBagM2`), exactly one partition, goal reached with a witness.
  ***The variant tables (`DECOY_FILLERS`, `HERRING_SHIPPED`, `COMPOSED_SHIPPED`)
  only list what a probe measured as passing. Do not add an entry without
  running `proveXAt` on it*** — arguments do not transfer between variants.
- **Shapes per 200 puzzles** (up to value shift and colour relabel): decoy
  3 → 30 / 46, red herring 3 → 18 / 35, composed 6 → 18 / 36, chain 6 → 192.
  Chain has only 2 genuinely different ladders (ascending, mirrored); the rest
  is board-row order.
- **Red herring at extreme ships only L=7/8 with a middle filler**: technique
  level L2 on 200/200 (was L1). **Deliberate par recalibration: extreme red
  herring 24 → 27-32.** At hard it cannot be lifted above L1 (no filler fits at
  L≤6), so its band went 0.14 → 0.08.
- New variant pars are pinned in `trapVariants.verify.ts` (decoy 19-23 / 22-27,
  composed extreme 27 or 31, chain 9 in both directions).
- **Rows are never staggered** — Ian had a staggered layout removed. Every row
  starts at column 1; the harness asserts it.
- `planValueGroupGoal` is now compared against the exhaustive planner on 30
  boards each at L=7 and L=8 (0 mismatches).
- Retrying harnesses print their builder rejection rate; the audit has a
  "builder rejections" column (`generationStats` in `generator.ts`).
- Force types added: `decoy-classic|mirror`, `red-herring-classic|split`,
  `composed-classic|mirror|third`, `chain-classic|mirror`.
- Harnesses: twelve, 478 checks, 0 failures; `npm run build` clean;
  `verify:mobile` 120/0; shipped p95 23 ms (hard) / 42 ms (extreme).

**Still open:** red herring hard and composed hard stop at 18 shapes (reaching
25 means admitting L=7 into hard — one line, not done because it is bigger than
anything else in the tier); no L2 red herring small enough for hard; and the
rest of `GENERATOR_AUDIT.md` §5 (a deduction-chain-plus-trap layer, groups-to-
runs having 2/16/81 solutions, medium calibration). Nothing here has been
played by a person.

### Branch `generator-audit` (2026-11-11) — pushed, NOT merged, NOT deployed
Difficulty changes are a feel judgement: play this branch before merging it.
Full numbers, method and the ranked open leads are in **`GENERATOR_AUDIT.md`**.

**Real and verified on that branch (all runs-to-groups):**
- `planValueGroupGoal` no longer searches L! value orders. Only the values
  assigned to goal rows that hold a board tile can change the cost, so it tries
  `L!/(L−k)!` ordered choices (k = occupied rows). Same minimum, proven against
  the kept `planValueGroupGoalExhaustive` on 556 boards. L=7 build 1.1-1.3 s →
  ~42 ms; shipped hard p95 1197 → 54 ms, extreme p95 1128 → 79 ms. ***Do not
  delete `planValueGroupGoalExhaustive`*** — it is the differential oracle,
  the same role `solveBag` plays.
- **Uniqueness gate.** `buildRunsToGroupsAt` rejects a build whose bag has more
  than one partition. 29% of easy builds had a cheaper solution that left three
  short runs in place; now 100% unique. Consequence: the builder returns
  `null` on ~30% of easy draws, so anything sampling it must retry
  (`verifyEngine` and `pairingMin` were changed to retry for this reason).
- **Deliberate par recalibration: extreme runs-to-groups is L=8 / rack 5 /
  par 23** (was L=7 / par 20, identical to hard). 10×10 grid. No other par moved.
- Harnesses: eleven, 358 checks, 0 failures; `npm run build` clean;
  `verify:mobile` 120/0.

**Measured but NOT changed (ranked in GENERATOR_AUDIT.md §5):** trap layers have
only 3-6 structural shapes; red herring needs only stranding (L1) on the
technique ladder, weaker than plain easy runs-to-groups; groups-to-runs has
2/16/81 solutions at medium/hard/extreme; medium mixes technique levels 0-3 and
par 9-16; no archetype combines a forced deduction chain with a trap. The
proxies are structural and have not been checked against a human solver.

### Status as of 2026-11-11 — merged and deployed
- **`main` now contains everything:** m=2 migration, the chain archetype, mobile
  groundwork, touch drag and the verification rig (`mobile-touch-groundwork` was
  fast-forwarded into `main`). Both are pushed to `origin`, which is the renamed
  `iangopen/puzzikub` account.
- **Deployed:** https://iangopen.github.io/puzzikub/ serves the `main` build.
  The index and its JS/CSS assets all returned 200.
- Gate at merge: `npm run build` clean (107 modules), all ten harnesses at their
  recorded counts (331/0, all seven par numbers EXACT), `verify:mobile` 120/0.
- **Still open:**
  - iOS Safari / real-device touch testing has never been done. All touch
    evidence so far comes from Chrome CDP emulation.
  - The Library Play bug (`handlePlay` in `App.tsx` discards its argument).
  - Library and Editor have not been re-verified in a browser since the m=2
    storage and id changes. Only the `storage` harness covers them.
  - Parked engine items: COUPLED redesign (`COUPLED_DESIGN.md`), the cut-point
    L≤10 cap now that the board scales, a par metric for deduction archetypes,
    and `planValueGroupGoal`'s O(L!) wall.
- The local `m2-migration` branch is 17 ahead of its origin copy, but every one
  of those commits is already in `main`. It was left untouched.

*(Historical note below: the m=2 migration has since been merged into `main`.)*
**The m=2 migration is COMPLETE (Steps 1-12), on branch `m2-migration`, NOT yet
merged to `main` — merging is a deliberate review decision, not automatic.**
All ten harnesses green (331 checks, 0 failures), all par numbers exact,
`npm run build` clean, and a cut-point puzzle has been played to a real
`validateGrid` win in a browser at exactly par. Read "m=2 ARCHITECTURE —
CURRENT TRUTH" at the top of this file before touching `src/lib/`.

Seven archetypes ship: `groups-to-runs`, `runs-to-groups`, the trap layers
`decoy` / `redherring` / `composed` (hard+extreme), and the two MEDIUM-only
deduction layers `cut-point` (par 12) and `chain` (par 9). The two medium layers
share one probability roll so they stay disjoint.

**Both deduction archetypes are structurally LOW-PAR** (9-12 vs medium's base
16) for the same reason: a valid starting board is necessarily close to the
goal, so `fixed` is high. Their difficulty is reasoning, not move count. If par
ever needs to represent them better, that is a difficulty-metric change, not a
construction bug.

Known open, deliberately: the Library **Play** button (`App.tsx` `handlePlay`
discards its argument) — does not block playtesting, since `?forceArchetype=`
and fresh generation reach every archetype.

**The move model — do not re-derive.** usePlayState's DROP reducer,
GRID→GRID branch, drops a grid tile onto an OCCUPIED cell by SWAPPING
the two, in a single move; Board.tsx fires onCellEnter on occupied
cells, so players can reach it. One move therefore relocates one tile
(empty target) or two (occupied target). Every cost/move-count claim in
src/lib/ depends on this.

`optimalMoves` = `planColorRunGoal()` in archetypes.ts. For a goal
layout (injective tile→cell), the misplaced board tiles form a
functional graph whose components are simple paths and simple cycles, so

    cost(goal) = boardTiles + rack − fixed(goal) − cycles(goal)

(a k-cycle unwinds in k−1 swaps; a k-path costs k). One O(tiles) cycle
decomposition per candidate layout, minimised over the 4! colour→row
permutations × row/column placement — ~1ms on an extreme puzzle.
Verified against real move-BFS on 265 instances (0 mismatches, incl.
3- and 4-cycles) and by simulating the real reducer on 5 puzzles per
difficulty (simulated count == optimalMoves, every run ends in a
validateGrid win).

Known scope limit: this is exact for the goal family the builder aims
at, i.e. it remains an *upper bound* on the true optimum over every
conceivable winning layout. Full-win BFS is infeasible at real tile
counts (11-28), so global optimality is not proven and must not be
claimed. Player-facing UI calls it "par", never "optimal".

**Two archetypes, both shipping, chosen ~50/50 per puzzle.**
- `groups-to-runs`: board = L horizontal groups (4 colours × one value
  per row); goal = 4 runs. Rack = boundary values s-1 / s+L.
- `runs-to-groups`: the mirror. Board = 3 horizontal runs (one colour
  per row, L consecutive values); goal = L groups. N is forced to 3
  because isValidGroup caps at 4, so the rack must be the whole 4th
  colour, at values *inside* the block and never 3 consecutive.

`planColorRunGoal` / `planValueGroupGoal` share one cost core
(`makeCostCtx`); each returns null on the other's tiles, which is what
makes invariant (e) a real check rather than a shape assumption.
`existsNoRelocationWin`, `formsValidSetAlone` and `obviousSpots` are
orientation-agnostic (they test run OR group) and are reused unchanged.

**RESOLVED (session after the above note):** `runs-to-groups` now has
its own `runsToGroupsParamsFor` table in archetypes.ts, separate from
`paramsFor` (which still governs `groups-to-runs` only). Par for this
direction is exactly `3L + rackSize - 6` (measured, not assumed) — a
deterministic function of (L, rackSize), still zero variance within a
difficulty, but now tuned to land in the same range as `groups-to-runs`:

| diff | L | rackSize | par | groups-to-runs avg (measured) |
|---|---|---|---|---|
| easy | 5 | 2 | 11 | 10.6 |
| medium | 6 | 4 | 16 | 13.4 |
| hard | 7 | 5 | 20 | 20.0 |
| extreme | 8 | 5 | 23 | 23.9 |

*(extreme row updated in the generator-audit session; the two paragraphs below
are HISTORY — the L! wall they describe is gone, see the status note above.)*

**REVERTED (later session):** extreme's L=8/par-24 was tried and
measured at ~5.3s per generation. On reflection that 10x generation-
time cost (vs ~500ms for every other tier) wasn't worth the calibration
gain, so extreme's `runsToGroupsParamsFor` entry was reverted to L=7 /
rackSize=5 — identical to hard's row, par 20. Re-measured after the
revert (`buildRunsToGroups('extreme')`, 10 runs): 359-502ms per call
(avg 467ms), par=20 on all 10 — confirms it's back in the same time
budget as hard rather than the ~5s L=8 outlier. Extreme's
runs-to-groups par (20) now sits below its groups-to-runs par (~24)
rather than matching it — accepted as the cost of staying fast; see
"PERFORMANCE WALL" below if this ever needs revisiting.

**PERFORMANCE WALL, measured directly** (`buildRunsToGroupsAt`, real
wall-clock): `planValueGroupGoal` enumerates `L!` value-permutations,
so cost is `O(L!)` — L=5 10.7ms, L=6 63.7ms, L=7 503ms, L=8 5335ms.
rackSize barely affects timing (only O(1) work per cost() call); L is
what must stay small. Every tier now stays at L<=7 (<1s/build) after
the extreme reversion above. If a higher extreme par is wanted again,
the fix is redesigning `planValueGroupGoal`'s search (currently
exhaustive over L!), not retuning the table back up to L=8 — L=7 is
close to the practical ceiling under the current algorithm.

Verified post-change: `verifyEngine.ts` invariants (a)-(e) all 25/25
for both archetypes at every difficulty; move-sequence simulation
exact-matches par on all 40 samples; grid dims stay modest (max 10×10
at extreme/runs-to-groups, well under any UI concern); 160 real
`generatePuzzle()` calls split ~47/53 between directions with real
par overlap at every tier (e.g. hard: groups-to-runs avg 20.6 vs
runs-to-groups avg 20.0; extreme: groups-to-runs ~24.2 vs
runs-to-groups 20.0, per the reversion above). `tsc --noEmit`: 0 errors.

**Settled negative results — do NOT re-attempt** (full probes and measured evidence
in `MIGRATION_M2_LOG.md`): decoys as a bolt-on modifier, or decoys on
`groups-to-runs` at all; coupled blocks via "shared colour across non-overlapping
value ranges"; red herring as a bolt-on. Each was probed and proven impossible that
way. COUPLED still needs its contested-resource redesign — see `COUPLED_DESIGN.md`.

## Prompt discipline
- One file per session for solver/generator/archetypes/validator work
- Always end with: Run tsc --noEmit AND real executed test output.
  Neither alone is sufficient (see Anti-illusion rule).
- Explore-first / open-reasoning mandatory for genuine design work in
  this ENGINE ARCHITECTURE section (see Model and effort selection)
- Never patch a bug twice without diagnosing root cause first
- If a session runs long, stop it — see SESSION HEALTH above

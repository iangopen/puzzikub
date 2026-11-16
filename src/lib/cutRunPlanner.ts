/**
 * Cut-aware par for "every colour is one run" puzzles (groups-to-runs). Pure
 * module, no React.
 *
 * WHY THIS EXISTS. The uniqueness rule treats a run of six and the same tiles
 * laid as 3+3 as ONE solution, and `validateGrid` accepts both (any horizontal
 * segment that is a valid run wins). `planColorRunGoal` only scores the layout
 * with one whole run per colour, all starting in the same column. A cut piece is
 * a separate strip, and every strip can be slid so that one of its tiles is
 * already where it stands, so cutting can leave MORE tiles unmoved than the
 * whole-run layout allows. Measured on the audit seed (GENERATOR_AUDIT.md
 * section 9): the cut layout was cheaper than the old par on every hard and
 * extreme groups-to-runs puzzle.
 *
 * THE FAMILY `planCutRunGoal` minimises over, exactly:
 *   - each colour's run is laid whole or cut into pieces of three or more;
 *   - a piece is ANCHORED when it is placed so that at least one of its board
 *     tiles stays on its current cell; any set of anchored pieces that fits
 *     (no overlap, one empty cell between strips in a row) is tried;
 *   - the pieces left over are packed onto free cells.
 * Cost is the same functional-graph count as everywhere else:
 *     boardTiles + rack - fixed - cycles.
 * So this is still an UPPER BOUND on the true optimum (a layout with no anchored
 * piece that wins only through swap cycles is outside the family).
 * `searchCutRunGoal` is the independent check on that: a randomised search over
 * FREE placements, used by cutVsPar.ts and cutRunPlanner.verify.ts.
 */
import type { Grid, Tile } from '../types'

const COLORS: Tile['c'][] = ['r', 'b', 'a', 'k']
const NV = 14

export interface RunPiece { color: Tile['c']; lo: number; hi: number }
/** `col` is the column of the piece's lowest value. */
export interface PlacedPiece extends RunPiece { row: number; col: number }

export interface CutRunPlan {
  moves: number
  /** tile id -> [row, col], every board and rack tile. */
  goal: Map<string, [number, number]>
  pieces: PlacedPiece[]
  /** True when at least one colour is laid as more than one piece. */
  cut: boolean
}

interface Ctx {
  rows: number
  cols: number
  n: number
  board: { tile: Tile; cell: number }[]
  all: Tile[]
  runs: RunPiece[]
  /** colourIndex * NV + value -> index into `all` (< n means a board tile). */
  tileIdx: Int32Array
  occupant: Int32Array
  /** Goal cell per board tile; -1 = "some empty cell", which ends a path. */
  goals: Int32Array
  cost(): number
}

function makeCtx(grid: Grid, rack: Tile[]): Ctx | null {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  if (rows === 0 || cols === 0) return null
  const board: { tile: Tile; cell: number }[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const t = grid[r][c]
      if (t) board.push({ tile: t, cell: r * cols + c })
    }
  const n = board.length
  const all = [...board.map(b => b.tile), ...rack]
  if (all.length === 0) return null

  const tileIdx = new Int32Array(4 * NV).fill(-1)
  for (let i = 0; i < all.length; i++) {
    const k = COLORS.indexOf(all[i].c) * NV + all[i].n
    if (tileIdx[k] !== -1) return null // a duplicate label: not this planner's shape
    tileIdx[k] = i
  }
  const runs: RunPiece[] = []
  for (let ci = 0; ci < 4; ci++) {
    let lo = -1, hi = -1, count = 0
    for (let v = 1; v < NV; v++) if (tileIdx[ci * NV + v] !== -1) { if (lo < 0) lo = v; hi = v; count++ }
    if (count === 0) continue
    if (count < 3 || hi - lo + 1 !== count) return null // not one gapless run
    runs.push({ color: COLORS[ci], lo, hi })
  }

  const occupant = new Int32Array(rows * cols).fill(-1)
  for (let i = 0; i < n; i++) occupant[board[i].cell] = i
  const goals = new Int32Array(n).fill(-1)
  const mark = new Uint8Array(n)
  const walk = new Int32Array(n)
  const rackCount = rack.length

  return {
    rows, cols, n, board, all, runs, tileIdx, occupant, goals,
    cost() {
      mark.fill(0)
      let fixed = 0
      for (let i = 0; i < n; i++) if (board[i].cell === goals[i]) { fixed++; mark[i] = 3 }
      let cycles = 0
      for (let i = 0; i < n; i++) {
        if (mark[i] !== 0) continue
        let len = 0
        let cur = i
        while (cur !== -1 && mark[cur] === 0) {
          mark[cur] = 1
          walk[len++] = cur
          cur = goals[cur] < 0 ? -1 : occupant[goals[cur]]
        }
        if (cur !== -1 && mark[cur] === 1) cycles++
        for (let w = 0; w < len; w++) mark[walk[w]] = 2
      }
      return n + rackCount - fixed - cycles
    },
  }
}

/** Every way to cut a run of `len` into pieces of three or more, as piece lengths. */
export function cutCompositions(len: number): number[][] {
  if (len === 0) return [[]]
  const out: number[][] = []
  for (let first = 3; first <= len; first++)
    if (len - first === 0 || len - first >= 3) for (const rest of cutCompositions(len - first)) out.push([first, ...rest])
  return out
}

/** Sub-runs that are a piece of at least one valid cut of `run`. */
function piecesOf(run: RunPiece, wholeOnly: boolean): RunPiece[] {
  if (wholeOnly) return [run]
  const out: RunPiece[] = []
  for (let a = run.lo; a <= run.hi; a++)
    for (let b = a + 2; b <= run.hi; b++) {
      const left = a - run.lo, right = run.hi - b
      if ((left === 0 || left >= 3) && (right === 0 || right >= 3)) out.push({ color: run.color, lo: a, hi: b })
    }
  return out
}

/** Two pieces of one colour can belong to the same cut. */
const sameCutOk = (a: RunPiece, b: RunPiece): boolean => {
  const [x, y] = a.lo <= b.lo ? [a, b] : [b, a]
  const gap = y.lo - x.hi - 1
  return gap === 0 || gap >= 3
}

const setPiece = (ctx: Ctx, p: PlacedPiece, on: boolean): void => {
  const ci = COLORS.indexOf(p.color)
  for (let v = p.lo; v <= p.hi; v++) {
    const i = ctx.tileIdx[ci * NV + v]
    if (i < ctx.n) ctx.goals[i] = on ? p.row * ctx.cols + p.col + (v - p.lo) : -1
  }
}

/** The pieces of each run not covered by `placed`, one per gap. */
function leftovers(ctx: Ctx, placed: PlacedPiece[]): RunPiece[] {
  const out: RunPiece[] = []
  for (const run of ctx.runs) {
    const mine = placed.filter(p => p.color === run.color).sort((a, b) => a.lo - b.lo)
    let at = run.lo
    for (const p of mine) { if (p.lo > at) out.push({ color: run.color, lo: at, hi: p.lo - 1 }); at = p.hi + 1 }
    if (at <= run.hi) out.push({ color: run.color, lo: at, hi: run.hi })
  }
  return out
}

/**
 * Put `rest` on free cells: no overlap, and an empty cell between two strips in
 * a row. `clean` also keeps them off every cell a board tile stands on, which is
 * what makes their position irrelevant to the cost.
 */
function pack(ctx: Ctx, placed: PlacedPiece[], rest: RunPiece[], clean: boolean): PlacedPiece[] | null {
  const { rows, cols } = ctx
  const used = new Uint8Array(rows * cols)
  for (const p of placed) for (let k = 0; k <= p.hi - p.lo; k++) used[p.row * cols + p.col + k] = 1
  const order = [...rest].sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo))
  const out: PlacedPiece[] = []
  let nodes = 0
  const fits = (r: number, c: number, len: number): boolean => {
    if (c < 0 || c + len > cols) return false
    for (let k = -1; k <= len; k++) {
      const cc = c + k
      if (cc < 0 || cc >= cols) continue
      if (used[r * cols + cc]) return false
      if (clean && k >= 0 && k < len && ctx.occupant[r * cols + cc] !== -1) return false
    }
    return true
  }
  const go = (i: number): boolean => {
    if (i === order.length) return true
    if (++nodes > 5000) return false
    const p = order[i]
    const len = p.hi - p.lo + 1
    for (let r = 0; r < rows; r++)
      for (let c = 0; c + len <= cols; c++) {
        if (!fits(r, c, len)) continue
        for (let k = 0; k < len; k++) used[r * cols + c + k] = 1
        out.push({ ...p, row: r, col: c })
        if (go(i + 1)) return true
        out.pop()
        for (let k = 0; k < len; k++) used[r * cols + c + k] = 0
      }
    return false
  }
  return go(0) ? out : null
}

function toPlan(ctx: Ctx, moves: number, pieces: PlacedPiece[]): CutRunPlan {
  const goal = new Map<string, [number, number]>()
  for (const p of pieces) {
    const ci = COLORS.indexOf(p.color)
    for (let v = p.lo; v <= p.hi; v++) goal.set(ctx.all[ctx.tileIdx[ci * NV + v]].id, [p.row, p.col + (v - p.lo)])
  }
  return { moves, goal, pieces, cut: pieces.length > ctx.runs.length }
}

export interface CutPlanStats { leaves: number; exact?: boolean }

/** Above this many layouts the exhaustive search is not attempted. */
const EXHAUSTIVE_LIMIT = 400_000

/**
 * Whole runs, every free placement. A run that touches no board tile cannot be
 * fixed or on a cycle, so "somewhere off the board tiles" is ONE option; every
 * position that does touch a board tile is tried. Returns null when the space is
 * larger than EXHAUSTIVE_LIMIT (the caller falls back to the anchored search).
 */
function planWholeExhaustive(ctx: Ctx, stats?: CutPlanStats): CutRunPlan | null {
  const { rows, cols } = ctx
  const options: PlacedPiece[][] = ctx.runs.map(run => {
    const len = run.hi - run.lo + 1
    const out: PlacedPiece[] = []
    for (let r = 0; r < rows; r++)
      for (let c = 0; c + len <= cols; c++) {
        let touches = false
        for (let k = 0; k < len; k++) if (ctx.occupant[r * cols + c + k] !== -1) touches = true
        if (touches) out.push({ ...run, row: r, col: c })
      }
    return out
  })
  if (options.reduce((s, o) => s * (o.length + 1), 1) > EXHAUSTIVE_LIMIT) return null

  const used = new Uint8Array(rows * cols)
  const placed: PlacedPiece[] = []
  let best = Infinity
  let bestPieces: PlacedPiece[] | null = null
  let leaves = 0
  const fits = (p: PlacedPiece): boolean => {
    const len = p.hi - p.lo + 1
    for (let k = -1; k <= len; k++) {
      const cc = p.col + k
      if (cc >= 0 && cc < cols && used[p.row * cols + cc]) return false
    }
    return true
  }
  const go = (i: number): void => {
    if (i === options.length) {
      leaves++
      const cost = ctx.cost()
      if (cost >= best) return
      const rest = leftovers(ctx, placed)
      const clean = pack(ctx, placed, rest, true)
      if (clean) { best = cost; bestPieces = [...placed, ...clean]; return }
      const any = pack(ctx, placed, rest, false)
      if (!any) return
      for (const p of any) setPiece(ctx, p, true)
      const real = ctx.cost()
      for (const p of any) setPiece(ctx, p, false)
      for (const p of placed) setPiece(ctx, p, true)
      if (real < best) { best = real; bestPieces = [...placed, ...any] }
      return
    }
    go(i + 1) // this run goes off the board tiles
    for (const p of options[i]) {
      if (!fits(p)) continue
      const len = p.hi - p.lo + 1
      for (let k = 0; k < len; k++) used[p.row * cols + p.col + k] = 1
      placed.push(p)
      setPiece(ctx, p, true)
      go(i + 1)
      setPiece(ctx, p, false)
      placed.pop()
      for (let k = 0; k < len; k++) used[p.row * cols + p.col + k] = 0
    }
  }
  go(0)
  ctx.goals.fill(-1)
  if (stats) { stats.leaves = leaves; stats.exact = true }
  return bestPieces ? toPlan(ctx, best, bestPieces) : null
}

/** Anchored sets up to this many moves above the cheapest are finished too. */
const SLACK = 1
/** ...but no more than this many of them. */
const FINISH_LIMIT = 48

/**
 * Steepest descent. Each round tries (a) every single piece at every free
 * position and (b) every PAIR move that closes a two-tile swap: piece A placed
 * so that one of its tiles lands on the cell of a tile of piece B, and B placed
 * so that tile lands on A's tile's cell. A single move cannot find (b), because
 * each half alone gains nothing. The best move is applied; stop when none helps.
 * Mutates `pieces`; returns the final cost.
 */
function descend(ctx: Ctx, pieces: PlacedPiece[]): number {
  const { rows, cols, n } = ctx
  const used = new Int16Array(rows * cols)
  const pieceOf = new Int16Array(ctx.all.length)
  const paint = (): void => {
    used.fill(-1)
    ctx.goals.fill(-1)
    pieces.forEach((p, i) => {
      const ci = COLORS.indexOf(p.color)
      for (let k = 0; k <= p.hi - p.lo; k++) { used[p.row * cols + p.col + k] = i; pieceOf[ctx.tileIdx[ci * NV + p.lo + k]] = i }
      setPiece(ctx, p, true)
    })
  }
  const freeAt = (r: number, c: number, len: number, ig1: number, ig2: number): boolean => {
    if (c < 0 || c + len > cols) return false
    for (let k = -1; k <= len; k++) {
      const cc = c + k
      if (cc < 0 || cc >= cols) continue
      const u = used[r * cols + cc]
      if (u !== -1 && u !== ig1 && u !== ig2) return false
    }
    return true
  }
  paint()
  let cost = ctx.cost()
  for (;;) {
    let gain = 0
    let move: { i: number; r: number; c: number; j: number; r2: number; c2: number } | null = null
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i]
      const len = p.hi - p.lo + 1
      const ci = COLORS.indexOf(p.color)
      const hr = p.row, hc = p.col
      for (let r = 0; r < rows; r++)
        for (let c = 0; c + len <= cols; c++) {
          if (r === hr && c === hc) continue
          if (freeAt(r, c, len, i, -1)) {
            p.row = r; p.col = c
            setPiece(ctx, p, true)
            const g = cost - ctx.cost()
            if (g > gain) { gain = g; move = { i, r, c, j: -1, r2: 0, c2: 0 } }
            p.row = hr; p.col = hc
            setPiece(ctx, p, true)
          }
          for (let k = 0; k < len; k++) {
            const ti = ctx.tileIdx[ci * NV + p.lo + k]
            const occ = ctx.occupant[r * cols + c + k]
            if (ti >= n || occ === -1 || occ === ti) continue
            const j = pieceOf[occ]
            if (j === i) continue
            const q = pieces[j]
            const qlen = q.hi - q.lo + 1
            const home = ctx.board[ti].cell
            const r2 = Math.floor(home / cols), c2 = (home % cols) - (ctx.board[occ].tile.n - q.lo)
            if (!freeAt(r, c, len, i, j) || !freeAt(r2, c2, qlen, i, j)) continue
            if (r === r2 && !(c2 >= c + len + 1 || c >= c2 + qlen + 1)) continue
            const qr = q.row, qc = q.col
            p.row = r; p.col = c; q.row = r2; q.col = c2
            setPiece(ctx, p, true); setPiece(ctx, q, true)
            const g = cost - ctx.cost()
            if (g > gain) { gain = g; move = { i, r, c, j, r2, c2 } }
            p.row = hr; p.col = hc; q.row = qr; q.col = qc
            setPiece(ctx, p, true); setPiece(ctx, q, true)
          }
        }
    }
    if (!move) break
    pieces[move.i].row = move.r; pieces[move.i].col = move.c
    if (move.j >= 0) { pieces[move.j].row = move.r2; pieces[move.j].col = move.c2 }
    paint()
    cost -= gain
  }
  ctx.goals.fill(-1)
  return cost
}
/**
 * Cheapest layout in the anchored family described at the top of this file.
 * `wholeOnly` restricts it to uncut runs (each still placed freely), which is
 * the control that separates "cutting helps" from "free placement helps".
 * Returns null when the tiles are not one duplicate-free run per colour.
 */
export function planCutRunGoal(grid: Grid, rack: Tile[], wholeOnly = false, stats?: CutPlanStats): CutRunPlan | null {
  const ctx = makeCtx(grid, rack)
  if (!ctx) return null
  const { rows, cols, n, board } = ctx

  // No run long enough to cut (or cutting switched off) and a small board: try
  // EVERY free placement. Exact over the whole free-placement family.
  const uncuttable = wholeOnly || ctx.runs.every(r => r.hi - r.lo + 1 < 6)
  if (uncuttable) {
    const exact = planWholeExhaustive(ctx, stats)
    if (exact) return exact
  }

  // Anchored placements per row: a piece positioned so one of the row's board
  // tiles keeps its cell.
  const universe = ctx.runs.flatMap(r => piecesOf(r, wholeOnly))
  const anchored: PlacedPiece[][] = Array.from({ length: rows }, () => [])
  for (let i = 0; i < n; i++) {
    const { tile, cell } = board[i]
    const r = Math.floor(cell / cols), c = cell % cols
    for (const p of universe) {
      if (p.color !== tile.c || tile.n < p.lo || tile.n > p.hi) continue
      const col = c - (tile.n - p.lo)
      if (col < 0 || col + (p.hi - p.lo) >= cols) continue
      if (!anchored[r].some(q => q.color === p.color && q.lo === p.lo && q.hi === p.hi && q.col === col))
        anchored[r].push({ ...p, row: r, col })
    }
  }
  // Per row: every set of anchored placements that can share the row.
  const apart = (a: PlacedPiece, b: PlacedPiece): boolean => {
    const [x, y] = a.col <= b.col ? [a, b] : [b, a]
    return y.col >= x.col + (x.hi - x.lo) + 2
  }
  const rowSets: PlacedPiece[][][] = anchored.map(list => {
    const sets: PlacedPiece[][] = [[]]
    const grow = (from: number, cur: PlacedPiece[]): void => {
      for (let i = from; i < list.length; i++) {
        const p = list[i]
        if (!cur.every(q => apart(p, q) && (q.color !== p.color || (q.hi < p.lo || p.hi < q.lo) && sameCutOk(p, q)))) continue
        cur.push(p)
        sets.push([...cur])
        grow(i + 1, cur)
        cur.pop()
      }
    }
    grow(0, [])
    return sets
  })

  const placed: PlacedPiece[] = []
  let best = Infinity
  let bestPieces: PlacedPiece[] | null = null
  let leaves = 0
  const fitsCut = (p: PlacedPiece): boolean =>
    placed.every(q => q.color !== p.color || ((q.hi < p.lo || p.hi < q.lo) && sameCutOk(p, q)))

  // Anchored sets within SLACK of the cheapest seen are kept and finished below.
  let seen = Infinity
  let cands: { cost: number; placed: PlacedPiece[] }[] = []
  const leaf = (): void => {
    leaves++
    const cost = ctx.cost()
    if (cost > seen + SLACK) return
    if (cost < seen) seen = cost
    cands.push({ cost, placed: [...placed] })
    if (cands.length > 4096) cands = cands.filter(c => c.cost <= seen + SLACK)
  }
  const dfs = (r: number): void => {
    if (r === rows) { leaf(); return }
    for (const set of rowSets[r]) {
      if (!set.every(fitsCut)) continue
      for (const p of set) { placed.push(p); setPiece(ctx, p, true) }
      dfs(r + 1)
      for (const p of set) { placed.pop(); setPiece(ctx, p, false) }
    }
  }
  dfs(0)
  if (stats) stats.leaves = leaves

  // Finish the cheapest anchored sets: pack the leftovers (off the board tiles
  // if there is room, so they cost nothing extra), then slide single pieces to
  // wherever lowers the cost, which is how a leftover ends up closing a swap
  // cycle. Deterministic: candidates in (cost, discovery) order, steepest move.
  cands = cands.filter(c => c.cost <= seen + SLACK).sort((a, b) => a.cost - b.cost).slice(0, FINISH_LIMIT)
  for (const cand of cands) {
    const rest = leftovers(ctx, cand.placed)
    const packed = pack(ctx, cand.placed, rest, true) ?? pack(ctx, cand.placed, rest, false)
    if (!packed) continue
    // Copies: descend moves pieces, and the anchored ones are shared objects.
    const pieces = [...cand.placed, ...packed].map(p => ({ ...p }))
    const cost = descend(ctx, pieces)
    if (cost < best) { best = cost; bestPieces = pieces.map(p => ({ ...p })) }
  }
  return bestPieces ? toPlan(ctx, best, bestPieces) : null
}

/** Cost of an explicit layout, or null if it is not a legal one for these tiles. */
export function cutLayoutCost(grid: Grid, rack: Tile[], pieces: PlacedPiece[]): number | null {
  const ctx = makeCtx(grid, rack)
  if (!ctx) return null
  for (const p of pieces) setPiece(ctx, p, true)
  return ctx.cost()
}

/**
 * INDEPENDENT ADVERSARY for `planCutRunGoal`: simulated annealing over FREE
 * placements (any cut, any position, anchored or not), started from `start`.
 * Audit and harness use only: it draws from Math.random and is far too slow for
 * the generator. It returns the cheapest layout it visited, which can only be
 * `start` or something cheaper.
 */
export function searchCutRunGoal(grid: Grid, rack: Tile[], start: PlacedPiece[], iterations = 20000): CutRunPlan | null {
  const ctx = makeCtx(grid, rack)
  if (!ctx) return null
  const { rows, cols } = ctx
  let cur = start.map(p => ({ ...p }))
  const used = new Int16Array(rows * cols).fill(-1)
  const paint = (): void => {
    used.fill(-1)
    ctx.goals.fill(-1)
    cur.forEach((p, i) => { for (let k = 0; k <= p.hi - p.lo; k++) used[p.row * cols + p.col + k] = i; setPiece(ctx, p, true) })
  }
  const free = (r: number, c: number, len: number, ignore: number): boolean => {
    if (c < 0 || c + len > cols) return false
    for (let k = -1; k <= len; k++) {
      const cc = c + k
      if (cc < 0 || cc >= cols) continue
      const u = used[r * cols + cc]
      if (u !== -1 && u !== ignore) return false
    }
    return true
  }
  const ri = (k: number): number => Math.floor(Math.random() * k)
  paint()
  let curCost = ctx.cost()
  let best = curCost
  let bestPieces = cur.map(p => ({ ...p }))

  for (let it = 0; it < iterations; it++) {
    const temp = 1.2 * (1 - it / iterations) + 0.05
    const before = cur.map(p => ({ ...p }))
    if (Math.random() < 0.15) {
      // Re-cut one colour and drop its pieces somewhere free.
      const run = ctx.runs[ri(ctx.runs.length)]
      const comps = cutCompositions(run.hi - run.lo + 1)
      const comp = comps[ri(comps.length)]
      cur = cur.filter(p => p.color !== run.color)
      paint()
      let at = run.lo, ok = true
      for (const len of comp) {
        let done = false
        for (let tries = 0; tries < 40 && !done; tries++) {
          const r = ri(rows), c = ri(cols - len + 1)
          if (!free(r, c, len, -1)) continue
          cur.push({ color: run.color, lo: at, hi: at + len - 1, row: r, col: c })
          paint()
          done = true
        }
        if (!done) { ok = false; break }
        at += len
      }
      if (!ok) { cur = before; paint(); continue }
    } else {
      // Move one piece: half the time so that one of its board tiles stays put.
      const i = ri(cur.length)
      const p = cur[i]
      const len = p.hi - p.lo + 1
      let r = ri(rows), c = ri(cols - len + 1)
      if (Math.random() < 0.5) {
        const v = p.lo + ri(len)
        const ti = ctx.tileIdx[COLORS.indexOf(p.color) * NV + v]
        if (ti < ctx.n) { r = Math.floor(ctx.board[ti].cell / cols); c = (ctx.board[ti].cell % cols) - (v - p.lo) }
      }
      if (!free(r, c, len, i)) continue
      cur[i] = { ...p, row: r, col: c }
      paint()
    }
    const cost = ctx.cost()
    if (cost <= curCost || Math.random() < Math.exp((curCost - cost) / temp)) {
      curCost = cost
      if (cost < best) { best = cost; bestPieces = cur.map(p => ({ ...p })) }
    } else { cur = before; paint() }
  }
  return toPlan(ctx, best, bestPieces)
}

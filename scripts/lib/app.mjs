/**
 * app.mjs — Puzzikub-specific helpers shared by the verify-*.mjs scripts:
 * a Vite dev server, page setup, a DOM state reader, and a check reporter.
 *
 * Everything here READS the app through its real DOM (data-cell / data-rack,
 * the "moves: N par: P rack: K" status line, computed styles). Nothing in
 * src/ exposes test hooks, and none should be added for these scripts.
 */
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { sleep } from './cdp.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Start the real Vite dev server (base '/puzzikub/') on a free port. */
export async function startServer() {
  const server = await createServer({
    root: ROOT,
    configFile: resolve(ROOT, 'vite.config.ts'),
    logLevel: 'error',
    server: { port: 5199, strictPort: false, host: '127.0.0.1' },
  })
  await server.listen()
  const url = server.resolvedUrls.local[0] // e.g. http://127.0.0.1:5199/puzzikub/
  return { url, close: () => server.close() }
}

// ---------------------------------------------------------------- checks ---

export class Checks {
  constructor(title) {
    this.title = title
    this.passed = 0
    this.failed = 0
    this.failures = []
  }
  section(name) { console.log(`\n-- ${name}`) }
  ok(name, cond, detail = '') {
    const tag = cond ? 'PASS' : 'FAIL'
    console.log(`  [${tag}] ${name}${detail ? `  (${detail})` : ''}`)
    if (cond) this.passed++
    else { this.failed++; this.failures.push(name) }
    return cond
  }
  /** Record an exception thrown mid-section as a failure instead of aborting. */
  crash(name, err) {
    this.ok(`${name} — threw`, false, err?.message ?? String(err))
  }
  summary() {
    console.log(`\n${this.title}: ${this.passed} passed, ${this.failed} failed`)
    if (this.failed) for (const f of this.failures) console.log(`  FAILED: ${f}`)
    return { passed: this.passed, failed: this.failed }
  }
}

// ------------------------------------------------------------ page setup ---

/**
 * Load the Play screen with a clean slate: localStorage cleared, the first-run
 * Tutorial suppressed (on a fresh profile it overlays the board and swallows
 * every drop — a known rig trap), and an optional board scale pre-seeded.
 *
 * `diff` clicks a difficulty pill before waiting for the board. REQUIRED for a
 * tier-restricted `?forceArchetype=`: the screen always mounts on 'easy', and
 * e.g. cut-point is medium-only, so the initial generation deliberately fails
 * and NO board renders until the right pill is clicked.
 */
export async function openPlay(page, baseUrl, { scale, query = '', diff, extraStorage = {} } = {}) {
  await page.navigate(baseUrl + query)
  // ***Wait for the app to MOUNT before seeding storage.*** React commits and
  // runs mount effects AFTER the load event, and App's mount effect writes the
  // board scale it read at startup back to localStorage. Seeding on load alone
  // raced that effect and was silently overwritten with the PREVIOUS run's
  // value — every preset check then measured the wrong scale. Measured, fixed.
  await page.waitFor(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'easy'),
    { label: 'app mount', timeout: 30000 })
  await sleep(100)
  await page.eval((scale, extra) => {
    localStorage.clear()
    localStorage.setItem('puzzikub_seen_tutorial', '1')
    if (scale !== null) localStorage.setItem('puzzikub_board_scale', String(scale))
    for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v)
  }, scale ?? null, extraStorage)
  await page.reload()
  if (diff) {
    await page.waitFor(d => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === d),
      { label: `"${diff}" pill`, timeout: 30000 }, diff)
    await clickButton(page, diff)
  }
  await waitForBoard(page)
  await page.takeRecord()
}

export async function waitForBoard(page) {
  await page.waitFor(() => document.querySelectorAll('[data-cell]').length > 0 &&
    /moves:/.test(document.body.innerText), { label: 'board render', timeout: 30000 })
  await sleep(50)
}

/** Click a button by its exact visible text. */
export async function clickButton(page, text) {
  const pt = await page.eval(t => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t)
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, text)
  if (!pt) throw new Error(`no button "${text}"`)
  await page.mouse('mouseMoved', pt.x, pt.y)
  await page.mouse('mousePressed', pt.x, pt.y)
  await page.mouse('mouseReleased', pt.x, pt.y)
  await sleep(80)
}

// ---------------------------------------------------------------- state ---

/**
 * Snapshot everything a check needs, straight from the DOM.
 *
 * A tile's identity on screen is `number|colour` (the TileFace text and its
 * computed colour). That is ambiguous for m=2 duplicate pairs, so pickers
 * below only ever choose tiles whose signature is UNIQUE on the page.
 */
export async function readState(page) {
  return page.eval(() => {
    const status = /moves:\s*(\d+)\s+par:\s*(\S+)\s+rack:\s*(\d+)/.exec(document.body.innerText)
    const sigOf = face => face ? `${face.textContent}|${getComputedStyle(face).color}` : null
    const box = el => {
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height,
               left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    }
    const cells = [...document.querySelectorAll('[data-cell]')].map(el => {
      const [r, c] = el.getAttribute('data-cell').split(',').map(Number)
      const occupied = !!el.firstElementChild
      return { r, c, occupied, sig: occupied ? sigOf(el.firstElementChild) : null, ...box(el) }
    })
    const rackEl = document.querySelector('[data-rack]')
    const rack = rackEl ? [...rackEl.children].map(el => ({ sig: sigOf(el.firstElementChild), ...box(el) })) : []
    const preview = [...document.querySelectorAll('div')]
      .find(d => d.style.position === 'fixed' && d.style.zIndex === '9999')
    const scroller = document.querySelector('[data-cell]')?.parentElement?.parentElement
    return {
      moves: status ? Number(status[1]) : null,
      par: status ? status[2] : null,
      rackCount: status ? Number(status[3]) : null,
      cells, rack,
      rows: cells.length ? Math.max(...cells.map(c => c.r)) + 1 : 0,
      cols: cells.length ? Math.max(...cells.map(c => c.c)) + 1 : 0,
      rackBox: rackEl ? box(rackEl) : null,
      preview: preview ? { ...box(preview), sig: sigOf(preview.firstElementChild) } : null,
      bodyUserSelect: document.body.style.userSelect,
      bodyCursor: document.body.style.cursor,
      scroller: scroller ? {
        scrollLeft: scroller.scrollLeft, scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth, ...box(scroller),
      } : null,
    }
  })
}

export const cellAt = (s, r, c) => s.cells.find(x => x.r === r && x.c === c)

function counts(s) {
  const m = new Map()
  for (const x of [...s.cells.filter(c => c.occupied), ...s.rack]) m.set(x.sig, (m.get(x.sig) ?? 0) + 1)
  return m
}

/** Occupied cells whose tile signature is unique on the whole page. */
export function uniqueTileCells(s) {
  const n = counts(s)
  return s.cells.filter(c => c.occupied && n.get(c.sig) === 1)
}

/** Rack tiles whose signature is unique on the whole page. */
export function uniqueRackTiles(s) {
  const n = counts(s)
  return s.rack.map((t, i) => ({ ...t, i })).filter(t => n.get(t.sig) === 1)
}

/** Empty cells that are fully inside the visible scroller viewport. */
export function visibleEmptyCells(s) {
  const sc = s.scroller
  return s.cells.filter(c => !c.occupied && (!sc || (c.left >= sc.left - 0.5 && c.right <= sc.right + 0.5)))
}

export function visibleCells(s, pred = () => true) {
  const sc = s.scroller
  return s.cells.filter(c => pred(c) && (!sc || (c.left >= sc.left - 0.5 && c.right <= sc.right + 0.5)))
}

export const grid2str = s => s.cells.map(c => c.sig ?? '.').join(',')

/** How many copies of a tile signature sit on the BOARD (m=2 duplicates share one). */
export const boardCount = (s, sig) => s.cells.filter(c => c.sig === sig).length

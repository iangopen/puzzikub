/**
 * `npm run verify:library` — Library + Editor + the Library "Play" wiring, in a
 * real headless Chrome against the Vite dev server. Every assertion reads REAL
 * page state: tile ids come from the `data-tile-id` attributes on Board/Rack,
 * the stored library comes from localStorage['puzzikub_library'].
 *
 *  A legacy id-less blob loads, gets deterministic ids, and plays to a win;
 *    Undo and Reset restore THAT puzzle's own start.
 *  B Play on a saved puzzle loads exactly that puzzle (ids vs the stored blob),
 *    and beats ?forceArchetype.
 *  C Editor: build board + rack, third copy refused, Save lands in the Library.
 *  D Library Generate buttons add playable puzzles; Delete removes one.
 *  E The library survives a reload.
 *  F New / a difficulty pill after a Library Play generates a different puzzle.
 */
import { pathToFileURL } from 'node:url'
import { launch, sleep } from './lib/cdp.mjs'
import { startServer, Checks, clickButton, waitForBoard } from './lib/app.mjs'

const LIB_KEY = 'puzzikub_library'

// A pre-m=2 blob: bare {n,c} tiles, including a duplicate pair (two rows of
// red 3-4-5), so migration has to mint copy 0 AND copy 1.
const T = (n, c) => ({ n, c })
const LEGACY = [{
  id: 'legacy1', name: 'Legacy duo', diff: 'medium', optimalMoves: 1, generated: false,
  grid: [
    [T(3, 'r'), T(4, 'r'), T(5, 'r'), null, null],
    [T(3, 'r'), T(4, 'r'), T(5, 'r'), null, null],
  ],
  rack: [T(6, 'r')],
}]

/** The documented migration rule: occurrence index per (n,c), grid row-major then rack. */
function expectedIds(p) {
  const seen = new Map()
  const mint = t => {
    const k = `${t.n}_${t.c}`
    const i = seen.get(k) ?? 0
    seen.set(k, i + 1)
    return `${k}_${i}`
  }
  return {
    grid: p.grid.map(row => row.map(t => (t ? mint(t) : null))),
    rack: p.rack.map(mint),
  }
}
const storedIds = p => ({ grid: p.grid.map(r => r.map(t => t?.id ?? null)), rack: p.rack.map(t => t.id) })

async function readIds(page) {
  return page.eval(() => {
    const cells = [...document.querySelectorAll('[data-cell]')]
    if (!cells.length) return null
    const rows = Math.max(...cells.map(c => +c.dataset.cell.split(',')[0])) + 1
    const cols = Math.max(...cells.map(c => +c.dataset.cell.split(',')[1])) + 1
    const grid = Array.from({ length: rows }, () => Array(cols).fill(null))
    for (const c of cells) {
      const [r, k] = c.dataset.cell.split(',').map(Number)
      grid[r][k] = c.dataset.tileId ?? null
    }
    const rack = [...document.querySelectorAll('[data-rack] [data-tile-id]')].map(e => e.dataset.tileId)
    const status = /moves:\s*(\d+)\s+par:\s*(\S+)\s+rack:\s*(\d+)/.exec(document.body.innerText)
    const diff = [...document.querySelectorAll('button')].find(b => b.style.fontWeight === '600' && ['easy', 'medium', 'hard', 'extreme'].includes(b.textContent.trim()))?.textContent.trim()
    return { grid, rack, moves: status && +status[1], par: status && status[2], diff, text: document.body.innerText }
  })
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const readLib = page => page.eval(k => JSON.parse(localStorage.getItem(k) ?? 'null'), LIB_KEY)

async function boot(page, url, lib, query = '') {
  await page.navigate(url + query)
  await page.waitFor(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Library'),
    { label: 'app mount', timeout: 30000 })
  await sleep(100)
  await page.eval((k, lib) => {
    localStorage.clear()
    localStorage.setItem('puzzikub_seen_tutorial', '1')
    if (lib) localStorage.setItem(k, lib)
  }, LIB_KEY, lib ? JSON.stringify(lib) : null)
  await page.reload()
  await page.waitFor(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Library'),
    { label: 'app remount', timeout: 30000 })
  await sleep(100)
}

/** Click the i-th button with this exact text (rows repeat "Play"/"Delete"). */
async function clickNth(page, text, i) {
  const pt = await page.eval((t, i) => {
    const b = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === t)[i]
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, text, i)
  if (!pt) throw new Error(`no button "${text}" #${i}`)
  await page.mouse('mouseMoved', pt.x, pt.y)
  await page.mouse('mousePressed', pt.x, pt.y)
  await page.mouse('mouseReleased', pt.x, pt.y)
  await sleep(120)
}
/** Library rows: Play buttons excluding the NavBar's "Play". */
const playRow = (page, i) => clickNth(page, 'Play', i + 1)
const libRowCount = page => page.eval(() => [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Delete').length)

async function centre(page, selector, idx = 0) {
  return page.eval((s, i) => {
    const e = document.querySelectorAll(s)[i]
    if (!e) return null
    const r = e.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, selector, idx)
}

async function drag(page, from, to) {
  await page.mouseDrag(from, to, { steps: 6 })
  await sleep(150)
}

// ------------------------------------------------------------- editor ---

/** Click an editor target, then set number n (red) in the picker and confirm. */
async function pickTile(page, target, n) {
  await page.mouse('mouseMoved', target.x, target.y)
  await page.mouse('mousePressed', target.x, target.y)
  await page.mouse('mouseReleased', target.x, target.y)
  await sleep(100)
  const c = await page.eval(() => {
    const e = [...document.querySelectorAll('div')].find(d => d.style.cursor === 'ns-resize')
    if (!e) return null
    const r = e.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  if (!c) throw new Error('picker did not open')
  if (n > 1) {
    await page.mouse('mouseMoved', c.x, c.y)
    await page.mouse('mousePressed', c.x, c.y)
    await page.mouse('mouseMoved', c.x, c.y - (n - 1) * 20 - 2, { buttons: 1 })
    await page.mouse('mouseReleased', c.x, c.y - (n - 1) * 20 - 2)
    await sleep(60)
  }
  await clickButton(page, 'Confirm')
}
/** Editor cells: dashed empty slots with no text; the rack "+" has text "+". */
const editorEmptyCell = (page, i) => page.eval(i => {
  const e = [...document.querySelectorAll('div')].filter(d => d.style.border.includes('dashed') && d.textContent === '')[i]
  const r = e.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}, i)
const editorPlus = page => page.eval(() => {
  const e = [...document.querySelectorAll('div')].filter(d => d.style.border.includes('dashed') && d.textContent === '+').pop()
  const r = e.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
const editorRackCount = page => page.eval(() => {
  const plus = [...document.querySelectorAll('div')].filter(d => d.style.border.includes('dashed') && d.textContent === '+').pop()
  return plus.parentElement.children.length - 1
})

// ---------------------------------------------------------------- run ---

export async function run(url) {
  const ck = new Checks('LIBRARY')
  const page = await launch()
  try {
    await page.setViewport({ width: 1100, height: 900 })

    // ---------------------------------------------------------------- A
    ck.section('A legacy id-less blob: migrates, plays, Undo/Reset restore it')
    try {
      await boot(page, url, LEGACY)
      await clickButton(page, 'Library')
      ck.ok('legacy puzzle listed in the Library', (await page.eval(() => document.body.innerText)).includes('Legacy duo'))
      const raw = await readLib(page)
      ck.ok('stored blob left id-less on load (migration is not written back)', raw[0].rack[0].id === undefined)
      await playRow(page, 0)
      await waitForBoard(page)
      const s = await readIds(page)
      const exp = expectedIds(LEGACY[0])
      ck.ok('grid ids = deterministic migration ids (incl. copy 0 and copy 1)', same(s.grid, exp.grid), JSON.stringify(s.grid))
      ck.ok('rack ids = migration ids', same(s.rack, exp.rack), JSON.stringify(s.rack))
      ck.ok('difficulty pill follows the saved puzzle (medium)', s.diff === 'medium', s.diff)
      ck.ok('hand-built puzzle shows no par ("—")', s.par === '—', s.par)
      const from = await centre(page, '[data-rack] [data-tile-id]')
      const to = await centre(page, '[data-cell="0,3"]')
      await drag(page, from, to)
      let a = await readIds(page)
      ck.ok('drop 6r onto 0,3: rack empty, moves 1', a.rack.length === 0 && a.moves === 1, `rack ${a.rack.length} moves ${a.moves}`)
      ck.ok('win shown, without "perfect!" (no par for hand-built)', /cleared ✓/.test(a.text) && !/perfect/.test(a.text))
      await clickButton(page, 'Undo')
      a = await readIds(page)
      // Undo does not decrement `moves` (it counts undos separately) — by design.
      ck.ok('Undo restores the saved puzzle start (grid + rack ids)', same(a.grid, exp.grid) && same(a.rack, exp.rack))
      await drag(page, await centre(page, '[data-rack] [data-tile-id]'), await centre(page, '[data-cell="1,4"]'))
      await drag(page, await centre(page, '[data-cell="0,0"]'), await centre(page, '[data-cell="1,3"]'))
      a = await readIds(page)
      ck.ok('two more moves made before Reset', a.moves === 3 && !same(a.grid, exp.grid), `moves ${a.moves}`)
      await clickButton(page, 'Reset')
      a = await readIds(page)
      ck.ok('Reset restores the saved puzzle start, not a generated one', same(a.grid, exp.grid) && same(a.rack, exp.rack), JSON.stringify(a.grid))
    } catch (e) { ck.crash('A', e) }

    // ------------------------------------------------------------- D + B
    ck.section('D Generate buttons add playable puzzles; B Play loads exactly that puzzle')
    let lib
    try {
      await clickButton(page, 'Library')
      const btns = await page.eval(() => [...document.querySelectorAll('button')].map(b => b.textContent.trim()))
      ck.ok('Generate row offers Easy, Medium, Hard AND Extreme', ['Easy', 'Medium', 'Hard', 'Extreme'].every(x => btns.includes(x)))
      for (const d of ['Easy', 'Medium', 'Hard', 'Extreme']) {
        const before = await libRowCount(page)
        await clickButton(page, d)
        await sleep(200)
        const after = await libRowCount(page)
        const st = await readLib(page)
        const last = st[st.length - 1]
        ck.ok(`Generate ${d}: +1 row, stored generated ${d.toLowerCase()} puzzle`,
          after === before + 1 && last.generated === true && last.diff === d.toLowerCase(), `${before}->${after} ${last.diff}`)
      }
      lib = await readLib(page)
      for (const i of [2, 4]) {               // generated medium, generated extreme
        await clickButton(page, 'Library')
        await playRow(page, i)
        await waitForBoard(page)
        const s = await readIds(page)
        const want = storedIds(lib[i])
        ck.ok(`Play row ${i} (${lib[i].diff}): grid ids === stored blob`, same(s.grid, want.grid))
        ck.ok(`Play row ${i}: rack ids === stored blob`, same(s.rack, want.rack), s.rack.join(','))
        ck.ok(`Play row ${i}: par = stored optimalMoves (${lib[i].optimalMoves}), pill ${lib[i].diff}`,
          s.par === String(lib[i].optimalMoves) && s.diff === lib[i].diff, `par ${s.par} pill ${s.diff}`)
      }
    } catch (e) { ck.crash('D/B', e) }

    // ---------------------------------------------------------------- F
    ck.section('F New / difficulty pill after a Library Play generates a fresh puzzle')
    try {
      await clickButton(page, 'Library')
      await playRow(page, 0)
      await waitForBoard(page)
      const saved = await readIds(page)
      await clickButton(page, 'New')
      await waitForBoard(page)
      const n1 = await readIds(page)
      // Anchored on the hand-built legacy puzzle: a generator cannot reproduce it,
      // whereas two generated extreme puzzles CAN coincide (few shapes per tier).
      ck.ok('New after Library Play generates a different puzzle (generated par shown)',
        !same(n1.grid, saved.grid) && /^\d+$/.test(n1.par) && saved.par === '—', `par ${saved.par} -> ${n1.par}, pill ${n1.diff}`)
      await clickButton(page, 'Library')
      await playRow(page, 0)
      await waitForBoard(page)
      await clickButton(page, 'easy')
      await waitForBoard(page)
      const e1 = await readIds(page)
      ck.ok('difficulty pill after Library Play generates an easy puzzle', e1.diff === 'easy' && !same(e1.grid, saved.grid), e1.diff)
      await clickButton(page, 'Library')
      await playRow(page, 0)
      await waitForBoard(page)
      await clickButton(page, 'Library')
      await clickButton(page, 'Play')        // NavBar Play: selection cleared on nav
      await waitForBoard(page)
      const nav = await readIds(page)
      ck.ok('NavBar Play after visiting Library generates, not the saved one', !same(nav.grid, saved.grid) && nav.diff === 'easy', `pill ${nav.diff}`)
    } catch (e) { ck.crash('F', e) }

    // ---------------------------------------------------------------- B2
    ck.section('B saved puzzle beats ?forceArchetype')
    try {
      await boot(page, url, lib, '?forceArchetype=cut-point')
      await clickButton(page, 'Library')
      await playRow(page, 0)
      await waitForBoard(page)
      const s = await readIds(page)
      ck.ok('?forceArchetype=cut-point: Library Play still loads the saved legacy puzzle',
        same(s.grid, expectedIds(LEGACY[0]).grid))
    } catch (e) { ck.crash('B2', e) }

    // ------------------------------------------------------------- C + E
    ck.section('C Editor: build, third copy refused, Save -> Library; E survives reload')
    try {
      await boot(page, url, lib)
      await clickButton(page, 'Library')
      const before = await libRowCount(page)
      await clickButton(page, '+ New Puzzle')
      const inp = await centre(page, 'input[placeholder="Puzzle name"]')
      await page.mouse('mouseMoved', inp.x, inp.y)
      await page.mouse('mousePressed', inp.x, inp.y)
      await page.mouse('mouseReleased', inp.x, inp.y)
      await page.session.send('Input.insertText', { text: 'Rig built' })
      await sleep(60)
      // board row 0 = red 1 2 3 (each pick fills the first empty slot)
      for (const n of [1, 2, 3]) await pickTile(page, await editorEmptyCell(page, 0), n)
      const ed = await page.eval(() => document.body.innerText)
      ck.ok('board shows the three placed tiles', /1\s*×[\s\S]*2\s*×[\s\S]*3\s*×/.test(ed))
      await pickTile(page, await editorPlus(page), 4)
      await pickTile(page, await editorPlus(page), 1)     // 2nd copy of red 1: allowed
      ck.ok('rack holds 4r + second 1r', (await editorRackCount(page)) === 2)
      await pickTile(page, await editorPlus(page), 1)     // 3rd copy: refused
      const msg = await page.eval(() => document.body.innerText)
      ck.ok('third copy of red 1 refused, rack unchanged', (await editorRackCount(page)) === 2)
      ck.ok('refusal message is visible', msg.includes('Only 2 copies of any tile are allowed.'))
      await clickButton(page, 'Save Puzzle')
      const after = await libRowCount(page)
      const st = await readLib(page)
      const saved = st[st.length - 1]
      ck.ok('Save returns to Library with one more row', after === before + 1 &&
        (await page.eval(() => document.body.innerText)).includes('Rig built'), `${before}->${after}`)
      ck.ok('stored editor puzzle has minted ids incl. copy 1',
        same(saved.rack.map(t => t.id), ['4_r_0', '1_r_1']) && saved.grid[0].slice(0, 3).map(t => t?.id).join() === '1_r_0,2_r_0,3_r_0',
        JSON.stringify(saved.rack))
      await playRow(page, after - 1)
      await waitForBoard(page)
      const s = await readIds(page)
      ck.ok('editor puzzle plays with its own ids, par hidden', same(s.grid, storedIds(saved).grid) && same(s.rack, storedIds(saved).rack) && s.par === '—', s.par)

      // E: reload
      await page.reload()
      await page.waitFor(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Library'),
        { label: 'remount', timeout: 30000 })
      await clickButton(page, 'Library')
      ck.ok('after reload: same row count', (await libRowCount(page)) === after)
      ck.ok('after reload: stored library unchanged', same(await readLib(page), st))

      // D: Delete
      const victim = st[1].id
      await clickNth(page, 'Delete', 1)
      const del = await readLib(page)
      ck.ok('Delete removes exactly that puzzle (row + storage)',
        (await libRowCount(page)) === after - 1 && del.length === st.length - 1 && !del.some(p => p.id === victim))
    } catch (e) { ck.crash('C/E', e) }

    ck.ok('no page exceptions during the whole run', page.exceptions.length === 0, page.exceptions.join(' | '))
  } finally {
    await page.close()
  }
  return ck.summary()
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const srv = await startServer()
  let res
  try { res = await run(srv.url) } finally { await srv.close() }
  process.exit(res.failed ? 1 : 0)
}

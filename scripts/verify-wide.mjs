/**
 * verify-wide.mjs — the widest shipped board on a phone. `?forceArchetype=
 * cut-point` at medium is an 8x12 grid = 650px at 100%, against 350px of
 * usable width on a 390px viewport. Run: `node scripts/verify-wide.mjs`, or
 * all via `npm run verify:mobile`.
 *
 * The point is REACHABILITY: both edges of the board must be reachable by
 * real touch panning — and the LEFT edge specifically, because plain
 * `justify-content: center` once pushed the first three columns past the left
 * edge where no scroll could reach them (`safe center` is the fix).
 */
import { pathToFileURL } from 'node:url'
import { launch, sleep } from './lib/cdp.mjs'
import {
  Checks, startServer, openPlay, readState, cellAt, boardCount,
  visibleEmptyCells, visibleCells,
} from './lib/app.mjs'

const PHONE = { width: 390, height: 844, mobile: true, touch: true, dpr: 2 }
const WIDE = { query: '?forceArchetype=cut-point', diff: 'medium' }

/** Columns fully inside the scroller's visible box. */
function visibleCols(s) {
  const sc = s.scroller
  return [...new Set(s.cells.filter(c => c.left >= sc.left - 0.5 && c.right <= sc.right + 0.5).map(c => c.c))]
    .sort((a, b) => a - b)
}

/** A point on the board's own padding strip (touch-action pan-x pan-y), centred. */
async function backgroundPoint(page) {
  return page.eval(() => {
    const inner = document.querySelector('[data-cell]').parentElement
    const sc = inner.parentElement.getBoundingClientRect()
    const r = inner.getBoundingClientRect()
    return { x: sc.left + sc.width / 2, y: r.top + parseFloat(getComputedStyle(inner).paddingTop) / 2 }
  })
}

/** Swipe horizontally on empty space; dx < 0 pans toward the RIGHT edge. */
async function swipe(page, at, dx) {
  await page.touchDrag(at, { x: at.x + dx, y: at.y }, { steps: 12, stepMs: 16, holdMs: 20 })
  await sleep(350) // let native scrolling settle (no fling at this speed, but be safe)
}

export async function run(url) {
  const ck = new Checks('WIDE-BOARD CHECKS')
  const page = await launch()
  try {
    await page.setViewport(PHONE)

    // ------------------------------------------------------------------ 1 ---
    ck.section('1  the widest board, 100%, 390px phone')
    let s0
    try {
      await openPlay(page, url, WIDE)
      s0 = await readState(page)
      ck.ok('forced archetype really built: cut-point',
        page.console.some(l => l.includes('archetypeId=cut-point diff=medium')),
        page.console.filter(l => l.includes('forceArchetype')).at(-1))
      ck.ok('grid is 8x12', s0.rows === 8 && s0.cols === 12, `${s0.rows}x${s0.cols}`)
      const sc = s0.scroller
      ck.ok('board is 650px wide (scrollWidth)', sc.scrollWidth === 650, `${sc.scrollWidth}`)
      ck.ok('visible width 350px -> pan range 300px',
        sc.clientWidth === 350 && sc.scrollWidth - sc.clientWidth === 300, `client ${sc.clientWidth}`)
      ck.ok('at scrollLeft 0, column 0 is FULLY visible (safe center; plain center hid cols 0-2)',
        sc.scrollLeft === 0 && visibleCols(s0)[0] === 0, `visible cols ${visibleCols(s0).join(',')}`)
      ck.ok('the right edge is NOT visible yet (so there is something to pan to)',
        !visibleCols(s0).includes(11))
    } catch (e) { ck.crash('wide board layout', e) }

    // ------------------------------------------------------------------ 2 ---
    ck.section('2  REAL touch panning reaches BOTH edges')
    try {
      const bg = await backgroundPoint(page)
      for (let i = 0; i < 4; i++) await swipe(page, bg, -140)
      const right = await readState(page)
      const rec = await page.takeRecord()
      ck.ok('swipes reached the page as trusted touch events',
        rec.filter(e => e.type.startsWith('touch')).length > 0 && rec.every(e => e.isTrusted))
      ck.ok('panning on board background scrolled to the far right (scrollLeft 300)',
        right.scroller.scrollLeft === 300, `scrollLeft ${right.scroller.scrollLeft}`)
      ck.ok('column 11 (the last) is fully visible', visibleCols(right).includes(11), `cols ${visibleCols(right).join(',')}`)
      ck.ok('panning started no drag and moved nothing', right.moves === 0 && right.preview === null)

      for (let i = 0; i < 4; i++) await swipe(page, bg, +140)
      const left = await readState(page)
      ck.ok('panning back reaches scrollLeft 0', left.scroller.scrollLeft === 0, `${left.scroller.scrollLeft}`)
      ck.ok('column 0 is fully visible again', visibleCols(left)[0] === 0, `cols ${visibleCols(left).join(',')}`)

      const E = visibleEmptyCells(left)[0]
      if (E) {
        await swipe(page, { x: E.x, y: E.y }, -120)
        const s = await readState(page)
        ck.ok('a swipe starting on an EMPTY cell also pans (touch-action auto)',
          s.scroller.scrollLeft > 0 && s.moves === 0 && s.preview === null, `scrollLeft ${s.scroller.scrollLeft}`)
        for (let i = 0; i < 2; i++) await swipe(page, bg, +140)
      } else {
        ck.ok('a visible empty cell exists to swipe from', false)
      }

      const s1 = await readState(page)
      const T = visibleCells(s1, c => c.occupied)[0]
      await page.touchDrag({ x: T.x, y: T.y }, { x: T.x - 120, y: T.y }, { lift: false })
      const s2 = await readState(page)
      await page.touchCancel(); await sleep(120)
      const s3 = await readState(page)
      ck.ok('a swipe starting on a TILE does NOT pan (touch-action none)...',
        s2.scroller.scrollLeft === s1.scroller.scrollLeft, `${s1.scroller.scrollLeft} -> ${s2.scroller.scrollLeft}`)
      ck.ok('...it starts a DRAG of that tile instead', s2.preview?.sig === T.sig)
      ck.ok('(cancelled cleanly: nothing moved, styles restored)',
        s3.moves === s1.moves && cellAt(s3, T.r, T.c).sig === T.sig && s3.bodyCursor === '' && s3.preview === null)
    } catch (e) { ck.crash('touch panning', e) }

    // ------------------------------------------------------------------ 3 ---
    ck.section('3  touch drag onto the LAST column after panning there')
    try {
      await openPlay(page, url, WIDE)
      const bg = await backgroundPoint(page)
      for (let i = 0; i < 4; i++) await swipe(page, bg, -140)
      const s0 = await readState(page)
      // cut-point's rack is SECOND COPIES: every rack tile has an identical
      // twin on the board, so no rack tile is unique by signature. Assert via
      // the cell's content plus the board count of that signature instead.
      const R = s0.rack[0]
      // An empty cell in column 11 if there is one; otherwise an occupied one
      // (RACK -> occupied GRID displaces that tile back to the rack).
      const col11 = s0.cells.filter(c => c.c === 11)
      const D = col11.find(c => !c.occupied) ?? col11.find(c => c.sig !== R.sig)
      await page.touchDrag({ x: R.x, y: R.y }, { x: D.x, y: D.y }); await sleep(150)
      const s1 = await readState(page)
      ck.ok(`rack tile landed in column 11 (cell ${D.r},11, ${D.occupied ? 'occupied -> displaced' : 'empty'})`,
        cellAt(s1, D.r, 11).sig === R.sig, `${cellAt(s1, D.r, 11).sig} vs ${R.sig}`)
      ck.ok('board now holds one MORE copy of that tile',
        boardCount(s1, R.sig) === boardCount(s0, R.sig) + 1, `${boardCount(s0, R.sig)} -> ${boardCount(s1, R.sig)}`)
      ck.ok('move counter +1', s1.moves === s0.moves + 1)
      ck.ok('rack count right (-1, or unchanged if a tile was displaced back)',
        s1.rackCount === s0.rackCount - (D.occupied ? 0 : 1), `${s0.rackCount} -> ${s1.rackCount}`)
    } catch (e) { ck.crash('drop at last column', e) }

    // ------------------------------------------------------------------ 4 ---
    ck.section('4  50%: the widest board fits a phone with NO scrolling')
    try {
      await openPlay(page, url, { ...WIDE, scale: 0.5 })
      const s0 = await readState(page)
      ck.ok('board fits the 350px viewport: NO horizontal overflow (scrollWidth == clientWidth)',
        s0.scroller.scrollWidth === s0.scroller.clientWidth && s0.scroller.scrollWidth <= 350,
        `scrollWidth ${s0.scroller.scrollWidth}, client ${s0.scroller.clientWidth}`)
      ck.ok('all 12 columns visible at once', visibleCols(s0).length === 12, `${visibleCols(s0).length}`)
      const R = s0.rack[0]
      const col11 = s0.cells.filter(c => c.c === 11)
      const D = col11.find(c => !c.occupied) ?? col11.find(c => c.sig !== R.sig)
      await page.touchDrag({ x: R.x, y: R.y }, { x: D.x, y: D.y }); await sleep(150)
      const s1 = await readState(page)
      ck.ok('touch drag at 50% on a phone viewport lands (rack -> column 11)',
        cellAt(s1, D.r, 11).sig === R.sig && boardCount(s1, R.sig) === boardCount(s0, R.sig) + 1 &&
        s1.moves === s0.moves + 1, `cell ${D.r},11 = ${cellAt(s1, D.r, 11).sig}, moves ${s0.moves} -> ${s1.moves}`)
    } catch (e) { ck.crash('50% wide board', e) }

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

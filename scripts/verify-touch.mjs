/**
 * verify-touch.mjs — the touch-drag checks (commit 92b805e, "Touch drag: full
 * touch support"). Run: `node scripts/verify-touch.mjs`, or all mobile checks
 * via `npm run verify:mobile`.
 *
 * Every check asserts on OUTCOMES read back from the real DOM — the tile in the
 * target cell, the source emptied, the move counter, body styles — AND on what
 * the page actually received, via the in-page event recorder (see cdp.mjs). A
 * dispatch that never reached the app therefore fails instead of passing.
 *
 * Sections:
 *   0  driver self-check      the rig re-proves its own touch contract
 *   1  rack -> board          + implicit capture + preventDefault took effect
 *   2  board -> board         empty target
 *   3  board -> board swap    occupied target, one move
 *   4  board -> rack
 *   5  compatibility mouse    touchend then mouse at the same spot: no-op;
 *                             after 500ms mouse works again (guard expires)
 *   6  touchcancel            endDrag ran, body styles restored, no drop
 *   7  multi-touch            2nd finger mid-drag sits at touches[0]; drag
 *                             unaffected, lifting it drops nothing
 *   8  mouse regression       rack/grid/swap/rack drops + undo, desktop
 *   9  stale-target race      8 rapid zero-settle mouse drags land correctly
 */
import { pathToFileURL } from 'node:url'
import { launch, sleep } from './lib/cdp.mjs'
import {
  Checks, startServer, openPlay, readState, cellAt, clickButton,
  uniqueTileCells, uniqueRackTiles, visibleEmptyCells, visibleCells,
} from './lib/app.mjs'

const PHONE = { width: 390, height: 844, mobile: true, touch: true, dpr: 2 }
const DESKTOP = { width: 1100, height: 950, mobile: false, touch: false, dpr: 1 }
const TOUCH_LIFT = 28 // DragPreview.tsx

const pt = c => ({ x: c.x, y: c.y })
const touchesOf = (rec, type) => rec.filter(e => e.type === type)

/** Load a fresh easy puzzle on a phone, retrying until it has what a test needs. */
async function freshPhone(page, url, need = s => true) {
  for (let i = 0; i < 8; i++) {
    await openPlay(page, url)
    const s = await readState(page)
    if (need(s)) return s
  }
  throw new Error('no puzzle satisfied the test preconditions in 8 tries')
}

export async function run(url) {
  const ck = new Checks('TOUCH-DRAG CHECKS')
  const page = await launch()
  try {
    await page.setViewport(PHONE)

    // ------------------------------------------------------------------ 0 ---
    ck.section('0  driver self-check — CDP touch contract, observed in-page')
    try {
      const s = await freshPhone(page, url, s => uniqueTileCells(s).length >= 2)
      const [A, B] = uniqueTileCells(s)
      await page.touchStart(7, A.x, A.y); await sleep(30)
      await page.touchStart(3, B.x, B.y); await sleep(30)
      await page.touchEnd(3); await sleep(30)
      await page.touchEnd(7); await sleep(60)
      const all = touchesOf(await page.takeRecord(), 'touchstart')
      ck.ok('touchstart events reach the page as trusted TouchEvents',
        all.length === 2 && all.every(e => e.isTrusted), `${all.length} touchstarts`)
      ck.ok('DOM identifiers are the CDP ids (7, then 3)',
        all[0]?.changed?.[0] === 7 && all[1]?.changed?.[0] === 3,
        `got ${JSON.stringify(all.map(e => e.changed))}`)
      ck.ok('second finger (id 3) is ordered FIRST in touches — the touches[0] trap is live',
        JSON.stringify(all[1]?.touches) === '[3,7]', `touches=${JSON.stringify(all[1]?.touches)}`)
    } catch (e) { ck.crash('driver self-check', e) }

    try {
      const s = await freshPhone(page, url, s => uniqueTileCells(s).length >= 2)
      const [A, B] = uniqueTileCells(s)
      await page.touchStart(7, A.x, A.y); await sleep(30)
      await page.touchStart(3, B.x, B.y); await sleep(30)
      await page.touchEnd(3); await sleep(30)
      const ends1 = touchesOf(await page.takeRecord(), 'touchend')
      await page.touchEnd(7); await sleep(60)
      const ends2 = touchesOf(await page.takeRecord(), 'touchend')
      ck.ok('touchEnd(3) lifts ONLY finger 3; finger 7 stays down',
        ends1.length === 1 && ends1[0].changed[0] === 3 && JSON.stringify(ends1[0].touches) === '[7]',
        JSON.stringify(ends1.map(e => [e.changed, e.touches])))
      ck.ok('touchEnd(7) then lifts finger 7 with nothing left down',
        ends2.length === 1 && ends2[0].changed[0] === 7 && ends2[0].touches.length === 0,
        JSON.stringify(ends2.map(e => [e.changed, e.touches])))
    } catch (e) { ck.crash('driver lift semantics', e) }

    // ------------------------------------------------------------------ 1 ---
    ck.section('1  rack -> board by touch')
    try {
      const s0 = await freshPhone(page, url, s => uniqueRackTiles(s).length && visibleEmptyCells(s).length)
      const R = uniqueRackTiles(s0)[0]
      const E = visibleEmptyCells(s0)[0]
      await page.touchDrag(pt(R), pt(E), { lift: false })
      const mid = await readState(page)
      await page.touchEnd(1); await sleep(120)
      const s1 = await readState(page)
      const rec = await page.takeRecord()
      const starts = touchesOf(rec, 'touchstart'), moves = touchesOf(rec, 'touchmove'), ends = touchesOf(rec, 'touchend')

      ck.ok('page received touchstart -> 10 touchmoves -> touchend, all trusted',
        starts.length === 1 && moves.length === 10 && ends.length === 1 &&
        [...starts, ...moves, ...ends].every(e => e.isTrusted),
        `${starts.length}/${moves.length}/${ends.length}`)
      ck.ok('IMPLICIT CAPTURE is real: every touchmove targets the ORIGIN (rack), none the destination cell',
        moves.every(e => e.target === 'rack'), `targets: ${[...new Set(moves.map(e => e.target))].join(',')}`)
      ck.ok('app preventDefault took effect on every touchmove (listener is genuinely non-passive)',
        moves.every(e => e.defaultPrevented === true), `${moves.filter(e => e.defaultPrevented).length}/${moves.length}`)
      ck.ok('app preventDefault took effect on the touchend', ends[0]?.defaultPrevented === true)
      ck.ok('mid-drag: preview shows the dragged tile', mid.preview?.sig === R.sig, `${mid.preview?.sig} vs ${R.sig}`)
      ck.ok('mid-drag: preview is LIFTED above the finger (bottom <= y - 28)',
        mid.preview && mid.preview.bottom <= E.y - TOUCH_LIFT + 0.5 && Math.abs(mid.preview.x - E.x) < 1,
        mid.preview ? `preview bottom ${mid.preview.bottom.toFixed(1)}, finger y ${E.y.toFixed(1)}` : 'no preview')
      ck.ok('mid-drag: body userSelect "none", cursor "grabbing"',
        mid.bodyUserSelect === 'none' && mid.bodyCursor === 'grabbing', `${mid.bodyUserSelect}/${mid.bodyCursor}`)
      ck.ok('tile landed in the target cell', cellAt(s1, E.r, E.c).sig === R.sig, `cell ${E.r},${E.c} = ${cellAt(s1, E.r, E.c).sig}`)
      ck.ok('rack shrank by exactly 1 and no longer holds the tile',
        s1.rackCount === s0.rackCount - 1 && !s1.rack.some(t => t.sig === R.sig), `${s0.rackCount} -> ${s1.rackCount}`)
      ck.ok('move counter +1', s1.moves === s0.moves + 1, `${s0.moves} -> ${s1.moves}`)
      ck.ok('after drop: body styles restored, preview gone',
        s1.bodyUserSelect === '' && s1.bodyCursor === '' && s1.preview === null)
    } catch (e) { ck.crash('rack -> board', e) }

    // ------------------------------------------------------------------ 2 ---
    ck.section('2  board -> board by touch (empty target)')
    try {
      const s0 = await freshPhone(page, url, s => visibleCells(s, c => uniqueTileCells(s).includes(c)).length && visibleEmptyCells(s).length)
      const S = visibleCells(s0, c => uniqueTileCells(s0).includes(c))[0]
      const E = visibleEmptyCells(s0).at(-1)
      await page.touchDrag(pt(S), pt(E)); await sleep(120)
      const s1 = await readState(page)
      const rec = await page.takeRecord()
      ck.ok('events trusted and aimed at the origin cell',
        rec.filter(e => e.type.startsWith('touch')).every(e => e.isTrusted && e.target === `cell:${S.r},${S.c}`))
      ck.ok('tile moved to the target cell', cellAt(s1, E.r, E.c).sig === S.sig)
      ck.ok('source cell is now empty', !cellAt(s1, S.r, S.c).occupied)
      ck.ok('move counter +1, rack unchanged', s1.moves === s0.moves + 1 && s1.rackCount === s0.rackCount,
        `moves ${s0.moves}->${s1.moves}, rack ${s0.rackCount}->${s1.rackCount}`)
    } catch (e) { ck.crash('board -> board', e) }

    // ------------------------------------------------------------------ 3 ---
    ck.section('3  board -> board SWAP by touch (occupied target, one move)')
    try {
      const s0 = await freshPhone(page, url, s => visibleCells(s, c => uniqueTileCells(s).includes(c)).length >= 2)
      const [S, T] = [visibleCells(s0, c => uniqueTileCells(s0).includes(c))[0], visibleCells(s0, c => uniqueTileCells(s0).includes(c)).at(-1)]
      await page.touchDrag(pt(S), pt(T)); await sleep(120)
      const s1 = await readState(page)
      ck.ok('the two tiles swapped cells',
        cellAt(s1, T.r, T.c).sig === S.sig && cellAt(s1, S.r, S.c).sig === T.sig,
        `${S.sig}@${S.r},${S.c} <-> ${T.sig}@${T.r},${T.c}`)
      ck.ok('exactly one move', s1.moves === s0.moves + 1)
    } catch (e) { ck.crash('swap', e) }

    // ------------------------------------------------------------------ 4 ---
    ck.section('4  board -> rack by touch')
    try {
      const s0 = await freshPhone(page, url, s => visibleCells(s, c => uniqueTileCells(s).includes(c)).length)
      const S = visibleCells(s0, c => uniqueTileCells(s0).includes(c))[0]
      const dest = { x: s0.rackBox.right - 12, y: s0.rackBox.y } // rack background, right end
      await page.touchDrag(pt(S), dest); await sleep(120)
      const s1 = await readState(page)
      ck.ok('tile left the board', !cellAt(s1, S.r, S.c).occupied)
      ck.ok('rack +1 and now holds the tile', s1.rackCount === s0.rackCount + 1 && s1.rack.some(t => t.sig === S.sig),
        `${s0.rackCount} -> ${s1.rackCount}`)
      ck.ok('move counter +1', s1.moves === s0.moves + 1)
    } catch (e) { ck.crash('board -> rack', e) }

    // ------------------------------------------------------------------ 5 ---
    ck.section('5  compatibility mouse events after touchend (the highest-risk item)')
    try {
      const s0 = await freshPhone(page, url, s =>
        visibleCells(s, c => uniqueTileCells(s).includes(c)).length && visibleEmptyCells(s).length >= 2)
      const S = visibleCells(s0, c => uniqueTileCells(s0).includes(c))[0]
      const [E, F] = [visibleEmptyCells(s0)[0], visibleEmptyCells(s0).at(-1)]
      await page.touchDrag(pt(S), pt(E))
      // IMMEDIATELY — no sleep — the synthetic mouse sequence a browser emits
      // at the lift point, plus a drag toward F: if the guard failed, this
      // would start a second drag from E and drop the tile on F.
      await page.mouseDrag(pt(E), pt(F), { steps: 3 })
      await sleep(150)
      const s1 = await readState(page)
      const rec = await page.takeRecord()
      const tEnd = rec.find(e => e.type === 'touchend')
      const mDown = rec.find(e => e.type === 'mousedown')
      const mUp = rec.find(e => e.type === 'mouseup')
      ck.ok('the synthetic mousedown/mouseup DID reach the page, on the tile, inside the 500ms window',
        mDown?.isTrusted && mUp?.isTrusted && mDown.target === `cell:${E.r},${E.c}` && mDown.t - tEnd.t < 500,
        mDown ? `mousedown ${Math.round(mDown.t - tEnd.t)}ms after touchend on ${mDown.target}` : 'no mousedown recorded')
      ck.ok('the touch drag itself landed: tile in E, moves +1',
        cellAt(s1, E.r, E.c).sig === S.sig && s1.moves === s0.moves + 1, `moves ${s0.moves} -> ${s1.moves}`)
      ck.ok('NO double action: F still empty, move counter NOT incremented again',
        !cellAt(s1, F.r, F.c).occupied && s1.moves === s0.moves + 1)
      ck.ok('no phantom drag left running: no preview, body cursor ""',
        s1.preview === null && s1.bodyCursor === '' && s1.bodyUserSelect === '')

      // The guard must EXPIRE — a guard that wedges mouse input forever would
      // also "pass" the checks above.
      await sleep(550)
      await page.mouseDrag(pt(E), pt(F), { steps: 3 }); await sleep(120)
      const s2 = await readState(page)
      ck.ok('after the window expires, the SAME mouse drag works (guard never wedges)',
        cellAt(s2, F.r, F.c).sig === S.sig && !cellAt(s2, E.r, E.c).occupied && s2.moves === s1.moves + 1,
        `moves ${s1.moves} -> ${s2.moves}`)
      await page.takeRecord()

      // Tap variant: a touch with NO movement, then a click-shaped mouse
      // sequence at the same point. Must neither move anything nor strand a drag.
      await sleep(550)
      const s3 = await readState(page)
      const G = cellAt(s3, F.r, F.c)
      await page.touchStart(1, G.x, G.y); await sleep(40); await page.touchEnd(1)
      await page.mouse('mouseMoved', G.x, G.y)
      await page.mouse('mousePressed', G.x, G.y)
      await page.mouse('mouseReleased', G.x, G.y)
      await sleep(120)
      const s4 = await readState(page)
      ck.ok('tap + compat click: board unchanged, moves unchanged, no drag running',
        s4.cells.map(c => c.sig).join() === s3.cells.map(c => c.sig).join() &&
        s4.moves === s3.moves && s4.preview === null && s4.bodyCursor === '')
    } catch (e) { ck.crash('compat mouse', e) }

    // ------------------------------------------------------------------ 6 ---
    ck.section('6  touchcancel mid-drag')
    try {
      const s0 = await freshPhone(page, url, s =>
        visibleCells(s, c => uniqueTileCells(s).includes(c)).length && visibleEmptyCells(s).length)
      const S = visibleCells(s0, c => uniqueTileCells(s0).includes(c))[0]
      const E = visibleEmptyCells(s0)[0]
      await page.touchDrag(pt(S), pt(E), { lift: false })
      const mid = await readState(page)
      ck.ok('mid-drag: userSelect "none", cursor "grabbing", preview present',
        mid.bodyUserSelect === 'none' && mid.bodyCursor === 'grabbing' && mid.preview !== null)
      await page.touchCancel(); await sleep(120)
      const s1 = await readState(page)
      const rec = await page.takeRecord()
      ck.ok('page received a trusted touchcancel', rec.some(e => e.type === 'touchcancel' && e.isTrusted))
      ck.ok('endDrag() ran: userSelect and cursor restored to ""',
        s1.bodyUserSelect === '' && s1.bodyCursor === '', `"${mid.bodyUserSelect}"->"${s1.bodyUserSelect}", "${mid.bodyCursor}"->"${s1.bodyCursor}"`)
      ck.ok('preview removed', s1.preview === null)
      ck.ok('NO drop: tile still at source, target still empty, moves unchanged',
        cellAt(s1, S.r, S.c).sig === S.sig && !cellAt(s1, E.r, E.c).occupied && s1.moves === s0.moves)
      await page.touchDrag(pt(S), pt(E)); await sleep(120)
      const s2 = await readState(page)
      ck.ok('a fresh touch drag afterwards works (nothing wedged)',
        cellAt(s2, E.r, E.c).sig === S.sig && s2.moves === s0.moves + 1)
    } catch (e) { ck.crash('touchcancel', e) }

    // ------------------------------------------------------------------ 7 ---
    ck.section('7  multi-touch: a second finger mid-drag')
    try {
      const s0 = await freshPhone(page, url, s =>
        visibleCells(s, c => uniqueTileCells(s).includes(c)).length >= 2 && visibleEmptyCells(s).length >= 3)
      const tiles = visibleCells(s0, c => uniqueTileCells(s0).includes(c))
      const S = tiles[0], U = tiles.at(-1)
      const empties = visibleEmptyCells(s0)
      // Y (the decoy) is the empty cell FARTHEST from X in 2-D, so "the
      // preview followed the wrong finger" cannot hide behind X and Y sharing
      // a row or column. Z is any third empty cell.
      const X = empties[0]
      const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
      const Y = empties.reduce((far, c) => dist(c, X) > dist(far, X) ? c : far, empties[1])
      const Z = empties.find(c => c !== X && c !== Y)
      await page.takeRecord()

      // Finger 7 drags S toward X.
      await page.touchDrag(pt(S), pt(X), { id: 7, lift: false })
      // Finger 3 lands on ANOTHER tile. Chrome orders touches by id, so finger
      // 3 is now touches[0] — an implementation indexing [0] would switch to it.
      await page.touchStart(3, U.x, U.y); await sleep(40)
      const m1 = await readState(page)
      await page.touchGlide(3, pt(U), pt(Y))
      const m2 = await readState(page)
      await page.touchEnd(3); await sleep(80)
      const m3 = await readState(page)
      await page.touchGlide(7, pt(X), pt(Z))
      await page.touchEnd(7); await sleep(120)
      const s1 = await readState(page)
      const rec = await page.takeRecord()

      const start3 = rec.find(e => e.type === 'touchstart' && e.changed[0] === 3)
      ck.ok('page saw finger 3 arrive with touches = [3,7] (the wrong finger at index 0)',
        JSON.stringify(start3?.touches) === '[3,7]', `touches=${JSON.stringify(start3?.touches)}`)
      ck.ok('after finger 3 lands, the drag still carries tile S (not U)', m1.preview?.sig === S.sig,
        `${m1.preview?.sig} vs S=${S.sig} U=${U.sig}`)
      // Where the preview must sit for a finger at (fx, fy): centred on x,
      // bottom edge TOUCH_LIFT above the finger (DragPreview.tsx).
      const offBy = (p, f) => Math.hypot(p.x - f.x, p.bottom - (f.y - TOUCH_LIFT))
      ck.ok('while finger 3 moves to Y, the preview stays on finger 7 (at X)',
        m2.preview && offBy(m2.preview, X) < 1 && offBy(m2.preview, Y) > 40,
        m2.preview ? `off X by ${offBy(m2.preview, X).toFixed(1)}px, off Y by ${offBy(m2.preview, Y).toFixed(1)}px` : 'no preview')
      ck.ok('lifting finger 3 dropped NOTHING: drag still live, moves unchanged, S still at source',
        m3.preview?.sig === S.sig && m3.moves === s0.moves && cellAt(m3, S.r, S.c).sig === S.sig)
      ck.ok('finger 7 lift drops S at Z — the ORIGINAL finger\'s target',
        cellAt(s1, Z.r, Z.c).sig === S.sig && !cellAt(s1, S.r, S.c).occupied)
      ck.ok('decoy cell Y (finger 3\'s target) and X stayed empty',
        !cellAt(s1, Y.r, Y.c).occupied && !cellAt(s1, X.r, X.c).occupied)
      ck.ok('finger 3\'s tile U never moved', cellAt(s1, U.r, U.c).sig === U.sig)
      ck.ok('exactly ONE move for the whole gesture', s1.moves === s0.moves + 1, `${s0.moves} -> ${s1.moves}`)
      ck.ok('body styles restored after the gesture', s1.bodyUserSelect === '' && s1.bodyCursor === '' && s1.preview === null)
    } catch (e) { ck.crash('multi-touch', e) }

    // ------------------------------------------------------------------ 8 ---
    await page.setViewport(DESKTOP)
    ck.section('8  mouse path unregressed (desktop viewport)')
    try {
      let s0
      for (let i = 0; i < 8; i++) {
        await openPlay(page, url)
        s0 = await readState(page)
        if (uniqueRackTiles(s0).length && uniqueTileCells(s0).length >= 3 && visibleEmptyCells(s0).length >= 2) break
      }
      const R = uniqueRackTiles(s0)[0]
      const E = visibleEmptyCells(s0)[0]
      await page.mouseDrag(pt(R), pt(E)); await sleep(100)
      let s1 = await readState(page)
      ck.ok('mouse rack -> board: tile lands, rack -1, moves +1',
        cellAt(s1, E.r, E.c).sig === R.sig && s1.rackCount === s0.rackCount - 1 && s1.moves === s0.moves + 1)

      const tiles = uniqueTileCells(s1).filter(c => !(c.r === E.r && c.c === E.c))
      const [A, B] = [tiles[0], tiles.at(-1)]
      await page.mouseDrag(pt(A), pt(B)); await sleep(100)
      let s2 = await readState(page)
      ck.ok('mouse swap: two tiles exchange cells in one move',
        cellAt(s2, B.r, B.c).sig === A.sig && cellAt(s2, A.r, A.c).sig === B.sig && s2.moves === s1.moves + 1)

      const F = visibleEmptyCells(s2).at(-1)
      await page.mouseDrag(pt(cellAt(s2, B.r, B.c)), pt(F)); await sleep(100)
      let s3 = await readState(page)
      ck.ok('mouse board -> empty cell', cellAt(s3, F.r, F.c).sig === A.sig && !cellAt(s3, B.r, B.c).occupied && s3.moves === s2.moves + 1)

      await page.mouseDrag(pt(cellAt(s3, F.r, F.c)), { x: s3.rackBox.right - 12, y: s3.rackBox.y }); await sleep(100)
      const s4 = await readState(page)
      ck.ok('mouse board -> rack: rack +1, moves +1',
        !cellAt(s4, F.r, F.c).occupied && s4.rackCount === s3.rackCount + 1 && s4.moves === s3.moves + 1)

      await clickButton(page, 'Undo')
      const s5 = await readState(page)
      ck.ok('Undo restores the previous board exactly',
        s5.cells.map(c => c.sig).join() === s3.cells.map(c => c.sig).join() && s5.rackCount === s3.rackCount)
      ck.ok('no drag left running, body styles clean', s5.preview === null && s5.bodyCursor === '' && s5.bodyUserSelect === '')
      ck.ok('no page exceptions during the whole run', page.exceptions.length === 0, page.exceptions.join(' | '))
    } catch (e) { ck.crash('mouse regression', e) }

    // ------------------------------------------------------------------ 9 ---
    ck.section('9  stale-target race: 8 rapid ZERO-settle mouse drags (hoverTargetRef fix)')
    try {
      await openPlay(page, url)
      let landed = 0
      const log = []
      for (let i = 0; i < 8; i++) {
        const s = await readState(page)
        const src = uniqueTileCells(s)[i % uniqueTileCells(s).length]
        const empties = visibleEmptyCells(s)
        const dst = empties[(i * 5 + 3) % empties.length]
        // steps:1 — ONE mousemove onto the target, then release with no wait:
        // the tightest window for a stale hover target.
        await page.mouseDrag(pt(src), pt(dst), { steps: 1, settleMs: 0 })
        const t = await readState(page)
        const ok = cellAt(t, dst.r, dst.c).sig === src.sig && !cellAt(t, src.r, src.c).occupied && t.moves === s.moves + 1
        if (ok) landed++
        log.push(`${src.r},${src.c}->${dst.r},${dst.c}:${ok ? 'ok' : 'MISS'}`)
      }
      ck.ok('8/8 zero-settle drags landed on the correct cell', landed === 8, `${landed}/8  ${log.join(' ')}`)
    } catch (e) { ck.crash('stale-target race', e) }
  } finally {
    await page.close()
  }
  return ck.summary()
}

// Standalone: `node scripts/verify-touch.mjs`
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const srv = await startServer()
  let res
  try { res = await run(srv.url) } finally { await srv.close() }
  process.exit(res.failed ? 1 : 0)
}

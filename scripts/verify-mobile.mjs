/**
 * verify-mobile.mjs — the mobile-groundwork checks (commit f488f6f): the
 * touch-action split, board-scale presets and their persistence, the
 * resize-not-transform rule, and drag+drop at every scale.
 * Run: `node scripts/verify-mobile.mjs`, or all via `npm run verify:mobile`.
 *
 * Every value is read back from COMPUTED styles / layout in a real Chrome,
 * never from source.
 */
import { pathToFileURL } from 'node:url'
import { launch, sleep } from './lib/cdp.mjs'
import {
  Checks, startServer, openPlay, readState, cellAt, clickButton,
  uniqueRackTiles, visibleEmptyCells,
} from './lib/app.mjs'

const PHONE = { width: 390, height: 844, mobile: true, touch: true, dpr: 2 }
const DESKTOP = { width: 1100, height: 950, mobile: false, touch: false, dpr: 1 }

// tileMetrics(scale) from src/lib/boardScale.ts, restated independently so a
// regression there cannot silently move the goalposts.
const EXPECT = {
  0.5: { w: 23, h: 29, gap: 3, pad: 8 },
  0.75: { w: 35, h: 44, gap: 5, pad: 12 },
  1: { w: 46, h: 58, gap: 6, pad: 16 },
  1.25: { w: 58, h: 73, gap: 8, pad: 20 },
}

/** Computed layout facts for the board and rack. */
//
// Sizes are LAYOUT sizes (offsetWidth/offsetHeight), which is exactly what
// "real pixel dimensions, never transform" means — and which the tile-land
// keyframe (scale 0.85 -> 1.05 -> 1 on every freshly mounted tile) cannot
// perturb. getBoundingClientRect would catch that animation mid-flight.
// Transforms are read only after each tile's finite animations have finished.
function measure(page) {
  return page.eval(async () => {
    const settle = el => el ? Promise.all(el.getAnimations()
      .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
      .map(a => a.finished.catch(() => {}))) : null
    const occ = [...document.querySelectorAll('[data-cell]')].find(c => c.firstElementChild)
    const empty = [...document.querySelectorAll('[data-cell]')].find(c => !c.firstElementChild)
    const inner = document.querySelector('[data-cell]').parentElement
    const scroller = inner.parentElement
    const rack = document.querySelector('[data-rack]')
    const rackTile = rack.firstElementChild
    const cs = el => el ? getComputedStyle(el) : null
    const size = el => el ? { w: el.offsetWidth, h: el.offsetHeight } : null
    await settle(occ?.firstElementChild)
    await settle(rackTile?.firstElementChild)
    const cols = Math.max(...[...document.querySelectorAll('[data-cell]')].map(c => +c.getAttribute('data-cell').split(',')[1])) + 1
    return {
      cols,
      touchAction: {
        occupiedCell: cs(occ)?.touchAction,
        rackTile: cs(rackTile)?.touchAction,
        emptyCell: cs(empty)?.touchAction,
        scroller: cs(scroller).touchAction,
        boardBackground: cs(inner).touchAction,
        rackBackground: cs(rack).touchAction,
      },
      tile: size(occ?.firstElementChild),
      rackTileSize: size(rackTile?.firstElementChild),
      emptyCell: size(empty),
      innerWidth: inner.offsetWidth,
      gap: parseFloat(cs(inner).columnGap),
      pad: parseFloat(cs(inner).paddingLeft),
      transforms: [scroller, inner, occ, occ?.firstElementChild, rackTile?.firstElementChild]
        .filter(Boolean).map(el => cs(el).transform),
      stored: localStorage.getItem('puzzikub_board_scale'),
    }
  })
}

export async function run(url) {
  const ck = new Checks('MOBILE-GROUNDWORK CHECKS')
  const page = await launch()
  try {
    await page.setViewport(PHONE)

    // ------------------------------------------------------------------ 1 ---
    ck.section('1  default scale is 100% = the original 46x58 (no visual change)')
    try {
      await openPlay(page, url)
      const m = await measure(page)
      ck.ok('nothing stored -> board tile 46x58', m.tile.w === 46 && m.tile.h === 58, `${m.tile.w}x${m.tile.h}`)
      ck.ok('rack tile matches board tile', m.rackTileSize.w === 46 && m.rackTileSize.h === 58)

    // ------------------------------------------------------------------ 2 ---
      ck.section('2  the touch-action split, from COMPUTED styles')
      const ta = m.touchAction
      ck.ok('occupied board cell = none (reserved for drag)', ta.occupiedCell === 'none', ta.occupiedCell)
      ck.ok('rack tile = none (reserved for drag)', ta.rackTile === 'none', ta.rackTile)
      ck.ok('empty board cell = auto (pans natively)', ta.emptyCell === 'auto', ta.emptyCell)
      ck.ok('board scroll container = pan-x pan-y', ta.scroller === 'pan-x pan-y', ta.scroller)
      ck.ok('board background/padding = pan-x pan-y', ta.boardBackground === 'pan-x pan-y', ta.boardBackground)
      ck.ok('rack background = pan-x pan-y', ta.rackBackground === 'pan-x pan-y', ta.rackBackground)
    } catch (e) { ck.crash('default / touch-action', e) }

    // ------------------------------------------------------------------ 3 ---
    ck.section('3  every preset: REAL pixel resize, never transform; touch drag lands')
    for (const scale of [0.5, 0.75, 1, 1.25]) {
      try {
        const e = EXPECT[scale]
        let s0
        for (let i = 0; i < 8; i++) {
          await openPlay(page, url, { scale })
          s0 = await readState(page)
          if (uniqueRackTiles(s0).length && visibleEmptyCells(s0).length) break
        }
        const m = await measure(page)
        const pct = `${scale * 100}%`
        ck.ok(`${pct}: board tile ${e.w}x${e.h}`, m.tile.w === e.w && m.tile.h === e.h, `${m.tile.w}x${m.tile.h}`)
        ck.ok(`${pct}: rack tile and empty cell match`,
          m.rackTileSize.w === e.w && m.rackTileSize.h === e.h && m.emptyCell.w === e.w && m.emptyCell.h === e.h,
          `rack ${m.rackTileSize.w}x${m.rackTileSize.h}, empty ${m.emptyCell.w}x${m.emptyCell.h}`)
        const wantWidth = m.cols * e.w + (m.cols - 1) * e.gap + 2 * e.pad
        ck.ok(`${pct}: board LAYOUT width = cols*w + gaps + padding (${wantWidth}px)`,
          Math.abs(m.innerWidth - wantWidth) < 0.5 && m.gap === e.gap && m.pad === e.pad,
          `${m.cols} cols -> ${m.innerWidth}px, gap ${m.gap}, pad ${m.pad}`)
        ck.ok(`${pct}: computed transform is "none" on scroller, grid, cell, tile, rack tile`,
          m.transforms.every(t => t === 'none'), m.transforms.join(','))

        const R = uniqueRackTiles(s0)[0], E = visibleEmptyCells(s0)[0]
        await page.touchDrag({ x: R.x, y: R.y }, { x: E.x, y: E.y }, { lift: false })
        const mid = await readState(page)
        await page.touchEnd(1); await sleep(120)
        const s1 = await readState(page)
        ck.ok(`${pct}: drag preview is the same size as the tiles`,
          mid.preview && Math.abs(mid.preview.w - e.w) < 0.5 && Math.abs(mid.preview.h - e.h) < 0.5,
          mid.preview ? `${mid.preview.w}x${mid.preview.h}` : 'no preview')
        ck.ok(`${pct}: TOUCH drag rack -> board lands, rack -1, moves +1`,
          cellAt(s1, E.r, E.c).sig === R.sig && s1.rackCount === s0.rackCount - 1 && s1.moves === s0.moves + 1)
      } catch (err) { ck.crash(`scale ${scale}`, err) }
    }

    // ------------------------------------------------------------------ 4 ---
    ck.section('4  MOUSE drag+drop at 75% / 100% / 125% (desktop viewport)')
    await page.setViewport(DESKTOP)
    for (const scale of [0.75, 1, 1.25]) {
      try {
        let s0
        for (let i = 0; i < 8; i++) {
          await openPlay(page, url, { scale })
          s0 = await readState(page)
          if (uniqueRackTiles(s0).length && visibleEmptyCells(s0).length) break
        }
        const R = uniqueRackTiles(s0)[0], E = visibleEmptyCells(s0).at(-1)
        await page.mouseDrag({ x: R.x, y: R.y }, { x: E.x, y: E.y }); await sleep(100)
        const s1 = await readState(page)
        ck.ok(`${scale * 100}%: mouse rack -> board lands, rack -1, moves +1`,
          cellAt(s1, E.r, E.c).sig === R.sig && s1.rackCount === s0.rackCount - 1 && s1.moves === s0.moves + 1)
      } catch (err) { ck.crash(`mouse at ${scale}`, err) }
    }

    // ------------------------------------------------------------------ 5 ---
    ck.section('5  settings pill: persists AND re-renders immediately; bad values fall back')
    await page.setViewport(PHONE)
    try {
      await openPlay(page, url)
      await clickButton(page, '⚙')
      await clickButton(page, '75%')
      const m1 = await measure(page)
      ck.ok('clicking "75%" stores "0.75" in puzzikub_board_scale', m1.stored === '0.75', `stored=${m1.stored}`)
      ck.ok('board re-renders at 35px immediately, no reload', m1.tile.w === 35 && m1.tile.h === 44, `${m1.tile.w}x${m1.tile.h}`)
      await page.reload()
      await page.waitFor(() => document.querySelectorAll('[data-cell]').length > 0, { label: 'board' })
      const m2 = await measure(page)
      ck.ok('after a reload the 75% preference is still applied', m2.tile.w === 35, `${m2.tile.w}px`)
    } catch (e) { ck.crash('settings persistence', e) }
    for (const bad of ['0.6', 'garbage', '']) {
      try {
        await openPlay(page, url, { extraStorage: { puzzikub_board_scale: bad } })
        const m = await measure(page)
        ck.ok(`stored "${bad}" is rejected -> falls back to 100% (46px)`, m.tile.w === 46, `${m.tile.w}px`)
      } catch (e) { ck.crash(`bad value ${bad}`, e) }
    }
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

/**
 * `npm run verify:live [url]` — smoke-test a DEPLOYED build (default: the live
 * GitHub Pages site). A 200 response does not prove the app runs, so this loads
 * the page in headless Chrome and, for each difficulty, reads real DOM state:
 * a board and a rack render, par is shown, and the console stays clean.
 *
 * Committed on purpose: two sessions rebuilt this as a throwaway script and
 * lost the evidence. Do not delete it.
 */
import { launch, sleep } from './lib/cdp.mjs'
import { Checks, clickButton, waitForBoard } from './lib/app.mjs'

const url = process.argv[2] ?? 'https://iangopen.github.io/puzzikub/'
const ck = new Checks(`LIVE ${url}`)
const page = await launch()
const errors = []
try {
  page.session.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error') errors.push(p.args.map(a => a.value ?? a.description ?? '').join(' '))
  })
  page.session.on('Log.entryAdded', p => { if (p.entry.level === 'error') errors.push(`${p.entry.source}: ${p.entry.text} ${p.entry.url ?? ''}`) })
  await page.session.send('Log.enable')
  await page.setViewport({ width: 1100, height: 900 })
  await page.navigate(url)
  await page.waitFor(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'easy'),
    { label: 'app mount', timeout: 30000 })
  await page.eval(() => localStorage.setItem('puzzikub_seen_tutorial', '1'))
  await page.reload()
  const scripts = await page.eval(() => [...document.querySelectorAll('script[src],link[rel=stylesheet]')].map(e => e.src || e.href))
  console.log(`assets: ${scripts.join(', ')}`)
  for (const d of ['easy', 'medium', 'hard', 'extreme']) {
    try {
      await page.waitFor(t => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === t),
        { label: `${d} pill`, timeout: 30000 }, d)
      await clickButton(page, d)
      await waitForBoard(page)
      await sleep(100)
      const s = await page.eval(() => {
        const st = /moves:\s*(\d+)\s+par:\s*(\S+)\s+rack:\s*(\d+)/.exec(document.body.innerText)
        const cells = [...document.querySelectorAll('[data-cell]')]
        return {
          cells: cells.length,
          tiles: cells.filter(c => c.firstElementChild).length,
          rows: Math.max(...cells.map(c => +c.dataset.cell.split(',')[0])) + 1,
          cols: Math.max(...cells.map(c => +c.dataset.cell.split(',')[1])) + 1,
          rackTiles: document.querySelector('[data-rack]')?.children.length ?? 0,
          par: st?.[2], rackText: st?.[3],
        }
      })
      ck.ok(`${d}: board renders`, s.tiles > 0, `${s.rows}x${s.cols}, ${s.tiles} tiles`)
      ck.ok(`${d}: rack renders`, s.rackTiles > 0 && String(s.rackTiles) === s.rackText, `${s.rackTiles} tiles`)
      ck.ok(`${d}: par shown`, /^\d+$/.test(s.par ?? ''), `par ${s.par}`)
    } catch (e) { ck.crash(d, e) }
  }
  ck.ok('no console errors', errors.length === 0, errors.join(' | '))
  ck.ok('no page exceptions', page.exceptions.length === 0, page.exceptions.join(' | '))
} finally {
  await page.close()
}
const r = ck.summary()
process.exit(r.failed ? 1 : 0)

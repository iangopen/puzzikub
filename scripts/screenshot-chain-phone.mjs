/**
 * `node scripts/screenshot-chain-phone.mjs` — a chain puzzle (the tallest board,
 * 10 rows) on a 390x844 phone viewport, scrolled to the top, written to
 * docs/screenshots/phone-chain.png. Prints where the rack sits, so the image
 * comes with the numbers that say the rack is on screen.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { launch, sleep } from './lib/cdp.mjs'
import { startServer, openPlay, readState } from './lib/app.mjs'

mkdirSync('docs/screenshots', { recursive: true })
const srv = await startServer()
const page = await launch()
try {
  await page.setViewport({ width: 390, height: 844, mobile: true, touch: true, dpr: 2 })
  await openPlay(page, srv.url, { query: '?forceArchetype=chain' })
  await page.eval(() => window.scrollTo(0, 0))
  await sleep(600)
  const s = await readState(page)
  const docH = await page.eval(() => document.documentElement.scrollHeight)
  console.log(`board ${s.rows}x${s.cols}, document height ${docH}px, viewport 844px`)
  console.log(`rack box top ${s.rackBox.top.toFixed(0)} bottom ${s.rackBox.bottom.toFixed(0)}  -> on screen: ${s.rackBox.bottom <= 844}`)
  console.log(`rack tiles: ${s.rack.length}, all inside the viewport: ${s.rack.every(t => t.bottom <= 844 && t.top >= 0)}`)
  const { data } = await page.session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('docs/screenshots/phone-chain.png', Buffer.from(data, 'base64'))
  console.log('docs/screenshots/phone-chain.png written')
} finally {
  await page.close()
  await srv.close()
}

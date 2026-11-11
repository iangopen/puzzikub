/**
 * `node scripts/screenshots.mjs` — regenerate the README screenshots in
 * docs/screenshots/ from the local dev server, using the CDP rig.
 *
 *   desktop.png  hard puzzle, default theme, 1280x860
 *   phone.png    easy puzzle, 390x844 phone viewport (touch emulation)
 *   neon.png     extreme puzzle, 1280x1000, Neon preset (animated DarkVeil background)
 */
import { writeFileSync, mkdirSync, statSync } from 'node:fs'
import { launch, sleep } from './lib/cdp.mjs'
import { startServer, openPlay } from './lib/app.mjs'

const OUT = 'docs/screenshots'
mkdirSync(OUT, { recursive: true })

async function shot(page, file) {
  const { data } = await page.session.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${file}`, Buffer.from(data, 'base64'))
  console.log(`${OUT}/${file}  ${(statSync(`${OUT}/${file}`).size / 1024).toFixed(0)} KB`)
}

const srv = await startServer()
const page = await launch()
try {
  await page.setViewport({ width: 1280, height: 860 })
  await openPlay(page, srv.url, { diff: 'hard' })
  await sleep(500)
  await shot(page, 'desktop.png')

  await page.setViewport({ width: 390, height: 844, mobile: true, touch: true, dpr: 2 })
  await openPlay(page, srv.url, { diff: 'easy' })
  await sleep(500)
  await shot(page, 'phone.png')

  await page.setViewport({ width: 1280, height: 1000 })
  await openPlay(page, srv.url, {
    diff: 'extreme',
    extraStorage: { puzzikub_background: 'neon-veil', puzzikub_tile_style: 'neon-outline' },
  })
  await sleep(1500) // let the WebGL veil animate a little
  await shot(page, 'neon.png')
} finally {
  await page.close()
  await srv.close()
}

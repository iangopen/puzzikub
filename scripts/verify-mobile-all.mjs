/**
 * `npm run verify:mobile` — one Vite dev server, then the three browser suites
 * in sequence: groundwork -> wide board -> touch drag -> touch drag again with
 * EVERY puzzle forced to chain (the 10-row board whose rack used to start off a
 * phone screen; the rigs never redraw to dodge it). Exits non-zero if any
 * check fails, so it is usable as a gate.
 *
 * Needs a local Chrome or Edge (override with CHROME_PATH). HEADFUL=1 shows
 * the browser window.
 */
import { startServer } from './lib/app.mjs'
import { run as runMobile } from './verify-mobile.mjs'
import { run as runWide } from './verify-wide.mjs'
import { run as runTouch } from './verify-touch.mjs'

const srv = await startServer()
console.log(`dev server: ${srv.url}`)
const results = []
try {
  const runTouchChain = async u => {
    process.env.RIG_QUERY = '?forceArchetype=chain'
    try { return await runTouch(u) } finally { delete process.env.RIG_QUERY }
  }
  for (const [name, fn] of [['MOBILE-GROUNDWORK', runMobile], ['WIDE-BOARD', runWide], ['TOUCH-DRAG', runTouch], ['TOUCH-DRAG chain', runTouchChain]]) {
    console.log(`\n==================== ${name} ====================`)
    results.push([name, await fn(srv.url)])
  }
} finally {
  await srv.close()
}
console.log('\n==================== SUMMARY ====================')
for (const [name, r] of results) console.log(`${name.padEnd(18)} ${r.passed} passed, ${r.failed} failed`)
process.exit(results.some(([, r]) => r.failed) ? 1 : 0)

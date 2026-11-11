/**
 * `npm run verify` / `npm run verify:full` — THE standing safety net.
 * Runs the build, every engine harness, and the browser rigs, in sequence,
 * printing each step's pass/fail line and a summary. Exit 1 if anything fails.
 *
 *   npm run verify        build + 11 harnesses + verify:mobile + verify:library
 *   npm run verify:full   the same plus valueGroupPlanner (~6 min)
 *
 * TWO TRAPS this runner exists to get right (both measured the first time):
 *  - The harnesses EXIT 0 EVEN WHEN CHECKS FAIL. A step therefore fails if its
 *    exit code is non-zero OR any "N passed, M failed" line has M > 0.
 *  - Several harnesses assert WALL-CLOCK budgets (redherring <5ms/build,
 *    cutpoint <50ms). Running all eleven at once broke those budgets
 *    (redherring 23/2, cutpoint 35/1). So the timed harnesses run ONE AT A
 *    TIME. Only the long, budget-free pairingMin (and valueGroupPlanner, whose
 *    budget is a generous 250ms) runs in the background alongside them.
 */
import { spawn } from 'node:child_process'

const full = process.argv.includes('--full')
const SEQUENTIAL = [
  'verifyEngine.ts', // NOT *.verify.ts — easy to miss in a glob
  'decoy.verify.ts', 'redherring.verify.ts', 'composed.verify.ts', 'cutpoint.verify.ts',
  'chain.verify.ts', 'mixedGoalPlanner.verify.ts', 'storage.verify.ts',
  'dragIdentity.verify.ts', 'trapVariants.verify.ts',
]
const BACKGROUND = ['pairingMin.verify.ts', ...(full ? ['valueGroupPlanner.verify.ts'] : [])]

function run(label, cmd) {
  const t0 = Date.now()
  return new Promise(res => {
    const p = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', d => { out += d })
    p.stderr.on('data', d => { out += d })
    p.on('close', code => {
      const secs = ((Date.now() - t0) / 1000).toFixed(0)
      const all = out.split(/\r?\n/)
      // Harnesses exit 0 even on failure: the summary line is the truth.
      const failedChecks = all.some(l => { const m = /\d+ passed, (\d+) failed/.exec(l); return m && +m[1] > 0 })
      const lines = all.filter(l =>
        /\d+ passed, \d+ failed|INVARIANTS \(a\)-\(d\):|built in|error TS|^\s*FAIL/.test(l))
      res({ label, code: code === 0 && failedChecks ? 1 : code, secs, lines, out })
    })
  })
}

const results = []
const report = r => {
  console.log(`\n[${r.code === 0 ? 'OK  ' : 'FAIL'}] ${r.label}  (${r.secs}s)`)
  for (const l of r.lines.slice(-8)) console.log('    ' + l.trim())
  if (r.code !== 0 && r.lines.length === 0) console.log(r.out.split(/\r?\n/).slice(-15).join('\n'))
  results.push(r)
}

report(await run('build', 'npm run build'))
const bg = BACKGROUND.map(h => run(h, `npx tsx src/lib/${h}`))
for (const h of SEQUENTIAL) report(await run(h, `npx tsx src/lib/${h}`))
for (const r of await Promise.all(bg)) report(r)
report(await run('verify:mobile', 'npm run verify:mobile'))
report(await run('verify:library', 'npm run verify:library'))

const bad = results.filter(r => r.code !== 0)
console.log(`\n==================== VERIFY${full ? ':FULL' : ''} SUMMARY ====================`)
console.log(`${results.length - bad.length}/${results.length} steps passed${bad.length ? `; FAILED: ${bad.map(b => b.label).join(', ')}` : ''}`)
process.exit(bad.length ? 1 : 0)

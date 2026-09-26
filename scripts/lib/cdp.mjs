/**
 * cdp.mjs — a minimal Chrome DevTools Protocol driver for the mobile/touch
 * verification scripts. NO dependencies: Node 22+ ships a global `WebSocket`,
 * and Chrome is launched as a plain child process.
 *
 * Why CDP rather than a browser-automation library: the thing under test is
 * the app's handling of REAL TouchEvents (implicit capture, passive listeners,
 * identifiers, compatibility mouse events). `Input.dispatchTouchEvent` injects
 * input at the browser's input pipeline, so the page receives genuine,
 * isTrusted TouchEvents that go through hit-testing, touch-action and gesture
 * detection exactly like a finger would. Anything that constructs a
 * `new TouchEvent(...)` in-page instead would bypass all of that and could
 * pass while real touch was broken.
 *
 * ***The scripts never trust dispatch alone.*** Every page gets an in-page
 * event recorder (installRecorder) that logs what the page actually received —
 * type, isTrusted, identifiers, touches, target, and whether the app's
 * preventDefault took effect. Checks assert on that record, so a dispatch that
 * silently never reached the app fails loudly instead of passing vacuously.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const sleep = ms => new Promise(r => setTimeout(r, ms))

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

export function findChrome() {
  const hit = CHROME_CANDIDATES.find(p => existsSync(p))
  if (!hit) throw new Error('No Chrome/Edge found. Set CHROME_PATH to a Chromium-based browser.')
  return hit
}

/**
 * Launch a headless Chrome with a throwaway profile, connect to its first page
 * target, and return a Page. `--remote-debugging-port=0` lets Chrome pick a
 * free port and write it to DevToolsActivePort, so parallel runs can't collide.
 */
export async function launch({ headless = process.env.HEADFUL ? false : true } = {}) {
  const exe = findChrome()
  const profile = mkdtempSync(join(tmpdir(), 'puzzikub-cdp-'))
  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    ...(headless ? ['--headless=new'] : []),
    'about:blank',
  ]
  const proc = spawn(exe, args, { stdio: 'ignore' })

  const portFile = join(profile, 'DevToolsActivePort')
  let port
  for (let i = 0; i < 200 && !port; i++) {
    if (existsSync(portFile)) {
      const line = readFileSync(portFile, 'utf8').split('\n')[0].trim()
      if (line) port = Number(line)
    }
    if (!port) await sleep(50)
  }
  if (!port) { proc.kill(); throw new Error('Chrome did not expose a DevTools port') }

  let targets = []
  for (let i = 0; i < 100; i++) {
    targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    if (targets.some(t => t.type === 'page')) break
    await sleep(50)
  }
  const target = targets.find(t => t.type === 'page')
  const page = new Page(await Session.connect(target.webSocketDebuggerUrl))
  await page.init()

  page.close = async () => {
    try { await page.session.send('Browser.close') } catch { /* already gone */ }
    page.session.ws.close()
    await sleep(300)
    try { proc.kill() } catch { /* ignore */ }
    for (let i = 0; i < 5; i++) {
      try { rmSync(profile, { recursive: true, force: true }); break } catch { await sleep(200) }
    }
  }
  return page
}

/** One WebSocket, request/response by id, plus an event bus. */
export class Session {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.onopen = () => resolve(new Session(ws))
      ws.onerror = e => reject(new Error(`CDP connect failed: ${e.message ?? e}`))
    })
  }

  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`))
        else p.resolve(msg.result)
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params)
      }
    }
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, [])
    this.listeners.get(method).push(fn)
  }

  once(method, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs)
      const fn = params => {
        clearTimeout(t)
        const arr = this.listeners.get(method)
        arr.splice(arr.indexOf(fn), 1)
        resolve(params)
      }
      this.on(method, fn)
    })
  }
}

/**
 * The in-page event recorder, installed on every new document before any app
 * script runs.
 *
 * Two listeners per event type:
 *  - CAPTURE on window: runs FIRST, records what arrived (isTrusted, ids,
 *    touches, target) before the app can react.
 *  - BUBBLE on window: runs LAST, after the app's document-level listeners,
 *    and records `defaultPrevented`. For touchmove/touchend this is the proof
 *    that the app's `{ passive: false }` preventDefault genuinely took effect —
 *    a preventDefault inside a PASSIVE listener is silently ignored and would
 *    leave this false.
 */
const RECORDER = `(() => {
  if (window.__rec) return
  const log = []
  window.__rec = log
  const ids = l => l ? Array.from(l, t => t.identifier) : []
  const where = el => {
    const hit = el && el.closest ? el.closest('[data-cell],[data-rack]') : null
    if (!hit) return el && el.tagName ? el.tagName.toLowerCase() : String(el)
    return hit.hasAttribute('data-cell') ? 'cell:' + hit.getAttribute('data-cell') : 'rack'
  }
  const types = ['touchstart', 'touchmove', 'touchend', 'touchcancel',
                 'mousedown', 'mousemove', 'mouseup', 'click']
  for (const type of types) {
    window.addEventListener(type, e => {
      const entry = {
        type, t: performance.now(), isTrusted: e.isTrusted, cancelable: e.cancelable,
        target: where(e.target),
      }
      if (e.changedTouches) {
        entry.changed = ids(e.changedTouches)
        entry.touches = ids(e.touches)
        const c = e.changedTouches[0]
        if (c) { entry.x = c.clientX; entry.y = c.clientY }
      } else {
        entry.x = e.clientX; entry.y = e.clientY
        entry.firesTouchEvents = !!(e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)
      }
      e.__recEntry = entry
      log.push(entry)
    }, { capture: true, passive: true })
    window.addEventListener(type, e => {
      if (e.__recEntry) e.__recEntry.defaultPrevented = e.defaultPrevented
    }, { capture: false, passive: true })
  }
})()`

/** A page plus the driving primitives the verify scripts need. */
export class Page {
  constructor(session) {
    this.session = session
    this.console = []
    this.exceptions = []
    // Active synthetic fingers, id -> {x, y}. CDP touch events carry the FULL
    // set of currently-down points, so the driver must track them.
    this.fingers = new Map()
  }

  async init() {
    const s = this.session
    await s.send('Page.enable')
    await s.send('Runtime.enable')
    s.on('Runtime.consoleAPICalled', p => {
      this.console.push(p.args.map(a => a.value ?? a.description ?? '').join(' '))
    })
    s.on('Runtime.exceptionThrown', p => {
      this.exceptions.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text)
    })
    await s.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER })
  }

  /**
   * Viewport + input emulation. `touch: true` makes the page a touch device
   * (maxTouchPoints, ontouchstart, pointer: coarse), which is what a phone
   * reports; mouse-only desktop checks pass `touch: false`.
   */
  async setViewport({ width, height, mobile = false, touch = false, dpr = 1 }) {
    await this.session.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: dpr, mobile,
    })
    await this.session.send('Emulation.setTouchEmulationEnabled', {
      enabled: touch, maxTouchPoints: touch ? 5 : 1,
    })
  }

  async navigate(url) {
    const loaded = this.session.once('Page.loadEventFired')
    await this.session.send('Page.navigate', { url })
    await loaded
  }

  async reload() {
    const loaded = this.session.once('Page.loadEventFired')
    await this.session.send('Page.reload', { ignoreCache: true })
    await loaded
  }

  /** Evaluate an expression (or a function + args) in the page, by value. */
  async eval(fnOrExpr, ...args) {
    const expression = typeof fnOrExpr === 'function'
      ? `(${fnOrExpr.toString()})(...${JSON.stringify(args)})`
      : fnOrExpr
    const r = await this.session.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
    })
    if (r.exceptionDetails) {
      throw new Error(`page eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    }
    return r.result.value
  }

  /** Poll a page predicate until truthy. */
  async waitFor(fnOrExpr, { timeout = 10000, interval = 50, label = 'condition' } = {}, ...args) {
    const end = Date.now() + timeout
    for (;;) {
      const v = await this.eval(fnOrExpr, ...args)
      if (v) return v
      if (Date.now() > end) throw new Error(`timeout waiting for ${label}`)
      await sleep(interval)
    }
  }

  /** Clear and return the in-page event record. */
  async takeRecord() {
    return this.eval(() => window.__rec.splice(0, window.__rec.length))
  }

  // ---------------------------------------------------------------- touch ---
  //
  // Sequencing contract (verified against the in-page recorder by the probe in
  // verify-touch.mjs, not assumed):
  //   touchStart / touchMove  carry EVERY currently-down finger. A point id not
  //                           previously down is a new finger (touchstart);
  //                           one already down is a move.
  //   touchEnd                lists the finger(s) being LIFTED. ***Measured,
  //                           and the opposite of the intuitive reading:*** an
  //                           earlier draft sent the REMAINING fingers, and
  //                           Chrome lifted exactly those — with two fingers
  //                           down, "lift 2" released finger 1. A multi-touch
  //                           test built on that would lift the wrong finger
  //                           and could pass for the wrong reason.
  //   DOM identifiers         are assigned by Chrome and need NOT equal the
  //                           CDP `id`. Checks read the real identifiers from
  //                           the recorder; they never assume the two match.
  //   touchCancel             must carry an EMPTY touchPoints array — CDP
  //                           rejects touch points on a cancel outright.

  _points() {
    return [...this.fingers].map(([id, p]) => ({
      x: p.x, y: p.y, id, radiusX: 11, radiusY: 11, force: 1, rotationAngle: 0,
    }))
  }

  async touchStart(id, x, y) {
    if (this.fingers.has(id)) throw new Error(`finger ${id} already down`)
    this.fingers.set(id, { x, y })
    await this.session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this._points() })
  }

  async touchMove(id, x, y) {
    if (!this.fingers.has(id)) throw new Error(`finger ${id} is not down`)
    this.fingers.set(id, { x, y })
    await this.session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this._points() })
  }

  async touchEnd(id) {
    if (!this.fingers.has(id)) throw new Error(`finger ${id} is not down`)
    const p = this.fingers.get(id)
    this.fingers.delete(id)
    // The LIFTED finger is listed — NOT the remaining ones. See the contract
    // above: listing the survivors releases the survivors.
    await this.session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [{ x: p.x, y: p.y, id, radiusX: 11, radiusY: 11, force: 1, rotationAngle: 0 }],
    })
  }

  async touchCancel() {
    this.fingers.clear()
    await this.session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  }

  /**
   * Glide one finger along a straight line with realistic spacing: `steps`
   * intermediate touchMoves `stepMs` apart (~60Hz by default). A human drag is
   * never a single teleporting move, and the app's hover detection runs per
   * touchmove, so the intermediate points genuinely matter.
   */
  async touchGlide(id, from, to, { steps = 10, stepMs = 16 } = {}) {
    for (let i = 1; i <= steps; i++) {
      const k = i / steps
      await this.touchMove(id, from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k)
      if (stepMs) await sleep(stepMs)
    }
  }

  /** Full single-finger drag: down, dwell, glide, dwell, lift. */
  async touchDrag(from, to, { id = 1, steps = 10, stepMs = 16, holdMs = 40, lift = true } = {}) {
    await this.touchStart(id, from.x, from.y)
    await sleep(holdMs)
    await this.touchGlide(id, from, to, { steps, stepMs })
    await sleep(holdMs)
    if (lift) await this.touchEnd(id)
  }

  // ---------------------------------------------------------------- mouse ---

  async mouse(type, x, y, { button = 'left', buttons } = {}) {
    await this.session.send('Input.dispatchMouseEvent', {
      type, x, y,
      button: type === 'mouseMoved' ? (buttons ? 'left' : 'none') : button,
      buttons: buttons ?? (type === 'mousePressed' ? 1 : 0),
      clickCount: type === 'mouseMoved' ? 0 : 1,
    })
  }

  /** Mouse drag. `settleMs: 0` is the zero-settle stress case. */
  async mouseDrag(from, to, { steps = 4, stepMs = 0, settleMs = 0 } = {}) {
    await this.mouse('mouseMoved', from.x, from.y)
    await this.mouse('mousePressed', from.x, from.y)
    for (let i = 1; i <= steps; i++) {
      const k = i / steps
      await this.mouse('mouseMoved', from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, { buttons: 1 })
      if (stepMs) await sleep(stepMs)
    }
    if (settleMs) await sleep(settleMs)
    await this.mouse('mouseReleased', to.x, to.y)
  }
}

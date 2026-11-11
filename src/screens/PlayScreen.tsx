import { useEffect, useState, useCallback, useMemo, useRef, useContext } from 'react'
import { usePlayState } from '../hooks/usePlayState'
import { useDrag } from '../hooks/useDrag'
import { generatePuzzle, isForceType } from '../lib/generator'
import { getNewlyValidCells } from '../lib/validator'
import { playPlace, playLockIn, playError, playWinFanfare } from '../lib/audio'
import { Board } from '../components/Board'
import { Rack } from '../components/Rack'
import { DragPreview } from '../components/DragPreview'
import { NavBar } from '../components/NavBar'
import type { Screen, Difficulty, Grid, Puzzle, Tile, DragSrc } from '../types'
import type { DropTarget } from '../hooks/usePlayState'
import { TileStyleContext } from '../lib/themes'

const DIFFS: Difficulty[] = ['easy', 'medium', 'hard', 'extreme']
const CONFETTI_COLORS = ['#A32D2D', '#185FA5', '#BA7517', '#222222']

/**
 * How long mouse input is ignored after a touch-originated drag ends.
 *
 * ***THE COMPATIBILITY-MOUSE-EVENT GUARD — the highest-risk part of touch
 * support.*** After touchend, browsers synthesise a full
 * mousedown/mousemove/mouseup/click sequence at the same coordinates so that
 * mouse-only sites keep working. Without this guard a single tap-drag would
 * fire the drag logic TWICE: once for real from the touch path, then again
 * from the synthesised mouse path — dropping a second time, or starting a
 * fresh phantom drag from wherever the finger lifted.
 *
 * 500ms comfortably covers the synthesis window (browsers emit these within a
 * few hundred ms of touchend) while being far shorter than any plausible
 * deliberate mouse action on a device that has just been touched.
 *
 * NOT solved with Pointer Events: unifying the paths that way reintroduces the
 * setPointerCapture model this project deliberately abandoned (see "Drag
 * system — CRITICAL RULES" in CLAUDE.md).
 */
const TOUCH_MOUSE_SUPPRESS_MS = 500

/**
 * Resolve a hit-test result to a drop target.
 *
 * TileFace's inner span is pointerEvents:none and DragPreview is likewise
 * pointerEvents:none, so elementFromPoint lands on a cell/tile wrapper div —
 * which is exactly what carries data-cell / data-rack.
 */
function resolveDropTarget(el: Element | null): DropTarget | null {
  const hit = el?.closest('[data-cell],[data-rack]')
  if (!hit) return null
  const cell = hit.getAttribute('data-cell')
  if (cell === null) return { to: 'rack' }
  const [row, col] = cell.split(',').map(Number)
  return Number.isFinite(row) && Number.isFinite(col) ? { to: 'grid', row, col } : null
}

/** Find a specific finger by identifier. Never index [0] — see DragState.touchId. */
function findTouch(list: TouchList, id: number | undefined): Touch | null {
  if (id === undefined) return null
  for (let i = 0; i < list.length; i++) {
    if (list[i].identifier === id) return list[i]
  }
  return null
}

interface Props {
  activeScreen: Screen
  onNav: (s: Screen) => void
  soundEnabled: boolean
  onShowSettings: () => void
  onShowTutorial: () => void
  /** Persisted board-scale preference; 1 = the original 46x58 rendering. */
  boardScale?: number
  /**
   * A puzzle chosen in the Library. When present it is loaded on mount INSTEAD
   * of generating one, and takes precedence over ?forceArchetype (that dev
   * override is for generated puzzles only). Absent = generate on mount.
   */
  savedPuzzle?: Puzzle | null
  /** Called when this screen generates, so App drops the saved selection. */
  onSavedPuzzleCleared?: () => void
}

export function PlayScreen({ activeScreen, onNav, soundEnabled, onShowSettings, onShowTutorial, boardScale = 1, savedPuzzle, onSavedPuzzleCleared }: Props) {
  const { grid, rack, moves, undos, won, invalidCells, drop, undo, reset, loadPuzzle } = usePlayState()
  const { drag, startDrag, startDragTouch, updatePos, endDrag } = useDrag()
  const tileStyle = useContext(TileStyleContext)

  const [diff, setDiff] = useState<Difficulty>(savedPuzzle?.diff ?? 'easy')
  const [currentPuzzle, setCurrentPuzzle] = useState<Puzzle | null>(null)
  const [hoverTarget, setHoverTarget] = useState<
    { to: 'grid'; row: number; col: number } | { to: 'rack' } | null
  >(null)
  const [lockInCells, setLockInCells] = useState<Set<string>>(new Set())
  const [showConfetti, setShowConfetti] = useState(false)
  const [confettiId, setConfettiId] = useState(0)
  const [genFailed, setGenFailed] = useState(false)

  const prevGridRef = useRef<Grid>([])
  const justDroppedToGridRef = useRef(false)
  const prevRackLenRef = useRef(rack.length)

  /**
   * ***THE STALE-TARGET FIX.*** `hoverTarget` state drives RENDERING (the cell
   * highlight); this ref is its SYNCHRONOUS mirror and is what the drop reads.
   *
   * The bug it fixes was real and already cost a session: the mouseup effect
   * re-subscribed on `[drag, hoverTarget]`, so an event arriving before React
   * had re-rendered saw the PREVIOUS hoverTarget and dropped on the wrong cell.
   * That is why an earlier automated-drag session needed a ~170ms settle before
   * mouseup. Touch makes it worse, not better — touchmove and touchend can land
   * in the same frame, so there may be no render between them at all.
   *
   * Always write through `setHover` so the two never diverge.
   */
  const hoverTargetRef = useRef<DropTarget | null>(null)

  /** Timestamp of the last touch-originated drag end; see TOUCH_MOUSE_SUPPRESS_MS. */
  const touchEndedAtRef = useRef(0)

  const setHover = useCallback((t: DropTarget | null) => {
    hoverTargetRef.current = t
    setHoverTarget(t)
  }, [])

  /**
   * The one drop path, shared by mouse and touch.
   *
   * ***Consumes the LAST hover recorded during MOVEMENT — it never hit-tests at
   * drop time.*** That is deliberate and matches the mouse path's long-standing
   * shape (which accumulates hoverTarget from onMouseEnter). Hit-testing at
   * touchend would be a behavioural difference between the two inputs, and an
   * unreliable one: touchend's coordinates can lag the last touchmove, and a
   * finger lifted just outside a cell would silently drop nowhere.
   */
  const commitDrop = useCallback((src: DragSrc, currentGrid: Grid) => {
    const target = hoverTargetRef.current
    if (target) {
      if (target.to === 'grid') {
        prevGridRef.current = currentGrid
        justDroppedToGridRef.current = true
      }
      drop(src, target)
      if (target.to === 'grid' && soundEnabled) playPlace()
    }
    endDrag()
    setHover(null)
  }, [drop, endDrag, setHover, soundEnabled])

  /** Mouse drag start, gated by the compatibility-event guard. */
  const handleTileMouseDown = useCallback((e: React.MouseEvent, tile: Tile, src: DragSrc) => {
    if (Date.now() - touchEndedAtRef.current < TOUCH_MOUSE_SUPPRESS_MS) return
    startDrag(e, tile, src)
  }, [startDrag])

  const handleTileTouchStart = useCallback((e: React.TouchEvent, tile: Tile, src: DragSrc) => {
    // A drag is already in flight (another finger). Ignore the newcomer rather
    // than hijacking the gesture — the original touchId keeps driving.
    if (drag) return
    setHover(null)
    startDragTouch(e, tile, src)
  }, [drag, setHover, startDragTouch])

  const confettiPieces = useMemo(() => (
    Array.from({ length: 20 }, (_, i) => ({
      id: i,
      color: CONFETTI_COLORS[i % 4],
      tx: `${(Math.random() - 0.5) * 300}px`,
      ty: `${100 + Math.random() * 200}px`,
      delay: `${Math.random() * 0.4}s`,
    }))
  ), [confettiId]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * DEV-ONLY: ?forceArchetype=decoy|red-herring|composed|cut-point|
   * pure-groups-to-runs|pure-runs-to-groups pins every generated puzzle to that
   * variant. Read once on mount, deliberately has NO UI affordance — a normal
   * player browsing the page has no way to discover or trigger it. Anything
   * unrecognised is ignored and generation behaves exactly as it does without
   * the parameter.
   *
   * Each variant is tier-restricted, so the forced build only succeeds on a
   * difficulty that variant ships at: decoy/red-herring/composed are
   * hard/extreme only, and cut-point is MEDIUM only. Since this screen mounts
   * on 'easy', reaching a forced variant means clicking its difficulty.
   */
  const forceType = useMemo(() => {
    if (typeof window === 'undefined') return undefined
    const raw = new URLSearchParams(window.location.search).get('forceArchetype')
    return isForceType(raw) ? raw : undefined
  }, [])

  const generate = useCallback((d: Difficulty) => {
    onSavedPuzzleCleared?.()
    setGenFailed(false)
    for (let i = 0; i < 5; i++) {
      const p = generatePuzzle(d, forceType)
      if (p) {
        loadPuzzle(p); setCurrentPuzzle(p)
        // Console-only confirmation that the forced variant really was built.
        // Never rendered on screen; silent unless the dev flag is active.
        if (forceType) console.log(`[forceArchetype=${forceType}] archetypeId=${p.archetypeId} diff=${d} par=${p.optimalMoves}`)
        return
      }
    }
    if (forceType) console.log(`[forceArchetype=${forceType}] no puzzle for diff=${d} (trap layers are hard/extreme only)`)
    setGenFailed(true)
  }, [loadPuzzle, forceType, onSavedPuzzleCleared])

  useEffect(() => {
    if (savedPuzzle) { loadPuzzle(savedPuzzle); setCurrentPuzzle(savedPuzzle) }
    else generate('easy')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDiff = (d: Difficulty) => { setDiff(d); generate(d) }

  // Document-level MOUSE tracking while dragging.
  //
  // `hoverTarget` is gone from the deps: the drop reads hoverTargetRef, so this
  // no longer needs to re-subscribe every time the hover changes — which is
  // precisely what made the old closure go stale.
  useEffect(() => {
    if (!drag || drag.pointer !== 'mouse') return

    const onMove = (e: MouseEvent) => updatePos(e.clientX, e.clientY)
    const onUp = () => commitDrop(drag.src, grid)

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [drag, grid, commitDrop]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Document-level TOUCH tracking while dragging.
   *
   * ***THESE MUST BE NATIVE addEventListener CALLS WITH { passive: false }, NOT
   * React props.*** React 17+ attaches touch listeners at the root as PASSIVE,
   * so `e.preventDefault()` inside a React onTouchMove silently does nothing.
   * onTouchStart is fine as a React prop (it never needs preventDefault here —
   * `touch-action: none` on tiles does that job).
   *
   * Hover detection differs fundamentally from mouse: touch events use IMPLICIT
   * CAPTURE, so every touchmove/touchend after touchstart dispatches to the
   * ORIGINAL element no matter where the finger has moved. onMouseEnter has no
   * touch analogue, so the target must be hit-tested with elementFromPoint —
   * but ONLY during movement. The drop itself consumes the accumulated value
   * (see commitDrop), exactly like the mouse path.
   */
  useEffect(() => {
    if (!drag || drag.pointer !== 'touch') return
    const id = drag.touchId

    const onTouchMove = (e: TouchEvent) => {
      const t = findTouch(e.touches, id)
      if (!t) return // a different finger moved — not our gesture
      e.preventDefault()
      updatePos(t.clientX, t.clientY)
      setHover(resolveDropTarget(document.elementFromPoint(t.clientX, t.clientY)))
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!findTouch(e.changedTouches, id)) return // some other finger lifted
      e.preventDefault()
      touchEndedAtRef.current = Date.now()
      commitDrop(drag.src, grid)
    }

    /**
     * touchcancel — a system gesture, notification, or incoming call steals the
     * touch. WITHOUT THIS the drag never ends: endDrag() never runs, so
     * document.body's userSelect and cursor stay mutated indefinitely and the
     * DragPreview is stranded on screen. No drop is performed — a cancelled
     * gesture is not a move.
     */
    const onTouchCancel = (e: TouchEvent) => {
      // Deliberately LOOSER than touchend's identifier check. Browsers vary in
      // what they put in a touchcancel's changedTouches — some list the
      // cancelled touches, some fire it with the list empty — and being strict
      // here risks the one outcome this handler exists to prevent: a drag that
      // never ends, leaving body styles mutated and the preview stranded. So
      // cancel if our finger is named, OR if it is simply no longer active.
      // touchend stays strict, because there a wrong match would drop a tile.
      if (findTouch(e.changedTouches, id) === null && findTouch(e.touches, id) !== null) return
      touchEndedAtRef.current = Date.now()
      endDrag()
      setHover(null)
    }

    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd, { passive: false })
    document.addEventListener('touchcancel', onTouchCancel, { passive: false })
    return () => {
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [drag, grid, commitDrop, setHover]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lock-in glow: detect newly valid cells after a grid drop
  useEffect(() => {
    if (!justDroppedToGridRef.current) return
    justDroppedToGridRef.current = false
    const newlyValid = getNewlyValidCells(prevGridRef.current, grid)
    if (newlyValid.size > 0) {
      if (soundEnabled && !won) playLockIn()
      setLockInCells(newlyValid)
      setTimeout(() => setLockInCells(new Set()), 600)
    }
  }, [grid]) // eslint-disable-line react-hooks/exhaustive-deps

  // Win / error sounds triggered when rack empties
  useEffect(() => {
    const prev = prevRackLenRef.current
    prevRackLenRef.current = rack.length
    if (rack.length === 0 && prev > 0) {
      if (won) {
        if (soundEnabled) playWinFanfare()
        setShowConfetti(true)
        setConfettiId(id => id + 1)
        setTimeout(() => setShowConfetti(false), 1800)
      } else {
        if (soundEnabled) playError()
      }
    }
  }, [rack.length, won]) // eslint-disable-line react-hooks/exhaustive-deps

  const loading = grid.length === 0
  // Only generated puzzles carry a constructed par. Editor-built and seed
  // puzzles store optimalMoves = rack.length, a mere lower bound — showing it
  // as par (and calling a win "perfect!" against it) would be misleading.
  const par = currentPuzzle?.generated ? currentPuzzle.optimalMoves : null

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', transition: 'background 0.15s ease' }}>
      <NavBar
        activeScreen={activeScreen}
        onNav={onNav}
        onShowTutorial={onShowTutorial}
        onShowSettings={onShowSettings}
      />

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 20px' }}>

        {/* Difficulty pills */}
        <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
          {DIFFS.map(d => (
            <button
              key={d}
              onClick={() => handleDiff(d)}
              style={{
                padding: '4px 14px',
                borderRadius: 20,
                border: d === diff ? '0.5px solid #85B7EB' : '0.5px solid var(--border)',
                background: d === diff ? '#E8F1FB' : 'var(--surface)',
                color: d === diff ? '#185FA5' : 'var(--text-secondary)',
                fontWeight: d === diff ? 600 : 400,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'background 0.15s ease',
              }}
            >
              {d}
            </button>
          ))}
        </div>

        {genFailed ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: '20px 0' }}>
            Failed to generate.{' '}
            <button
              onClick={() => generate(diff)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#185FA5', fontSize: 13, padding: 0 }}
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, padding: '20px 0' }}>Generating puzzle…</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 12px' }}>
              moves: {moves}&nbsp;&nbsp;par: {par ?? '—'}&nbsp;&nbsp;rack: {rack.length}
            </div>

            {/*
              Board owns its own centring now (it has to, because the same
              element is the horizontal scroll container). `minWidth: 0` lets
              this flex item actually shrink below its content width — without
              it the board would overflow the page instead of scrolling.
            */}
            <div style={{ margin: '0 0 16px', minWidth: 0 }}>
              <Board
                grid={grid}
                drag={drag}
                hoveredCell={hoverTarget?.to === 'grid' ? { row: hoverTarget.row, col: hoverTarget.col } : null}
                onTileMouseDown={handleTileMouseDown}
                onTileTouchStart={handleTileTouchStart}
                onCellEnter={(row, col) => setHover({ to: 'grid', row, col })}
                onCellLeave={() => setHover(null)}
                invalidCells={invalidCells}
                lockInCells={lockInCells}
                scale={boardScale}
              />
            </div>

            <Rack
              tiles={rack}
              drag={drag}
              onTileMouseDown={handleTileMouseDown}
              onTileTouchStart={handleTileTouchStart}
              onRackEnter={() => setHover({ to: 'rack' })}
              onRackLeave={() => setHover(null)}
              scale={boardScale}
            />

            {won && (
              <div style={{ color: '#27500A', fontSize: 13, margin: '12px 0' }}>
                <span className="win-text-in">
                  {par !== null && moves === par
                    ? `cleared ✓ perfect!  ${moves} moves`
                    : par !== null && moves <= par * 1.5
                    ? `cleared ✓  ${moves} moves  (par: ${par})`
                    : par !== null
                    ? `cleared ✓  ${moves} moves  (par: ${par} — beat your own record?)`
                    : `cleared ✓  ${moves} moves`}
                </span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 20, margin: '12px 0' }}>
              <HoverBtn onClick={undo} disabled={moves === 0}>Undo</HoverBtn>
              <HoverBtn onClick={reset}>Reset</HoverBtn>
              <HoverBtn onClick={() => generate(diff)}>New</HoverBtn>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 32 }}>
              undos: {undos}
            </div>
          </>
        )}
      </div>

      {drag && <DragPreview drag={drag} tileStyle={tileStyle} scale={boardScale} />}

      {showConfetti && (
        <div
          key={confettiId}
          style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 150 }}
        >
          {confettiPieces.map(p => (
            <div
              key={p.id}
              className="confetti-piece"
              style={{
                position: 'absolute',
                left: '50%',
                top: '40%',
                background: p.color,
                animationDelay: p.delay,
                '--tx': p.tx,
                '--ty': p.ty,
              } as React.CSSProperties}
            />
          ))}
        </div>
      )}
    </div>
  )
}


function HoverBtn({ onClick, disabled = false, children }: {
  onClick: () => void
  disabled?: boolean
  children: string
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      style={{
        fontSize: 13,
        color: disabled ? 'var(--border)' : hov ? 'var(--text-primary)' : 'var(--text-secondary)',
        background: 'transparent',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        padding: 0,
        transition: 'color 0.1s ease',
      }}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {children}
    </button>
  )
}

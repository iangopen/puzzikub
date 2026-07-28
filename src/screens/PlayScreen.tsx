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
import type { Screen, Difficulty, Grid, Puzzle } from '../types'
import { TileStyleContext } from '../lib/themes'

const DIFFS: Difficulty[] = ['easy', 'medium', 'hard', 'extreme']
const CONFETTI_COLORS = ['#A32D2D', '#185FA5', '#BA7517', '#222222']

interface Props {
  activeScreen: Screen
  onNav: (s: Screen) => void
  soundEnabled: boolean
  onShowSettings: () => void
  onShowTutorial: () => void
  /** Persisted board-scale preference; 1 = the original 46x58 rendering. */
  boardScale?: number
}

export function PlayScreen({ activeScreen, onNav, soundEnabled, onShowSettings, onShowTutorial, boardScale = 1 }: Props) {
  const { grid, rack, moves, undos, won, invalidCells, drop, undo, reset, loadPuzzle } = usePlayState()
  const { drag, startDrag, updatePos, endDrag } = useDrag()
  const tileStyle = useContext(TileStyleContext)

  const [diff, setDiff] = useState<Difficulty>('easy')
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
  }, [loadPuzzle, forceType])

  useEffect(() => {
    generate('easy')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDiff = (d: Difficulty) => { setDiff(d); generate(d) }

  // Document-level mouse tracking while dragging
  useEffect(() => {
    if (!drag) return

    const onMove = (e: MouseEvent) => updatePos(e.clientX, e.clientY)

    const onUp = () => {
      if (hoverTarget) {
        if (hoverTarget.to === 'grid') {
          prevGridRef.current = grid
          justDroppedToGridRef.current = true
        }
        drop(drag.src, hoverTarget)
        if (hoverTarget.to === 'grid' && soundEnabled) playPlace()
      }
      endDrag()
      setHoverTarget(null)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [drag, hoverTarget, soundEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

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
              moves: {moves}&nbsp;&nbsp;par: {currentPuzzle?.optimalMoves ?? '—'}&nbsp;&nbsp;rack: {rack.length}
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
                onTileMouseDown={startDrag}
                onCellEnter={(row, col) => setHoverTarget({ to: 'grid', row, col })}
                onCellLeave={() => setHoverTarget(null)}
                invalidCells={invalidCells}
                lockInCells={lockInCells}
                scale={boardScale}
              />
            </div>

            <Rack
              tiles={rack}
              drag={drag}
              onTileMouseDown={startDrag}
              onRackEnter={() => setHoverTarget({ to: 'rack' })}
              onRackLeave={() => setHoverTarget(null)}
              scale={boardScale}
            />

            {won && (
              <div style={{ color: '#27500A', fontSize: 13, margin: '12px 0' }}>
                <span className="win-text-in">
                  {currentPuzzle && moves === currentPuzzle.optimalMoves
                    ? `cleared ✓ perfect!  ${moves} moves`
                    : currentPuzzle && moves <= currentPuzzle.optimalMoves * 1.5
                    ? `cleared ✓  ${moves} moves  (par: ${currentPuzzle.optimalMoves})`
                    : currentPuzzle
                    ? `cleared ✓  ${moves} moves  (par: ${currentPuzzle.optimalMoves} — beat your own record?)`
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

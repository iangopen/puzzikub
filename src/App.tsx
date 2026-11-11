import { useState, useEffect } from 'react'
import type { Puzzle, Screen } from './types'
import { loadLibrary, saveLibrary } from './lib/storage'
import {
  THEME_PRESETS, TileStyleContext,
} from './lib/themes'
import type { BackgroundStyle, TileStyle, ThemePreset } from './lib/themes'
import { BOARD_SCALE_KEY, parseBoardScale } from './lib/boardScale'
import type { BoardScale } from './lib/boardScale'
import { LibraryScreen } from './screens/LibraryScreen'
import { PlayScreen } from './screens/PlayScreen'
import { EditorScreen } from './screens/EditorScreen'
import { SettingsPanel } from './components/SettingsPanel'
import { Tutorial } from './components/Tutorial'
import DarkVeil from './components/DarkVeil'

type ThemeOption = 'light' | 'dark' | 'system'

function resolveTheme(t: ThemeOption): 'light' | 'dark' {
  if (t === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return t
}

function BackgroundLayer({ bg }: { bg: BackgroundStyle }) {
  if (bg === 'glass-glow') return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden',
      background: 'linear-gradient(135deg, #1a1530, #2d1f4a)',
    }}>
      <div style={{
        position: 'absolute', top: '20%', left: '30%',
        width: 400, height: 400, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(120,60,200,0.4), transparent 70%)',
        filter: 'blur(60px)',
      }} />
    </div>
  )
  if (bg === 'wood-grain') return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
      background: 'linear-gradient(135deg, #3d2817, #5a3a22)',
    }} />
  )
  if (bg === 'neon-veil') return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      <DarkVeil speed={0.4} />
    </div>
  )
  if (bg === 'paper-grain') return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, background: '#e8e0d0' }} />
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.06,
        backgroundImage: 'repeating-linear-gradient(0deg, #000 0px, transparent 1px, transparent 3px)',
      }} />
    </div>
  )
  return null
}

function App() {
  const [screen, setScreen] = useState<Screen>('play')
  const [library, setLibrary] = useState<Puzzle[]>(loadLibrary)
  // The saved puzzle the Library asked PlayScreen to load. Cleared on ANY nav
  // (so the Play tab still means "a fresh puzzle") and when PlayScreen
  // generates (New / difficulty pills), so it can never be silently reloaded.
  const [savedPuzzle, setSavedPuzzle] = useState<Puzzle | null>(null)
  const [theme, setTheme] = useState<ThemeOption>('system')
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showTutorial, setShowTutorial] = useState(
    () => !localStorage.getItem('puzzikub_seen_tutorial')
  )
  const [background, setBackground] = useState<BackgroundStyle>(
    () => (localStorage.getItem('puzzikub_background') as BackgroundStyle | null) ?? 'none'
  )
  const [tileStyle, setTileStyle] = useState<TileStyle>(
    () => (localStorage.getItem('puzzikub_tile_style') as TileStyle | null) ?? 'plain'
  )
  // Board scale — same persistence pattern as background/tileStyle above.
  // Validated on read (unlike those two) because an unrecognised number would
  // otherwise reach the layout math; anything unknown falls back to 100%.
  const [boardScale, setBoardScale] = useState<BoardScale>(
    () => parseBoardScale(localStorage.getItem(BOARD_SCALE_KEY))
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolveTheme(theme))
  }, [theme])

  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('puzzikub_background', background)
    if (background !== 'none') {
      document.documentElement.style.setProperty('--bg', 'transparent')
    } else {
      document.documentElement.style.removeProperty('--bg')
    }
  }, [background])

  useEffect(() => {
    localStorage.setItem('puzzikub_tile_style', tileStyle)
  }, [tileStyle])

  useEffect(() => {
    localStorage.setItem(BOARD_SCALE_KEY, String(boardScale))
  }, [boardScale])

  function selectPreset(p: ThemePreset) {
    const cfg = THEME_PRESETS[p]
    setBackground(cfg.background)
    setTileStyle(cfg.tile)
  }

  function updateLibrary(updated: Puzzle[]) {
    setLibrary(updated)
    saveLibrary(updated)
  }

  function handlePlay(puzzle: Puzzle) {
    setSavedPuzzle(puzzle)
    setScreen('play')
  }

  function nav(s: Screen) {
    setSavedPuzzle(null)
    setScreen(s)
  }

  function handleSavePuzzle(puzzle: Puzzle) {
    updateLibrary([...library, puzzle])
    setScreen('library')
  }

  function dismissTutorial() {
    localStorage.setItem('puzzikub_seen_tutorial', '1')
    setShowTutorial(false)
  }

  return (
    <>
      <BackgroundLayer bg={background} />

      <TileStyleContext.Provider value={tileStyle}>
        <div style={{ position: 'relative', zIndex: 1 }}>
          {screen === 'play' && (
            <PlayScreen
              activeScreen={screen}
              onNav={nav}
              soundEnabled={soundEnabled}
              onShowSettings={() => setSettingsOpen(true)}
              onShowTutorial={() => setShowTutorial(true)}
              boardScale={boardScale}
              savedPuzzle={savedPuzzle}
              onSavedPuzzleCleared={() => setSavedPuzzle(null)}
            />
          )}
          {screen === 'library' && (
            <LibraryScreen
              puzzles={library}
              onPlay={handlePlay}
              onEdit={() => setScreen('editor')}
              onSaveGenerated={p => updateLibrary([...library, p])}
              onDelete={id => updateLibrary(library.filter(p => p.id !== id))}
              activeScreen={screen}
              onNav={nav}
              onShowSettings={() => setSettingsOpen(true)}
              onShowTutorial={() => setShowTutorial(true)}
            />
          )}
          {screen === 'editor' && (
            <EditorScreen
              onSave={handleSavePuzzle}
              onBack={() => setScreen('library')}
              activeScreen={screen}
              onNav={nav}
              onShowSettings={() => setSettingsOpen(true)}
              onShowTutorial={() => setShowTutorial(true)}
            />
          )}

          {settingsOpen && (
            <SettingsPanel
              theme={theme}
              setTheme={setTheme}
              soundEnabled={soundEnabled}
              setSoundEnabled={setSoundEnabled}
              background={background}
              tileStyle={tileStyle}
              onSelectPreset={selectPreset}
              onBackgroundChange={setBackground}
              onTileStyleChange={setTileStyle}
              boardScale={boardScale}
              onBoardScaleChange={setBoardScale}
              onClose={() => setSettingsOpen(false)}
            />
          )}
          {showTutorial && <Tutorial onDismiss={dismissTutorial} />}
        </div>
      </TileStyleContext.Provider>
    </>
  )
}

export default App

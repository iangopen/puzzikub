import {
  THEME_PRESETS, PRESET_LABELS, BACKGROUND_LABELS, TILE_LABELS,
} from '../lib/themes'
import type { BackgroundStyle, TileStyle, ThemePreset } from '../lib/themes'
import { BOARD_SCALES, formatBoardScale } from '../lib/boardScale'
import type { BoardScale } from '../lib/boardScale'

type ThemeOption = 'light' | 'dark' | 'system'

interface Props {
  theme: ThemeOption
  setTheme: (t: ThemeOption) => void
  soundEnabled: boolean
  setSoundEnabled: (v: boolean) => void
  background: BackgroundStyle
  tileStyle: TileStyle
  onSelectPreset: (p: ThemePreset) => void
  onBackgroundChange: (b: BackgroundStyle) => void
  onTileStyleChange: (t: TileStyle) => void
  boardScale: BoardScale
  onBoardScaleChange: (s: BoardScale) => void
  onClose: () => void
}

const THEME_OPTIONS: { value: ThemeOption; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
]

const PRESETS = Object.keys(THEME_PRESETS) as ThemePreset[]

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '0.5px solid var(--border)',
  fontSize: 13,
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  width: '100%',
  boxSizing: 'border-box',
  cursor: 'pointer',
}

export function SettingsPanel({
  theme, setTheme,
  soundEnabled, setSoundEnabled,
  background, tileStyle,
  onSelectPreset, onBackgroundChange, onTileStyleChange,
  boardScale, onBoardScaleChange,
  onClose,
}: Props) {
  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 99 }}
        onClick={onClose}
      />

      <div style={{
        position: 'fixed', right: 0, top: 0, height: '100vh', width: 300,
        background: 'var(--surface)',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        zIndex: 100,
        display: 'flex', flexDirection: 'column',
        transition: 'transform 0.2s ease',
      }}>

        {/* Header */}
        <div style={{ height: 56, display: 'flex', alignItems: 'center', padding: '0 20px', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>
            Settings
          </span>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'var(--cell-empty)', border: 'none',
              fontSize: 16, cursor: 'pointer', color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0, lineHeight: 1,
            }}
          >×</button>
        </div>

        {/* Scrollable content */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: 20,
          display: 'flex', flexDirection: 'column', gap: 24,
        }}>

          {/* Theme */}
          <div>
            <SectionLabel>Theme</SectionLabel>

            {/* Preset pills */}
            <div style={{
              display: 'flex', border: '0.5px solid var(--border)',
              borderRadius: 10, overflow: 'hidden', marginBottom: 12,
            }}>
              {PRESETS.map(p => {
                const cfg = THEME_PRESETS[p]
                const active = cfg.background === background && cfg.tile === tileStyle
                return (
                  <button
                    key={p}
                    onClick={() => onSelectPreset(p)}
                    style={{
                      flex: 1, padding: '6px 4px',
                      border: 'none', fontSize: 11, cursor: 'pointer',
                      background: active ? 'var(--cell-empty)' : 'var(--surface)',
                      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    {PRESET_LABELS[p]}
                  </button>
                )
              })}
            </div>

            {/* Divider */}
            <div style={{ height: '0.5px', background: 'var(--border)', margin: '4px 0 12px' }} />

            {/* Background select */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Background</div>
              <select
                value={background}
                onChange={e => onBackgroundChange(e.target.value as BackgroundStyle)}
                style={selectStyle}
              >
                {(Object.keys(BACKGROUND_LABELS) as BackgroundStyle[]).map(b => (
                  <option key={b} value={b}>{BACKGROUND_LABELS[b]}</option>
                ))}
              </select>
              {/* Attribution for the animated background (see DarkVeil.tsx header). */}
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
                Animated veil: DarkVeil by{' '}
                <a href="https://reactbits.dev/backgrounds/dark-veil" target="_blank" rel="noopener noreferrer"
                  style={{ color: 'inherit' }}>React Bits</a>
              </div>
            </div>

            {/* Tile style select */}
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Tile style</div>
              <select
                value={tileStyle}
                onChange={e => onTileStyleChange(e.target.value as TileStyle)}
                style={selectStyle}
              >
                {(Object.keys(TILE_LABELS) as TileStyle[]).map(t => (
                  <option key={t} value={t}>{TILE_LABELS[t]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Appearance (light/dark) */}
          <div>
            <SectionLabel>Appearance</SectionLabel>
            <div style={{
              display: 'flex', border: '0.5px solid var(--border)',
              borderRadius: 10, overflow: 'hidden',
            }}>
              {THEME_OPTIONS.map(opt => {
                const active = theme === opt.value
                return (
                  <button
                    key={opt.value}
                    onClick={() => setTheme(opt.value)}
                    style={{
                      flex: 1, padding: 8, border: 'none', fontSize: 13, cursor: 'pointer',
                      background: active ? 'var(--cell-empty)' : 'var(--surface)',
                      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Board */}
          <div>
            <SectionLabel>Board</SectionLabel>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Tile size
            </div>
            <div style={{
              display: 'flex', border: '0.5px solid var(--border)',
              borderRadius: 10, overflow: 'hidden',
            }}>
              {BOARD_SCALES.map(s => {
                const active = boardScale === s
                return (
                  <button
                    key={s}
                    onClick={() => onBoardScaleChange(s)}
                    style={{
                      flex: 1, padding: '6px 4px',
                      border: 'none', fontSize: 12, cursor: 'pointer',
                      background: active ? 'var(--cell-empty)' : 'var(--surface)',
                      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    {formatBoardScale(s)}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.4 }}>
              Smaller tiles fit wide boards on narrow screens. Wide boards scroll
              sideways at any size.
            </div>
          </div>

          {/* Sound */}
          <div>
            <SectionLabel>Sound</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>Snap sound</span>
              <Toggle checked={soundEnabled} onChange={setSoundEnabled} />
            </div>
          </div>

          {/* Stats */}
          <div>
            <SectionLabel>Stats</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <StatRow label="Puzzles played" value={0} />
              <StatRow label="Puzzles solved" value={0} />
              <StatRow label="Best streak" value={0} />
            </div>
          </div>

        </div>

        {/* Footer */}
        <div style={{
          padding: 20, borderTop: '0.5px solid var(--border)',
          textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0,
        }}>
          Puzzikub v0.1
        </div>

      </div>
    </>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 500, textTransform: 'uppercase',
      letterSpacing: '0.8px', color: 'var(--text-secondary)', marginBottom: 10,
    }}>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ cursor: 'pointer', display: 'inline-block', position: 'relative' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
      />
      <div style={{
        width: 40, height: 24, borderRadius: 12,
        background: checked ? '#34C759' : 'var(--cell-empty)',
        transition: 'background 0.2s', position: 'relative',
      }}>
        <div style={{
          position: 'absolute', top: 2, width: 20, height: 20,
          borderRadius: '50%', background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transform: checked ? 'translateX(16px)' : 'translateX(2px)',
          transition: 'transform 0.2s',
        }} />
      </div>
    </label>
  )
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

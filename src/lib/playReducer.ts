/**
 * The play-state reducer: every move a player can make, and THE FINISH CHECK.
 * Pure module, no React. `usePlayState` wraps it in `useReducer`; the harnesses
 * (finishLayouts.verify.ts) drive it directly, so they test the code the app
 * runs rather than a transcription of it.
 *
 * The finish check is one line in the DROP case:
 *     won = rack.length === 0 && validateGrid(grid)
 * It asks only whether every tile sits in a valid horizontal run or group. It
 * does not compare the board with any stored goal layout, so a long run left
 * whole and the same tiles cut into shorter valid runs both win.
 */
import type { Tile, Grid, DragSrc, Puzzle } from '../types'
import { validateGrid, getInvalidCells } from './validator'

export type DropTarget = { to: 'grid'; row: number; col: number } | { to: 'rack' }

export interface PlayState {
  grid: Grid
  rack: Tile[]
  history: { grid: Grid; rack: Tile[] }[]
  moves: number
  undos: number
  won: boolean
  invalidCells: Set<string>
}

export type PlayAction =
  | { type: 'LOAD'; puzzle: Puzzle }
  | { type: 'DROP'; src: DragSrc; target: DropTarget }
  | { type: 'UNDO' }
  | { type: 'RESET_TO_INITIAL'; grid: Grid; rack: Tile[] }
  | { type: 'SET_WON'; won: boolean }

export function deepCopyGrid(g: Grid): Grid {
  return g.map(row => [...row])
}

export function playReducer(state: PlayState, action: PlayAction): PlayState {
  switch (action.type) {

    case 'LOAD': {
      return {
        grid: deepCopyGrid(action.puzzle.grid),
        rack: [...action.puzzle.rack],
        history: [],
        moves: 0,
        undos: 0,
        won: false,
        invalidCells: new Set(),
      }
    }

    case 'DROP': {
      const { src: dragSrc, target } = action

      // Grid tile dropped back onto the exact cell it was picked up from:
      // nothing changed, so this is a no-op (same as rack→rack below).
      if (
        dragSrc.from === 'grid' &&
        target.to === 'grid' &&
        dragSrc.row === target.row &&
        dragSrc.col === target.col
      ) {
        return state
      }

      const grid = deepCopyGrid(state.grid)
      const rack = [...state.rack]
      const snapshot = { grid: deepCopyGrid(state.grid), rack: [...state.rack] }

      const tile: Tile | null =
        dragSrc.from === 'rack'
          ? rack[dragSrc.rackIdx!]
          : grid[dragSrc.row!][dragSrc.col!]

      if (!tile) return state

      if (target.to === 'grid') {
        const { row, col } = target
        if (dragSrc.from === 'rack') {
          if (dragSrc.rackIdx === undefined) return state
          rack.splice(dragSrc.rackIdx, 1)
          const displaced = grid[row][col]
          grid[row][col] = tile
          if (displaced) rack.push(displaced)
        } else {
          if (dragSrc.row === undefined || dragSrc.col === undefined) return state
          grid[dragSrc.row][dragSrc.col] = grid[row][col]
          grid[row][col] = tile
        }
      } else {
        if (dragSrc.from === 'rack') return state
        if (dragSrc.row === undefined || dragSrc.col === undefined) return state
        grid[dragSrc.row][dragSrc.col] = null
        rack.push(tile)
      }

      const newWon = rack.length === 0 && validateGrid(grid)
      let newInvalidCells = new Set<string>()
      if (rack.length === 0 && !newWon) {
        newInvalidCells = getInvalidCells(grid)
        newInvalidCells.add(`__v:${Date.now()}`)
      }
      return {
        ...state,
        grid,
        rack,
        history: [...state.history, snapshot],
        moves: state.moves + 1,
        won: newWon,
        invalidCells: newInvalidCells,
      }
    }

    case 'UNDO': {
      if (state.history.length === 0) return state
      const prev = state.history[state.history.length - 1]
      return {
        ...state,
        grid: prev.grid,
        rack: prev.rack,
        history: state.history.slice(0, -1),
        undos: state.undos + 1,
        won: false,
        invalidCells: new Set(),
      }
    }

    case 'RESET_TO_INITIAL':
      return {
        ...state,
        grid: action.grid,
        rack: action.rack,
        history: [],
        moves: 0,
        undos: 0,
        won: false,
        invalidCells: new Set(),
      }

    case 'SET_WON':
      return { ...state, won: action.won, invalidCells: new Set() }
  }
}

export const INITIAL_PLAY_STATE: PlayState = {
  grid: [],
  rack: [],
  history: [],
  moves: 0,
  undos: 0,
  won: false,
  invalidCells: new Set(),
}

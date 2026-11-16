import { useReducer, useCallback, useRef } from 'react'
import type { Tile, Grid, DragSrc, Puzzle } from '../types'
import { playReducer, deepCopyGrid, INITIAL_PLAY_STATE, type DropTarget } from '../lib/playReducer'

// The reducer itself (every move, and the finish check) lives in
// src/lib/playReducer.ts so the harnesses can drive the real thing.
export type { DropTarget }

export function usePlayState() {
  const [state, dispatch] = useReducer(playReducer, INITIAL_PLAY_STATE)
  const initialState = useRef<{ grid: Grid; rack: Tile[] } | null>(null)

  const loadPuzzle = useCallback((p: Puzzle) => {
    initialState.current = { grid: deepCopyGrid(p.grid), rack: [...p.rack] }
    dispatch({ type: 'LOAD', puzzle: p })
  }, [])

  const drop = useCallback((src: DragSrc, target: DropTarget) => {
    dispatch({ type: 'DROP', src, target })
  }, [])

  const undo = useCallback(() => {
    dispatch({ type: 'UNDO' })
  }, [])

  const reset = useCallback(() => {
    if (!initialState.current) return
    dispatch({
      type: 'RESET_TO_INITIAL',
      grid: deepCopyGrid(initialState.current.grid),
      rack: [...initialState.current.rack],
    })
  }, [])

  const setWon = useCallback((won: boolean) => {
    dispatch({ type: 'SET_WON', won })
  }, [])

  return {
    grid: state.grid,
    rack: state.rack,
    moves: state.moves,
    undos: state.undos,
    won: state.won,
    invalidCells: state.invalidCells,
    drop,
    undo,
    reset,
    loadPuzzle,
    setWon,
  }
}

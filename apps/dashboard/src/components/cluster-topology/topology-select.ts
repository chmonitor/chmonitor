import { type Dispatch, type SetStateAction, useCallback } from 'react'

/**
 * Stable clear-selection callback for TopoCanvas. setSelected from useState
 * is identity-stable, so this hook's return value stays the same across
 * TopologyView rerenders and does not defeat React.memo on the canvas.
 */
export function useOnClearSelect(
  setSelected: Dispatch<SetStateAction<string | null>>
): () => void {
  return useCallback(() => {
    setSelected(null)
  }, [setSelected])
}

import { describe, it, expect } from 'vitest'
import { cardState, restoreActions, timelineActions } from './lessonState'

const steps = [
  { id: 'a', actions: ['selectProgram:Base', 'reveal:processor'] },
  { id: 'b', actions: ['setProcessor:ROBsize=1', 'setProcessor:dispatch=1', 'sidePanel:hide', 'timeline:cycles=29'] },
  { id: 'c', actions: ['revertProcessor', 'reveal:timeline', 'hide:processor', 'programView:perf'] },
  { id: 'd', actions: ['setProcessor:ROBsize=100'] },
]

describe('state of the simulator at a card', () => {
  it('applies the actions of the cards before it, in the order of the file', () => {
    expect(cardState(steps, 0, ['processor', 'timeline']).hidden.sort()).toEqual(['processor', 'timeline'])
    const b = cardState(steps, 2, ['processor', 'timeline'])
    expect(b.hidden).toEqual(['timeline'])
    expect(b.program).toBe('Base')
    expect(b.overrides).toEqual({ ROBsize: 1, dispatch: 1 })
    expect(b.sidePanel).toBe('hide')
    expect(timelineActions(b)).toEqual(['timeline:cycles=29'])
    const d = cardState(steps, 3, ['processor', 'timeline'])
    expect(d.hidden).toEqual(['processor'])
    expect(d.overrides).toEqual({})                   // reverted
    expect(d.programView).toBe('perf')
  })
  it('changes only what differs from the simulator', () => {
    const state = cardState(steps, 2, [])
    const stored = { dispatch: 4, retire: 4, ROBsize: 64, latencies: { INT: 1 }, ports: { 0: ['INT'] } }
    const same = { simulatedProcess: { name: 'Base', dispatch: 1, retire: 4, ROBsize: 1, latencies: { INT: 1 }, ports: { 0: ['INT'] } } }
    expect(restoreActions(state, same, stored)).toEqual(['sidePanel:hide'])
    const other = { simulatedProcess: { name: 'V1', dispatch: 4, retire: 4, ROBsize: 64, latencies: { INT: 1 }, ports: { 0: ['INT'] } } }
    expect(restoreActions(state, other, stored)).toEqual(['selectProgram:Base', 'revertProcessor',
      'setProcessor:ROBsize=1', 'setProcessor:dispatch=1', 'sidePanel:hide'])
  })
})

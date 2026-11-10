// State of the simulator at a card of a tutorial or lesson, computed from the tutorial file:
// the actions of the cards before it, in the order of the file, give the parts hidden by the
// lesson and the settings of the simulator (processor, program, side panel, program view,
// timeline). Nothing has to be stored, so it cannot get out of step with the file: resuming a
// lesson (or going back to a card) puts the simulator as it should be at that card.
import { actionList, parseAction } from '@/tutorialActions'

export function cardState(steps, index, initialHidden = []) {
  const hidden = new Set(initialHidden)
  const st = { program: null, processor: null, overrides: {}, sidePanel: null, programView: null, timeline: {} }
  for (const step of (steps ?? []).slice(0, Math.max(0, index))) {
    for (const text of actionList(step.actions)) {
      const a = parseAction(text)
      if (!a) continue
      switch (a.type) {
        case 'reveal':          a.arg.split(',').map(s => s.trim()).filter(Boolean).forEach(p => hidden.delete(p)); break
        case 'hide':            a.arg.split(',').map(s => s.trim()).filter(Boolean).forEach(p => hidden.add(p)); break
        case 'selectProgram':   st.program = a.arg; break
        case 'selectProcessor': st.processor = a.arg; st.overrides = {}; break
        case 'revertProcessor': st.overrides = {}; break
        case 'setProcessor':    if (a.key && Number.isFinite(Number(a.value))) st.overrides[a.key] = Number(a.value); break
        case 'sidePanel':       st.sidePanel = a.arg; break
        case 'programView':     st.programView = a.arg; break
        case 'timeline':        if (a.key) st.timeline[a.key] = a.value; break
      }
    }
  }
  return { hidden: [...hidden], ...st }
}

// Actions that put the simulator in the state of the card (only what differs from now)
export function restoreActions(state, simState, storedProcessor) {
  const acts = []
  if (state.program && simState.simulatedProcess?.name !== state.program) acts.push(`selectProgram:${state.program}`)
  if (state.processor && simState.processorName !== state.processor) acts.push(`selectProcessor:${state.processor}`)
  // the processor: its stored configuration with the parameters changed by the cards
  if (storedProcessor && simState.simulatedProcess) {
    const expected = { ...storedProcessor, ...state.overrides }
    const keys = ['dispatch', 'retire', 'ROBsize', 'bPenalty', ...Object.keys(state.overrides)]
    const value = (v) => (v === undefined || v === null || v === '' ? null : Number(v))
    const same = keys.every(k => value(simState.simulatedProcess[k]) === value(expected[k])) &&
      JSON.stringify(simState.simulatedProcess.latencies ?? {}) === JSON.stringify(storedProcessor.latencies ?? {}) &&
      JSON.stringify(simState.simulatedProcess.ports ?? {}) === JSON.stringify(storedProcessor.ports ?? {})
    if (!same) acts.push('revertProcessor', ...Object.entries(state.overrides).map(([k, v]) => `setProcessor:${k}=${v}`))
  }
  if (state.sidePanel)   acts.push(`sidePanel:${state.sidePanel}`)
  if (state.programView) acts.push(`programView:${state.programView}`)
  return acts
}

export const timelineActions = (state) =>
  Object.entries(state.timeline).map(([k, v]) => `timeline:${k}=${v}`)

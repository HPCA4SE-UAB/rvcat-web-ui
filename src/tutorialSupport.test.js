import { describe, it, expect } from 'vitest'
import { renderTutorialText, tutorialValue, tutorialNumber } from './tutorialValues'
import { parseAction, actionList, isKnownAction } from './tutorialActions'
import tutorial2 from '../public/tutorial/tutorial2.json'

const simState = {
  processorName: 'B4',
  simulatedProcess: {
    name: 'Base', iters: 1000, dispatch: 4, retire: 5, ROBsize: 64, bPenalty: 8,
    latencies: { 'FLOAT.ADD': 2, MEM: 4 },
    instruction_list: [{ text: 'tmp = V[i]' }, { text: 'sum = sum + tmp' }, { text: 'if c go back', stride: 1 }],
  },
  executionResults: {
    total_cycles: 4007, total_instructions: 7000, total_iterations: 1000, cycles_per_iteration: 4.007, ipc: 1.7469,
    ports: { 0: 50, 1: 50 },
    critical_path: { instructions: [{ percentage: 8.2 }, { percentage: 45.3 }],
                     repeating_pattern: { start_iteration: 2, end_iteration: 999, cycles_per_iteration: 4 } },
  },
  performanceAnalysis: {
    LatencyTime: 4, ThroughputTime: 2, BestTime: 4, 'performance-bound': 'LATENCY',
    'Latency-Bounds': [{ variable: 'sum', cycles: 4 }, { variable: 'i', cycles: 1 }],
    'Throughput-Bounds': [{ resource: 'Dispatch', ports: [], cycles: 1.75 }, { resource: 'Ports', ports: [1, 3], cycles: 1 }],
  },
}

describe('live values of the tutorial texts', () => {
  it('replace the names by the current values, with their usual format', () => {
    expect(renderTutorialText('{{program}} on {{processor}}, N={{N}}', simState)).toBe('Base on B4, N=1,000')
    expect(renderTutorialText('{{cycles}} cycles, {{cyclesPerIter}} cycles/iter, IPC {{ipc}}', simState))
      .toBe('4,007 cycles, 4.01 cycles/iter, IPC 1.747')
    expect(renderTutorialText('P1 {{port.P1}}%, dispatch {{dispatchUsage}}%', simState)).toBe('P1 50%, dispatch 43.7%')
    expect(renderTutorialText('{{chain.sum}} / {{resource.Dispatch}} / {{resource.P1+P3}} / {{latency.FLOAT.ADD}}', simState))
      .toBe('4.00 / 1.75 / 1.00 / 2')
    expect(renderTutorialText('{{boundType}}-bound, {{critical.1}}%, iterations {{patternFrom}}–{{patternTo}}', simState))
      .toBe('latency-bound, 45%, iterations 2–999')
    expect(renderTutorialText('{{minTime|1}} and {{instr.1}}', simState)).toBe('4.0 and sum = sum + tmp')
  })

  it('show … when a value is not available yet', () => {
    expect(renderTutorialText('{{cyclesPerIter}}', { simulatedProcess: {} })).toBe('…')
    expect(renderTutorialText('{{chain.x}} {{unknown}}', simState)).toBe('… …')
    expect(tutorialValue('mispredPerIter', simState)).toBe(null)
  })

  it('give the number of a numeric question', () => {
    expect(tutorialNumber('{{minTime}}', simState)).toBe(4)
    expect(tutorialNumber(2, simState)).toBe(2)
    expect(tutorialNumber('2.5', simState)).toBe(2.5)
    expect(tutorialNumber('{{cyclesPerIter}}', { simulatedProcess: {} })).toBe(null)
  })
})

describe('tutorial actions', () => {
  it('parse actions and lists of actions', () => {
    expect(parseAction('selectProgram:Base')).toMatchObject({ type: 'selectProgram', arg: 'Base' })
    expect(parseAction('setLatency:FLOAT.ADD=1')).toMatchObject({ type: 'setLatency', key: 'FLOAT.ADD', value: '1' })
    expect(parseAction('runSimulation')).toMatchObject({ type: 'runSimulation', arg: '' })
    expect(actionList('a:1\n\n b ')).toEqual(['a:1', 'b'])
    expect(isKnownAction('timeline:critical=on')).toBe(true)
    expect(isKnownAction('fly:away')).toBe(false)
  })

  it('the distributed tutorial only uses known actions and live values', () => {
    for (const step of tutorial2.steps) {
      for (const a of [...actionList(step.actions), ...actionList(step.showMe)])
        expect({ id: step.id, a, known: isKnownAction(a) }).toEqual({ id: step.id, a, known: true })
      const texts = [step.title, step.description, step.questionText, step.numericCorrect, step.numericWrong,
                     ...(step.answers ?? []).flatMap(x => [x.text, x.explanation])].filter(Boolean).join(' ')
      for (const [, name] of texts.matchAll(/\{\{\s*([\w.+]+)\s*(?:\|\d+)?\}\}/g))
        expect({ id: step.id, name, known: tutorialValue(name, simState) !== null || /^(chain|resource|critical|port|instr|latency|mispredPerIter)/.test(name) })
          .toEqual({ id: step.id, name, known: true })
    }
  })
})

import { describe, expect, it } from 'vitest'
import {
  createTutorialStepId,
  get_processor_dot,
  getLogicalElementCount,
  migrateTutorialFlow,
  TUTORIAL_FLOW_VERSION
} from './common'

describe('logical element count', () => {
  it('uses the loop branch stride to recover the configured element count', () => {
    const scalarProgram = [
      { type: 'MEM', stride: 1, lanes: 1 },
      { type: 'BRANCH', stride: 1 }
    ]
    const simdProgram = [
      { type: 'VMEM', stride: 1, lanes: 4 },
      { type: 'BRANCH', stride: 4 }
    ]

    expect(getLogicalElementCount(scalarProgram, 100)).toBe(100)
    expect(getLogicalElementCount(simdProgram, 25)).toBe(100)
  })

  it('defaults the loop stride to one when there is no non-unit branch stride', () => {
    expect(getLogicalElementCount([{ type: 'BRANCH' }], 100)).toBe(100)
  })
})

describe('processor graph markup', () => {
  it('escapes operation data before inserting it into Graphviz HTML labels', () => {
    const dot = get_processor_dot({
      ports: { 0: ['INT.<"\'&'] },
      latencies: { 'INT.<"\'&': 2 },
      ROBsize: 20,
      sched: 'optimal'
    }, false)

    expect(dot).toContain('ID="op:0:0:INT.&lt;&quot;&#39;&amp;"')
    expect(dot).toContain('INT.&lt;&quot;&#39;&amp;</FONT>')
  })
})

describe('tutorial flow migration', () => {
  it('assigns stable ids and linear successors to legacy tutorials', () => {
    const migrated = migrateTutorialFlow({
      steps: [{ title: 'First' }, { title: 'Second' }, { title: 'Last' }]
    })

    expect(migrated.flowVersion).toBe(TUTORIAL_FLOW_VERSION)
    expect(migrated.steps.map(step => step.next)).toEqual([
      [migrated.steps[1].id],
      [migrated.steps[2].id],
      []
    ])
    expect(new Set(migrated.steps.map(step => step.id)).size).toBe(3)
  })

  it('preserves destinations in the current flow format', () => {
    const tutorial = {
      flowVersion: TUTORIAL_FLOW_VERSION,
      steps: [
        { id: 'a', next: ['c'] },
        { id: 'b', next: [] },
        { id: 'c', next: ['a', 'end'] }
      ]
    }

    expect(migrateTutorialFlow(tutorial).steps.map(step => step.next))
      .toEqual([['c'], [], ['a', 'end']])
  })

  it('rejects unknown, self-referencing, or duplicate destinations', () => {
    const makeTutorial = (next) => ({
      flowVersion: TUTORIAL_FLOW_VERSION,
      steps: [{ id: 'a', next }, { id: 'b', next: [] }]
    })

    expect(() => migrateTutorialFlow(makeTutorial(['missing']))).toThrow(/unknown successor/)
    expect(() => migrateTutorialFlow(makeTutorial(['a']))).toThrow(/self-link/)
    expect(() => migrateTutorialFlow(makeTutorial(['b', 'b']))).toThrow(/duplicate successor/)
    expect(() => migrateTutorialFlow(makeTutorial(['end', 'end']))).toThrow(/duplicate end destination/)
  })

  it('rejects unsupported flow versions instead of rewriting their links', () => {
    expect(() => migrateTutorialFlow({
      flowVersion: TUTORIAL_FLOW_VERSION + 1,
      steps: []
    })).toThrow(/Unsupported tutorial flow version/)
  })

  it('creates distinct step ids', () => {
    expect(createTutorialStepId()).not.toBe(createTutorialStepId())
  })
})

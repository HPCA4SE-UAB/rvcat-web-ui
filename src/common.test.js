import { describe, expect, it } from 'vitest'
import {
  createTutorialStepId,
  migrateTutorialFlow,
  TUTORIAL_FLOW_VERSION
} from './common'

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
        { id: 'c', next: ['a', 'b'] }
      ]
    }

    expect(migrateTutorialFlow(tutorial).steps.map(step => step.next))
      .toEqual([['c'], [], ['a', 'b']])
  })

  it('rejects unknown, self-referencing, or duplicate destinations', () => {
    const makeTutorial = (next) => ({
      flowVersion: TUTORIAL_FLOW_VERSION,
      steps: [{ id: 'a', next }, { id: 'b', next: [] }]
    })

    expect(() => migrateTutorialFlow(makeTutorial(['missing']))).toThrow(/unknown successor/)
    expect(() => migrateTutorialFlow(makeTutorial(['a']))).toThrow(/self-link/)
    expect(() => migrateTutorialFlow(makeTutorial(['b', 'b']))).toThrow(/duplicate successor/)
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

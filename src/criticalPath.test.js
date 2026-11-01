import { describe, expect, it } from 'vitest'
import { computeCriticalCycles } from './criticalPath'

describe('critical path graph', () => {
  it('maps the longest weighted path to timeline cycles', () => {
    const graph = {
      version: 1,
      dynamic_instruction_count: 1,
      node_count: 3,
      source: 0,
      sink: 2,
      stages: ['dispatch', 'execute', 'retire'],
      dependencies_by_node: [
        [],
        [[0, 1]],
        [[1, 4]]
      ]
    }

    expect(computeCriticalCycles(graph, [[0, 0, 0, 0, 'DEEEWR', [0, 1, 2, 3, 4, 5], -1]]))
      .toEqual([[0, 1, 2, 3, 4, 5]])
  })

  it('rejects graph metadata that does not match timeline rows', () => {
    const graph = {
      version: 1,
      dynamic_instruction_count: 1,
      node_count: 3,
      source: 0,
      sink: 2,
      stages: ['dispatch', 'execute', 'retire'],
      dependencies_by_node: [[], [[0, 1]], [[1, 1]]]
    }

    expect(() => computeCriticalCycles(graph, [])).toThrow(/Timeline rows do not match/)
  })
})

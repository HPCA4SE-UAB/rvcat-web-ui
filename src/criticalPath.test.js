import { describe, expect, it } from 'vitest'
import { computeCriticalCycles, findLastRetiredInstructionIndex } from './criticalPath'

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

  it('finds the last retired instruction within the visible cycles', () => {
    const rows = [
      [0, 0, 0, 0, 'DEER', [], -1],
      [0, 1, 2, 0, 'DEEEER', [], -1]
    ]

    expect(findLastRetiredInstructionIndex(rows, 4)).toBe(0)
    expect(findLastRetiredInstructionIndex(rows, 8)).toBe(1)
    expect(findLastRetiredInstructionIndex(rows, 3)).toBeNull()
  })

  it('calculates the critical path to an earlier retirement independently of the global sink', () => {
    const graph = {
      version: 1,
      dynamic_instruction_count: 2,
      node_count: 6,
      source: 0,
      sink: 5,
      stages: ['dispatch', 'execute', 'retire'],
      dependencies_by_node: [
        [],
        [[0, 1]],
        [[1, 1]],
        [[0, 0]],
        [[3, 1], [1, 0]],
        [[4, 1], [2, 0]]
      ]
    }
    const rows = [
      [0, 0, 0, 0, 'DEEEWR', [], -1],
      [0, 1, 2, 0, 'DEEEWR', [], -1]
    ]

    const earlierPath = computeCriticalCycles(graph, rows, 0)
    const fullPath = computeCriticalCycles(graph, rows)

    expect(earlierPath[0]).toEqual([0, 1, 5])
    expect(earlierPath[1]).toEqual([])
    expect(fullPath[0]).toEqual([])
    expect(fullPath[1]).not.toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { throughputBoundRows, latencyBoundRows, instrTypeOper, instrPorts } from './performanceBounds'

// Guide example (section 4): instruction texts by index
const program = ['R = T', 'R = R - Two', 'T = A[i]', 'T = T + J', 'J = B[i]',
                 'i = i + 1', 'c = i != N', 'J = J * R', 'if c go back'].map(text => ({ text }))
// Types and ports (bit masks) of the instructions used in the tooltips
Object.assign(program[5], { type: 'INT', oper: 'ARITH', ports: 0b101 })   // P0, P2
Object.assign(program[7], { type: 'FLOAT', oper: 'MUL', ports: 0b1000 })  // P3
Object.assign(program[8], { type: 'BRANCH', oper: '', ports: 0b1 })       // P0

describe('throughputBoundRows', () => {
  const bounds = [
    { resource: 'Dispatch', ports: [], instructions: [0, 1, 2, 3, 4, 5, 6, 7, 8], excluded: [],
      throughput: 4, cycles: 2.25, bottleneck: false },
    { resource: 'Ports', ports: [0], instructions: [8],
      excluded: [{ index: 5, other_ports: [2] }, { index: 6, other_ports: [2] }],
      throughput: 1, cycles: 1, bottleneck: false },
    { resource: 'Ports', ports: [0, 2, 3], instructions: [0, 1, 3, 5, 6, 7, 8],
      excluded: [{ index: 2, other_ports: [1] }, { index: 4, other_ports: [1] }],
      throughput: 3, cycles: 7 / 3, bottleneck: true },
  ]

  it('describes resources, included and excluded instructions, and the formula', () => {
    const { rows, hidden } = throughputBoundRows(bounds, program)
    expect(hidden).toBe(0)
    expect(rows[0]).toMatchObject({ resource: 'Dispatch', allRange: 'All (0–8)', cycles: '2.25' })
    expect(rows[0].formula).toBe('9 instructions / 4 instructions/cycle (dispatch width) = 2.25 cycles/iter')

    const p0 = rows[1]
    expect(p0.included).toEqual([{ index: 8, title: '8: if c go back\nBRANCH → can use P0' }])
    expect(p0.excluded[0]).toEqual({ index: 5,
      title: '5: i = i + 1\nINT.ARITH → can use P0, P2\nNot counted: it can also use P2' })

    const p023 = rows[2]
    expect(p023).toMatchObject({ resource: 'P0+P2+P3', cycles: '2.33', bottleneck: true })
    expect(p023.formula).toBe('7 instructions / (3 ports × 1 instruction/cycle) = 2.33 cycles/iter')
  })

  it('keeps only the highest bounds, in their original order, when there are too many', () => {
    const { rows, hidden } = throughputBoundRows(bounds, program, 2)
    expect(hidden).toBe(1)
    expect(rows.map(r => r.resource)).toEqual(['Dispatch', 'P0+P2+P3'])
  })
})

describe('instruction details', () => {
  it('formats Type.Oper and the usable ports', () => {
    expect(instrTypeOper({ type: 'MEM', oper: 'LOAD' })).toBe('MEM.LOAD')
    expect(instrTypeOper({ type: 'BRANCH', oper: '' })).toBe('BRANCH')
    expect(instrTypeOper(undefined)).toBe('')
    expect(instrPorts({ ports: 28 })).toBe('P2, P3, P4')
    expect(instrPorts({})).toBe('')
  })
})

describe('latencyBoundRows', () => {
  it('describes each cyclic chain', () => {
    const { rows } = latencyBoundRows([
      { variable: 'i', instructions: [5], latencies: [1], iterations: 1, cycles: 1, bottleneck: false },
      { variable: 'T', instructions: [0, 1, 7, 3], latencies: [2, 2, 4, 2], iterations: 2,
        cycles: 5, bottleneck: true },
    ], program)
    expect(rows[1]).toMatchObject({ recurrence: 'T → T', cycles: '5.00', bottleneck: true })
    expect(rows[1].chain.map(c => c.index)).toEqual([0, 1, 7, 3])
    expect(rows[1].chain[2].title).toBe('7: J = J * R\nFLOAT.MUL → latency 4')
    expect(rows[1].formula).toBe('(2+2+4+2) = 10 cycles / 2 iterations = 5.00 cycles/iter')
  })

  it('returns no rows without data', () => {
    expect(latencyBoundRows(undefined)).toEqual({ rows: [], hidden: 0 })
  })
})

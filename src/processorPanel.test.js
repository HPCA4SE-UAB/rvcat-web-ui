import { describe, it, expect } from 'vitest'
import { unassignedOperations, removePortFrom, get_processor_dot, MAX_PORTS } from './common'
import { processorSignature } from './editDrafts'

describe('ports of the Processor panel', () => {
  const ports = {
    0: ['INT', 'BRANCH', 'MEM', 'VMEM', 'VINT'],
    1: ['FLOAT', 'VFLOAT.ADD', 'VFLOAT.MUL', 'VFLOAT.FMA', 'VFLOAT.DIV', 'VFLOAT.SQRT'],
    3: ['FLOAT.ADD'],
  }

  it('list the operation types that no port executes (CVT, SHUFFLE, PERMUTE and CMP use a fallback)', () => {
    expect(unassignedOperations(ports)).toEqual([])
    expect(unassignedOperations({ 0: ['INT', 'MEM', 'VMEM', 'VINT', 'FLOAT'] })).toEqual(
      ['VFLOAT.ADD', 'VFLOAT.MUL', 'VFLOAT.FMA', 'VFLOAT.DIV', 'VFLOAT.SQRT', 'VFLOAT.CVT', 'VFLOAT.CMP', 'BRANCH'])
  })

  it('remove a port: renumber the others and move to P0 what only it executed', () => {
    const { ports: after, moved } = removePortFrom(ports, '1')
    expect(Object.keys(after)).toEqual(['0', '1'])
    expect(after['1']).toEqual(['FLOAT.ADD'])             // old P3
    expect(moved).toEqual(['FLOAT.MUL', 'FLOAT.FMA', 'FLOAT.DIV', 'FLOAT.SQRT', 'FLOAT.CVT', 'FLOAT.CMP',
      'VFLOAT.ADD', 'VFLOAT.MUL', 'VFLOAT.FMA', 'VFLOAT.DIV', 'VFLOAT.SQRT'])
    expect(after['0']).toEqual([...ports['0'], ...moved])
    expect(unassignedOperations(after)).toEqual([])
    expect(ports['1']).toHaveLength(6)                    // the original is not modified
  })

  it('warn in the diagram about operations without port, and limit the number of ports', () => {
    const process = { ports: { 0: ['INT'] }, latencies: { INT: 1 } }
    expect(get_processor_dot(process, true)).toMatch(/ID="unassigned".*operation types without port/)
    expect(get_processor_dot(process, false)).not.toMatch(/unassigned/)
    const many = Object.fromEntries([...Array(MAX_PORTS)].map((_, i) => [String(i), i ? [] : ['INT']]))
    expect(get_processor_dot({ ports: many, latencies: {} }, true)).not.toMatch(/ID="addport"/)
  })
})

describe('modified processor', () => {
  it('compare configurations whatever the name and the order of keys and port entries', () => {
    const a = { name: 'B1', dispatch: 2, latencies: { INT: 1, FLOAT: 3 }, ports: { 0: ['INT', 'MEM'], 1: ['FLOAT'] } }
    const b = { name: 'f1', ports: { 1: ['FLOAT'], 0: ['MEM', 'INT'] }, latencies: { FLOAT: 3, INT: 1 }, dispatch: 2,
                instruction_list: [] }
    expect(processorSignature(a)).toBe(processorSignature(b))
    expect(processorSignature({ ...b, latencies: { FLOAT: 4, INT: 1 } })).not.toBe(processorSignature(a))
  })
})

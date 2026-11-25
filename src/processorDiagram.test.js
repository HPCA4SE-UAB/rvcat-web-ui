import { describe, it, expect } from 'vitest'
import { portTypeLines, memoryPorts } from './processorDiagram'

describe('diagram of the processor', () => {
  it('shows a whole type by its name, and some operations by their short names', () => {
    const lines = portTypeLines(['INT', 'FLOAT.ADD', 'FLOAT.MUL', 'VFLOAT.ADD'])
    expect(lines.map(l => l.label)).toEqual(['INT', 'FP + ×', 'VFP +'])
    expect(lines[1].ops).toEqual(['ADD', 'MUL'])
    expect(lines[0].ops).toBeNull()
  })

  it('a type with all its operations listed is a whole type', () => {
    expect(portTypeLines(['MEM.LOAD', 'MEM.STORE']).map(l => l.label)).toEqual(['MEM'])
    expect(portTypeLines(['MEM.LOAD', 'VMEM.LOAD']).map(l => l.label)).toEqual(['MEM LD', 'VMEM LD'])
    expect(portTypeLines(['BRANCH']).map(l => l.label)).toEqual(['BR'])
  })

  it('finds the ports joined to the memory', () => {
    expect(memoryPorts({ 0: ['INT'], 2: ['MEM.LOAD', 'VMEM.LOAD'], 7: ['MEM'] })).toEqual(['2', '7'])
  })
})

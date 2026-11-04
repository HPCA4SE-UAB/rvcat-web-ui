import { describe, expect, it } from 'vitest'
import { parseNode, parseEdge, chainSteps, isChainEdge } from './graphHighlight'

describe('graph names', () => {
  it('parses instruction nodes and edges', () => {
    expect(parseNode('i2s7')).toEqual({ iter: 2, instr: 7 })
    expect(parseNode('LoopCar1')).toBeNull()
    expect(parseEdge('i1s3->i2s0')).toMatchObject({ a: { iter: 1, instr: 3 }, b: { iter: 2, instr: 0 } })
    expect(parseEdge('LoopCar1->i1s0')).toMatchObject({ a: null, b: { iter: 1, instr: 0 } })
    expect(parseEdge('i1s0')).toBeNull()
  })
})

describe('isChainEdge', () => {
  // Guide example: T -> T through instructions 0, 1, 7 and 3, spanning 2 iterations
  const steps = chainSteps([0, 1, 7, 3])

  it('accepts dependences of the chain within and across iterations', () => {
    expect(isChainEdge(parseEdge('i1s0->i1s1'), steps)).toBe(true)
    expect(isChainEdge(parseEdge('i1s1->i1s7'), steps)).toBe(true)
    expect(isChainEdge(parseEdge('i1s7->i2s3'), steps)).toBe(true)
    expect(isChainEdge(parseEdge('i2s3->i3s0'), steps)).toBe(true)
  })

  it('rejects other dependences', () => {
    expect(isChainEdge(parseEdge('i1s7->i1s3'), steps)).toBe(false)   // wrong iteration
    expect(isChainEdge(parseEdge('i1s2->i1s3'), steps)).toBe(false)   // not in the chain
    expect(isChainEdge(parseEdge('i1s0->i1s7'), steps)).toBe(false)   // skips a step
    expect(isChainEdge(parseEdge('LoopCar1->i1s0'), steps)).toBe(false)
  })

  it('handles a single-instruction recurrence', () => {
    const counter = chainSteps([5])
    expect(isChainEdge(parseEdge('i1s5->i2s5'), counter)).toBe(true)
    expect(isChainEdge(parseEdge('i1s5->i1s5'), counter)).toBe(false)
  })
})

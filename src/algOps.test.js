import { describe, expect, it } from 'vitest'
import { loopStride, cyclesPerAlgOp, algOpFormula, resultStride,
         resultCyclesPerAlgOp, resultInstrPerAlgOp, speedupOver, strideWarning } from './algOps'

const branch = (stride) => ({ type: 'BRANCH', oper: '', stride, text: 'if c go back' })

describe('loop stride', () => {
  it('is the stride of the BRANCH instruction (1 by default)', () => {
    expect(loopStride([{ type: 'MEM', stride: 2 }, branch(1)])).toBe(1)
    expect(loopStride([{ type: 'MEM', stride: 2 }, branch(4)])).toBe(4)
    expect(loopStride([])).toBe(1)
    expect(loopStride(undefined)).toBe(1)
  })
})

describe('cycles per algorithmic operation', () => {
  it('divides cycles/iter by the loop stride', () => {
    expect(cyclesPerAlgOp(2, 4)).toBe(0.5)
    expect(cyclesPerAlgOp('x', 4)).toBeNull()
    expect(algOpFormula(2, 4)).toBe('2.00 cycles/iter ÷ 4 alg opers/iter (loop stride) = 0.50 cycles/alg oper')
  })

  it('works for stored results, with or without the saved stride', () => {
    const result = { total_cycles: 1000, total_iterations: 250, context: { program: { N: 1000 } } }
    expect(resultStride(result)).toBe(4)
    expect(resultCyclesPerAlgOp(result)).toBe(1)
    result.context.program.stride = 4
    expect(resultCyclesPerAlgOp(result)).toBe(1)
    expect(resultCyclesPerAlgOp({ total_cycles: 10, total_iterations: 5 })).toBeNull()
  })

  it('gives instructions per alg oper and the speedup over a reference', () => {
    const base = { total_cycles: 407, total_instructions: 700, total_iterations: 100,
                   context: { program: { N: 100, stride: 1 } } }
    const simd = { total_cycles: 108, total_instructions: 175, total_iterations: 25,
                   context: { program: { N: 100, stride: 4 } } }
    expect(resultInstrPerAlgOp(base)).toBe(7)
    expect(resultInstrPerAlgOp(simd)).toBe(1.75)
    expect(speedupOver(base, simd)).toBeCloseTo(407 / 108)
    expect(speedupOver(base, base)).toBe(1)
    expect(speedupOver(undefined, simd)).toBeNull()
  })
})

describe('stride warning', () => {
  it('warns about vector instructions or a counter step > 1 with loop stride 1', () => {
    expect(strideWarning([{ type: 'VMEM', lanes: 4 }, branch(1)])).toMatch(/4 lanes/)
    expect(strideWarning([{ type: 'INT', text: 'i = i + 2' }, branch(1)])).toMatch(/work of 2/)
  })
  it('does not warn when the stride is set or the loop is scalar', () => {
    expect(strideWarning([{ type: 'VMEM', lanes: 4 }, branch(4)])).toBe('')
    expect(strideWarning([{ type: 'INT', text: 'i = i + 1' }, branch(1)])).toBe('')
  })
})

import { describe, it, expect } from 'vitest'
import { parseInstruction, deriveRowFields, analyzeProgramText } from './instructionText'
import { checkProgram } from './programChecks'
import { conditionalBranches, conditionalDepth } from './branches'
import { instructionSummary } from './instructionSummary'
import { validateProgram, instructionTiming } from './common'
import f1 from '../public/program/f1.json'
import f1AVX from '../public/program/f1-AVX.json'

describe('conditional branches', () => {
  it('parse "if c skip k" and give the BRANCH fields', () => {
    expect(parseInstruction('if t skip 2').p).toMatchObject({ kind: 'cbranch', cond: 't', skip: 2 })
    expect(parseInstruction('if t skip 0').ok).toBe(false)
    expect(deriveRowFields(f1.instruction_list, 3)).toMatchObject({ type: 'BRANCH', source1: 't', constant: '1' })
  })

  it('compare floats with FLOAT.CMP', () => {
    expect(deriveRowFields(f1.instruction_list, 2, f1.declarations)).toMatchObject({ type: 'FLOAT', oper: 'CMP', size: 'single' })
    // without its own entry, FLOAT.CMP uses the ports and latency of FLOAT.ADD
    expect(instructionTiming({ type: 'FLOAT', oper: 'CMP', size: 'single' }, { 'FLOAT.ADD': 4 }, { 'FLOAT.ADD': 2 }))
      .toEqual({ latency: 4, ports: 2 })
  })

  it('find the conditional blocks', () => {
    expect(conditionalBranches(f1.instruction_list)).toEqual([{ index: 3, skip: 1 }])
    expect(conditionalDepth(f1.instruction_list)).toEqual([0, 0, 0, 0, 1, 0, 0, 0])
  })

  it('check the skip count, the probability and the misprediction rate', () => {
    const list = f1.instruction_list.map(i => ({ ...i }))
    list[3] = { ...list[3], constant: '5', prob: 1.5 }
    expect(checkProgram(list).errors.map(e => e.code)).toEqual(['E5', 'E5'])
    expect(validateProgram({ name: 'x', instruction_list: list }).join(' ')).toMatch(/conditional branch skips/)
  })
})

describe('vector masks and masked stores (f1-AVX)', () => {
  it('parse the mask test and the masked store', () => {
    expect(parseInstruction('t = none(m[0:7])').p).toMatchObject({ op: 'test', L: 8, sources: ['m'] })
    expect(parseInstruction('C[x:x+7] = a[0:7] if m[0:7]').p).toMatchObject({ kind: 'store', value: 'a', mask: 'm', L: 8 })
    expect(parseInstruction('a[0:7] = b[0:7] if m[0:7]').ok).toBe(false)   // only stores have a mask
  })

  it('give the fields of the vector compare, the test and the masked store', () => {
    const list = f1AVX.instruction_list
    expect(deriveRowFields(list, 2, f1AVX.declarations)).toMatchObject({ type: 'VFLOAT', oper: 'CMP', lanes: 8 })
    expect(deriveRowFields(list, 3)).toMatchObject({ type: 'VINT', oper: 'LOGIC', destin: 't', source1: 'm' })
    expect(deriveRowFields(list, 5)).toMatchObject({ type: 'VMEM', oper: 'STORE', mask: 'm', source1: 'a' })
    const a = analyzeProgramText(list), c = checkProgram(list, { vlen: 32 })
    expect([...a.warnings, ...a.infos, ...c.errors, ...c.warnings]).toEqual([])
  })

  it('only a vector store can have a mask', () => {
    const list = f1AVX.instruction_list.map(i => ({ ...i }))
    list[0] = { ...list[0], mask: 'm' }
    expect(validateProgram({ name: 'x', instruction_list: list }).join(' ')).toMatch(/only a vector store/)
  })
})

describe('instruction summaries (Program panel tooltips)', () => {
  const list = f1AVX.instruction_list.map(i => ({ ...i, latency: 3, ports: 0b110 }))
  it('describe memory accesses, operations and branches in a few words', () => {
    expect(instructionSummary(list, 0)).toBe('Loads 8 words of A into a from element 0, advancing 8 elements per iteration. Latency 3 cycles, P1, P2.')
    expect(instructionSummary(list, 5)).toMatch(/^Stores a \(8 words\) into C .* only lanes where m is true\./)
    expect(instructionSummary(list, 2)).toMatch(/^VFLOAT\.CMP single on 8 lanes: m ← a, b\./)
    expect(instructionSummary(list, 4)).toMatch(/^Conditional branch on t: skips the next 1 instruction with probability 0\.0039/)
    expect(instructionSummary(list, 8)).toMatch(/^Loop branch: .* 8 algorithmic operations per iteration\./)
    for (let i = 0; i < list.length; i++) {
      const words = instructionSummary(list, i).split(/\s+/).length
      expect({ i, words: words >= 8 && words <= 30 }).toEqual({ i, words: true })
    }
  })
})

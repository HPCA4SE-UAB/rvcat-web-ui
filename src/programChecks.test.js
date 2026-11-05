import { describe, expect, it } from 'vitest'
import { checkProgram, enforceStructure } from './programChecks'
import Base     from '../public/program/Base.json'
import V2       from '../public/program/V2.json'
import BaseSIMD from '../public/program/BaseSIMD.json'
import example  from '../public/program/example.json'

const programs = { Base, V2, BaseSIMD, example }
const load = (name) => programs[name].instruction_list
const codes = (result) => [...result.errors, ...result.warnings].map(r => r.code)

const ld = (array, constant, stride, lanes = 1, type = 'MEM') =>
  ({ type, oper: 'LOAD', size: 'word', source1: 'i', source2: array, constant, stride, lanes, text: '' })
const counter = (k) => ({ type: 'INT', oper: 'ARITH', size: 'word', text: `i = i + ${k}`, destin: 'i', source1: 'i' })
const branch = (S) => ({ type: 'BRANCH', oper: '', size: '', text: 'if c go back', stride: S })

describe('checkProgram', () => {
  it('accepts the distributed programs without errors or warnings', () => {
    const found = ['Base', 'V2', 'BaseSIMD', 'example'].map(name => [name, codes(checkProgram(load(name)))])
    expect(found).toEqual([['Base', []], ['V2', []], ['BaseSIMD', []], ['example', []]])
  })

  it('E2/E3: lanes only for vector instructions, stride only for memory instructions', () => {
    const r = checkProgram([{ type: 'FLOAT', oper: 'ADD', lanes: 4, stride: 2 }, { type: 'VFLOAT', oper: 'ADD', lanes: 1 }, branch(1)])
    expect(r.errors.map(e => e.code)).toEqual(['E2', 'E3', 'E2'])
  })

  it('E4: a forward access cannot start before the array', () => {
    expect(checkProgram([ld('A', '-1', 1), branch(1)]).errors[0].code).toBe('E4')
  })

  it('W1/W3/W8: unrolled or vectorized loop with a wrong loop stride', () => {
    // SIMD loop whose stride was not updated
    expect(codes(checkProgram([ld('V', '', 1, 4, 'VMEM'), counter(4), branch(1)]))).toEqual(['W1', 'W8'])
    // unrolled loop whose memory strides were not updated
    expect(codes(checkProgram([ld('V', '', 1), ld('V', '1', 1), counter(2), branch(2)]))).toEqual(['W3', 'W3'])
  })

  it('W4/W5/W6: unrolled copies with repeated, overlapping or missing offsets', () => {
    expect(codes(checkProgram([ld('V', '', 2), ld('V', '', 2), counter(2), branch(2)]))).toEqual(['W4', 'W6'])
    expect(codes(checkProgram([ld('V', '', 2, 4, 'VMEM'), ld('V', '2', 2, 4, 'VMEM'), counter(8), branch(8)])))
      .toEqual(['W5', 'W6'])
    expect(codes(checkProgram([ld('V', '', 2, 4, 'VMEM'), ld('V', '4', 2, 4, 'VMEM'), counter(8), branch(8)]))).toEqual([])
  })

  it('W7: a backward access should start inside the array', () => {
    expect(codes(checkProgram([ld('V', '', -1), branch(1)]))).toEqual(['W7'])
    expect(codes(checkProgram([ld('V', '1', -1), branch(1)]))).toEqual([])
  })

  it('accepts stencils and fixed addresses (stride 0) without errors', () => {
    const r = checkProgram([ld('A', '0', 1), ld('A', '1', 1), ld('A', '2', 1), ld('K', '', 0), branch(1)])
    expect(r.errors).toEqual([])
  })
})

describe('enforceStructure', () => {
  it('keeps stride only in memory instructions and lanes only in vector instructions', () => {
    expect(enforceStructure({ type: 'FLOAT', stride: 3, lanes: 4 })).toMatchObject({ stride: 1, lanes: 1 })
    expect(enforceStructure({ type: 'VFLOAT', stride: 3, lanes: 1 })).toMatchObject({ stride: 1, lanes: 4 })
    expect(enforceStructure({ type: 'VMEM', stride: 2, lanes: 8 })).toMatchObject({ stride: 2, lanes: 8 })
  })
})

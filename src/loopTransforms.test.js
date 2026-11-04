import { describe, expect, it } from 'vitest'
import { analyzeLoop, parseIndex, vectorizeLoop, unrollLoop, transformLoop } from './loopTransforms'
import { checkProgram } from './programChecks'
import Base     from '../public/program/Base.json'
import V2       from '../public/program/V2.json'
import BaseSIMD from '../public/program/BaseSIMD.json'
import exemple  from '../public/program/exemple.json'

const fields = (list) => list.map(i => [i.text, i.type, i.lanes ?? 1, i.stride ?? 1, i.constant ?? ''])
const clean  = (list) => { const r = checkProgram(list); return [...r.errors, ...r.warnings].map(x => x.code) }

describe('analyzeLoop', () => {
  it('finds the loop control, the counter and the reductions', () => {
    const info = analyzeLoop(Base.instruction_list)
    expect([...info.control].sort()).toEqual([4, 5])
    expect(info.counter).toEqual({ index: 4, variable: 'i', step: 1 })
    expect(info.reductions).toEqual(['sum'])
    expect(info.recurrences).toEqual([])
  })
  it('separates recurrences from reductions', () => {
    const info = analyzeLoop(exemple.instruction_list)
    expect(info.recurrences.sort()).toEqual(['t0', 't3'])   // t1 is written before it is read
  })
})

describe('parseIndex', () => {
  it('reads the usual index forms', () => {
    expect(parseIndex('i')).toEqual({ v: 'i', lo: 0, hi: 0 })
    expect(parseIndex('i+1')).toEqual({ v: 'i', lo: 1, hi: 1 })
    expect(parseIndex('i+4:i+7')).toEqual({ v: 'i', lo: 4, hi: 7 })
    expect(parseIndex('N-1-i')).toBeNull()
  })
})

describe('unrollLoop', () => {
  it('reproduces V2 from Base', () => {
    const { program, errors } = unrollLoop(Base.instruction_list, 2)
    expect(errors).toEqual([])
    expect(fields(program)).toEqual(fields(V2.instruction_list).map(([t, ty, l, s, c]) => [t, ty, l, s, c]))
    expect(clean(program)).toEqual([])
  })
  it('can split a reduction into partial accumulators', () => {
    const { program } = unrollLoop(Base.instruction_list, 2, { splitAccumulators: true })
    expect(program.map(i => i.text)).toEqual([
      'tmp = V[i]', 'sum = sum + tmp', 'tmp = W[i]', 'sum = sum + tmp',
      'tmp = V[i+1]', 'sum1 = sum1 + tmp', 'tmp = W[i+1]', 'sum1 = sum1 + tmp',
      'i = i + 2', 'c = i != N', 'if c go back'])
    expect(program[5]).toMatchObject({ destin: 'sum1', source1: 'sum1' })
  })
  it('unrolls a vectorized loop with offsets that are multiples of the lanes', () => {
    const { program } = unrollLoop(BaseSIMD.instruction_list, 2)
    expect(program[4]).toMatchObject({ text: 'tmp[0:3] = V[i+4:i+7]', stride: 2, constant: '4', lanes: 4 })
    expect(program.at(-1).stride).toBe(8)
    expect(clean(program)).toEqual([])
  })
  it('keeps backward and fixed accesses coherent', () => {
    const loop = [
      { text: 'x = A[N-1-i]', type: 'MEM', oper: 'LOAD', size: 'word', destin: 'x', source1: 'i', source2: 'A', constant: '1', stride: -1, lanes: 1 },
      { text: 'k = K[0]', type: 'MEM', oper: 'LOAD', size: 'word', destin: 'k', source1: 'i', source2: 'K', constant: '', stride: 0, lanes: 1 },
      { text: 's = s + x', type: 'INT', oper: 'ARITH', size: 'word', destin: 's', source1: 's', source2: 'x' },
      { text: 'i = i + 1', type: 'INT', oper: 'ARITH', size: 'word', destin: 'i', source1: 'i', constant: '1' },
      { text: 'c = i != N', type: 'INT', oper: 'ARITH', size: 'word', destin: 'c', source1: 'i', source2: 'N' },
      { text: 'if c go back', type: 'BRANCH', source1: 'c', stride: 1 },
    ]
    const { program } = unrollLoop(loop, 2)
    expect(program[3]).toMatchObject({ stride: -2, constant: '2' })   // element N-2: second copy
    expect(program[1]).toMatchObject({ stride: 0 })
    expect(program.filter(i => i.source2 === 'K')).toHaveLength(1)    // fixed load: only once
    expect(clean(program)).toEqual([])
    const v = vectorizeLoop(loop, 4).program
    expect(v[0]).toMatchObject({ type: 'VMEM', lanes: 4, stride: -1, constant: '4' })   // elements N-4 … N-1
    expect(v[1]).toMatchObject({ type: 'MEM', stride: 0 })
    expect(clean(v)).toEqual([])
  })
})

describe('vectorizeLoop', () => {
  it('reproduces BaseSIMD from Base', () => {
    const { program, errors, notes } = vectorizeLoop(Base.instruction_list, 4)
    expect(errors).toEqual([])
    expect(fields(program)).toEqual(fields(BaseSIMD.instruction_list))
    expect(notes.join(' ')).toMatch(/partial results sum\[0:3\]/)
  })
  it('refuses loops with recurrences or already transformed loops', () => {
    expect(vectorizeLoop(exemple.instruction_list, 4).errors[0]).toMatch(/Recurrence/)
    expect(vectorizeLoop(V2.instruction_list, 4).errors[0]).toMatch(/already unrolled/)
    expect(vectorizeLoop(BaseSIMD.instruction_list, 4).errors[0]).toMatch(/already vectorized/)
  })
})

describe('transformLoop', () => {
  it('vectorizes and unrolls, giving a coherent program', () => {
    const { program, checks } = transformLoop(Base.instruction_list, { lanes: 4, unroll: 2, splitAccumulators: true })
    expect(program.at(-1).stride).toBe(8)
    expect(program[4].text).toBe('tmp[0:3] = V[i+4:i+7]')
    expect(program[5].text).toBe('sum1[0:3] = sum1[0:3] + tmp[0:3]')
    expect(checks).toEqual({ errors: [], warnings: [] })
  })
})

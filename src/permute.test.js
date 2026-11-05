import { describe, it, expect } from 'vitest'
import { parseInstruction, analyzeProgramText } from './instructionText'
import { checkProgram } from './programChecks'
import { transformLoop } from './loopTransforms'
import { instructionTiming, typeOperations } from './common'
import B2 from '../public/processor/B2.json'

const I = (text, type, oper, size, destin, s1 = '', s2 = '', s3 = '', constant = '', stride = 1, lanes = 1) =>
  ({ text, type, oper, size, destin, source1: s1, source2: s2, source3: s3, constant, stride, lanes })
const control = [I('i = i + 1', 'INT', 'ARITH', 'word', 'i', 'i', '', '', '1'),
                 I('c = i != N', 'INT', 'ARITH', 'word', 'c', 'i', 'N'),
                 I('if c go back', 'BRANCH', '', '', '', 'c')]
const WIDEN = [I('x = X[i]', 'MEM', 'LOAD', 'word', 'x', 'i', 'X'),
               I('y = double(x)', 'FLOAT', 'CVT', 'double', 'y', 'x'),
               I('s = s + y', 'FLOAT', 'ADD', 'double', 's', 's', 'y'), ...control]
const NARROW = [I('a = A[i]', 'MEM', 'LOAD', 'long', 'a', 'i', 'A'),
                I('b = single(a)', 'FLOAT', 'CVT', 'single', 'b', 'a'),
                I('B[i] = b', 'MEM', 'STORE', 'word', '', 'b', 'B', 'i'), ...control]
// B[i] = A[N-1-i] (copy reversed): backward load, forward store
const REVERSE = [I('t = A[N-1-i]', 'MEM', 'LOAD', 'word', 't', 'i', 'A', '', '1', -1),
                 I('t = t * k', 'FLOAT', 'MUL', 'single', 't', 't', 'k'),
                 I('B[i] = t', 'MEM', 'STORE', 'word', '', 't', 'B', 'i'), ...control]
// s = s + A[N-1-i]: a reduction only, the order of the lanes does not matter
const SUM_BACK = [I('t = A[N-1-i]', 'MEM', 'LOAD', 'word', 't', 'i', 'A', '', '1', -1),
                  I('s = s + t', 'FLOAT', 'ADD', 'single', 's', 's', 't'), ...control]

const issues = (r) => {
  const a = analyzeProgramText(r.program)
  return [...r.checks.errors, ...r.checks.warnings, ...a.warnings, ...a.infos].map(w => `${w.code}#${w.index}: ${w.message}`)
}
const texts = (r) => r.program.map(i => `${i.text} | ${i.type}.${i.oper}`)

describe('permute instruction', () => {
  it('parses like shuffle and runs in 3 cycles in the same ports', () => {
    expect(parseInstruction('t[0:7] = permute(a[0:7], b[0:7])').p).toMatchObject({ op: 'permute', L: 8, sources: ['a', 'b'] })
    expect(typeOperations.VFLOAT).toContain('PERMUTE')
    expect(B2.latencies['VFLOAT.PERMUTE']).toBe(3)
    expect(B2.ports['1']).toEqual(expect.arrayContaining(['VINT.SHUFFLE', 'VINT.PERMUTE', 'VFLOAT.PERMUTE']))
    expect(instructionTiming({ type: 'VINT', oper: 'PERMUTE', size: 'word' }, {}, { 'VINT.LOGIC': 2 })).toEqual({ latency: 3, ports: 2 })
  })

  it('is warned with registers of a single 128-bit block (W10)', () => {
    const list = [I('x[0:3] = X[i:i+3]', 'VMEM', 'LOAD', 'word', 'x', 'i', 'X', '', '', 1, 4),
                  I('x[0:3] = permute(x[0:3])', 'VFLOAT', 'PERMUTE', 'single', 'x', 'x', '', '', '', 1, 4),
                  I('if c go back', 'BRANCH', '', '', '', 'c', '', '', '', 4)]
    expect(checkProgram(list).warnings.map(w => w.code)).toContain('W10')
    expect(checkProgram(list, { vlen: 32 }).warnings.map(w => w.code)).not.toContain('W10')
  })
})

describe('assistant: AVX 128-bit blocks or generic model', () => {
  it('asks when a conversion moves data across 128-bit blocks', () => {
    expect(transformLoop(WIDEN, { lanes: 8 }).rearrange.question).toBe(true)
    expect(transformLoop(WIDEN, { lanes: 4 }).rearrange.question).toBe(false)     // 16-byte registers: one block
    expect(transformLoop(SUM_BACK, { lanes: 8 }).rearrange.question).toBe(false)  // reduction: no reversal
  })

  it('AVX: extracts the upper half before widening', () => {
    const r = transformLoop(WIDEN, { lanes: 8, blocks: 'avx', declarations: [{ name: 'X', type: 'FLOAT', size: 'single' }] })
    expect(texts(r).slice(0, 4)).toEqual([
      'x[0:7] = X[i:i+7] | VMEM.LOAD',
      'y_lo[0:3] = double(x[0:3]) | VFLOAT.CVT',
      'x_up[0:3] = permute(x[0:7]) | VFLOAT.PERMUTE',
      'y_hi[0:3] = double(x_up[0:3]) | VFLOAT.CVT',
    ])
    expect(issues(r)).toEqual([])
  })

  it('AVX: inserts the upper half after narrowing', () => {
    const r = transformLoop(NARROW, { lanes: 8, blocks: 'avx' })
    expect(texts(r).slice(2, 6)).toEqual([
      'b[0:3] = single(a_lo[0:3]) | VFLOAT.CVT',
      'b_up[0:3] = single(a_hi[0:3]) | VFLOAT.CVT',
      'b[0:7] = permute(b[0:3], b_up[0:3]) | VFLOAT.PERMUTE',
      'B[i:i+7] = b[0:7] | VMEM.STORE',
    ])
    expect(issues(r)).toEqual([])
  })

  it('generic model: conversions read and write halves directly', () => {
    const r = transformLoop(WIDEN, { lanes: 8, blocks: 'generic' })
    expect(r.program.some(i => i.oper === 'PERMUTE' || i.oper === 'SHUFFLE')).toBe(false)
    expect(issues(r)).toEqual([])
  })

  it('reverses backward vectors combined with forward ones', () => {
    const avx = transformLoop(REVERSE, { lanes: 8, blocks: 'avx' })
    expect(avx.rearrange.question).toBe(true)
    expect(texts(avx).slice(0, 2)).toEqual(['t[0:7] = A[N-8-i:N-1-i] | VMEM.LOAD', 't[0:7] = permute(t[0:7]) | VFLOAT.PERMUTE'])
    expect(issues(avx)).toEqual([])
    const generic = transformLoop(REVERSE, { lanes: 8, blocks: 'generic' })
    expect(texts(generic)[1]).toBe('t[0:7] = shuffle(t[0:7]) | VFLOAT.SHUFFLE')
    // a single 128-bit block: a shuffle also in the AVX model
    expect(texts(transformLoop(REVERSE, { lanes: 4, blocks: 'avx' }))[1]).toBe('t[0:3] = shuffle(t[0:3]) | VFLOAT.SHUFFLE')
  })

  it('reverses the stored vector of a backward store', () => {
    const list = [I('t = A[i]', 'MEM', 'LOAD', 'word', 't', 'i', 'A'),
                  I('B[N-1-i] = t', 'MEM', 'STORE', 'word', '', 't', 'B', 'i', '1', -1), ...control]
    const r = transformLoop(list, { lanes: 8, blocks: 'avx' })
    expect(texts(r).slice(0, 3)).toEqual(['t[0:7] = A[i:i+7] | VMEM.LOAD', 't_rev[0:7] = permute(t[0:7]) | VINT.PERMUTE',
                                          'B[N-8-i:N-1-i] = t_rev[0:7] | VMEM.STORE'])
    expect(issues(r)).toEqual([])
  })

  it('stays coherent when unrolled', () => {
    for (const list of [WIDEN, NARROW, REVERSE])
      for (const blocks of ['avx', 'generic'])
        expect(issues(transformLoop(list, { lanes: 8, unroll: 2, blocks }))).toEqual([])
  })
})

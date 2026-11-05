import { describe, it, expect } from 'vitest'
import { parseInstruction, analyzeProgramText, deriveRowFields } from './instructionText'
import { checkProgram, vectorWidth } from './programChecks'
import { transformLoop } from './loopTransforms'
import { instructionTiming, normalizeLatencyKeys, typeOperations } from './common'
import B1 from '../public/processor/B1.json'

const I = (text, type, oper, size, destin, s1 = '', s2 = '', s3 = '', constant = '', stride = 1, lanes = 1) =>
  ({ text, type, oper, size, destin, source1: s1, source2: s2, source3: s3, constant, stride, lanes })
const control = [I('i = i + 1', 'INT', 'ARITH', 'word', 'i', 'i', '', '', '1'),
                 I('c = i != N', 'INT', 'ARITH', 'word', 'c', 'i', 'N'),
                 I('if c go back', 'BRANCH', '', '', '', 'c')]
// single -> double: x = X[i]; y = double(x); s = s + y
const WIDEN = [I('x = X[i]', 'MEM', 'LOAD', 'word', 'x', 'i', 'X'),
               I('y = double(x)', 'FLOAT', 'CVT', 'double', 'y', 'x'),
               I('s = s + y', 'FLOAT', 'ADD', 'double', 's', 's', 'y'), ...control]
// double -> single: a = A[i]; b = single(a); B[i] = b
const NARROW = [I('a = A[i]', 'MEM', 'LOAD', 'long', 'a', 'i', 'A'),
                I('b = single(a)', 'FLOAT', 'CVT', 'single', 'b', 'a'),
                I('B[i] = b', 'MEM', 'STORE', 'word', '', 'b', 'B', 'i'), ...control]
// int <-> float: f = single(n); m = word(f)
const INTS = [I('n = V[i]', 'MEM', 'LOAD', 'word', 'n', 'i', 'V'),
              I('f = single(n)', 'FLOAT', 'CVT', 'single', 'f', 'n'),
              I('f = f * f', 'FLOAT', 'MUL', 'single', 'f', 'f'),
              I('m = word(f)', 'INT', 'CVT', 'word', 'm', 'f'),
              I('W[i] = m', 'MEM', 'STORE', 'word', '', 'm', 'W', 'i'), ...control]

const issues = (list, vlen) => {
  const a = analyzeProgramText(list), c = checkProgram(list, { vlen })
  return [...c.errors, ...c.warnings, ...a.warnings, ...a.infos].map(w => `${w.code}#${w.index}: ${w.message}`)
}

describe('conversion instructions', () => {
  it('parse as a function call named with the result type', () => {
    expect(parseInstruction('y = double(x)').p).toMatchObject({ op: 'cvt', convert: 'double', dest: 'y', sources: ['x'] })
    expect(parseInstruction('y_lo[0:3] = double(x[4:7])').p).toMatchObject({ op: 'cvt', L: 4, sources: ['x'], merge: false })
    expect(parseInstruction('b[4:7] = single(a_hi[0:3])').p).toMatchObject({ merge: true, sources: ['a_hi', 'b'] })
    expect(parseInstruction('y = double(3)').ok).toBe(false)
  })

  it('give the fields: type of the result, oper CVT, size of the result', () => {
    expect(deriveRowFields(WIDEN, 1)).toMatchObject({ type: 'FLOAT', oper: 'CVT', size: 'double', destin: 'y', source1: 'x' })
    expect(deriveRowFields(INTS, 3)).toMatchObject({ type: 'INT', oper: 'CVT', size: 'word', destin: 'm', source1: 'f' })
  })

  it('separate the data types of source and result', () => {
    for (const list of [WIDEN, NARROW, INTS]) expect(issues(list)).toEqual([])
    const vars = analyzeProgramText(WIDEN).variables
    expect(vars.find(v => v.name === 'X')).toMatchObject({ size: 'word' })
    expect(vars.find(v => v.name === 's')).toMatchObject({ kind: 'FLOAT', size: 'double' })
  })

  it('warn about useless or unavailable conversions', () => {
    const same = [I('x = X[i]', 'MEM', 'LOAD', 'long', 'x', 'i', 'X'), I('y = double(x)', 'FLOAT', 'CVT', 'double', 'y', 'x'),
                  I('s = s + x', 'FLOAT', 'ADD', 'double', 's', 's', 'x'), ...control]
    expect(analyzeProgramText(same).warnings.map(w => w.code)).toEqual(['T6'])
    const intint = [I('n = V[i]', 'MEM', 'LOAD', 'word', 'n', 'i', 'V'), I('m = long(n)', 'INT', 'CVT', 'long', 'm', 'n'),
                    I('k = n << 2', 'INT', 'SHIFT', 'word', 'k', 'n', '', '', '2'), ...control]
    expect(analyzeProgramText(intint).warnings.map(w => w.code)).toEqual(['T6'])
  })
})

describe('vector registers of fixed width', () => {
  it('check lanes × element size against the register width', () => {
    const v = (lanes, size, type = 'VFLOAT') => I('x', type, 'ADD', size, 'x', 'x', '', '', '', 1, lanes)
    expect(vectorWidth([v(4, 'single'), v(4, 'double')])).toBe(32)
    expect(checkProgram([v(4, 'single'), v(4, 'double'), control[2]]).warnings.map(w => w.code)).toContain('W2')
    expect(checkProgram([v(8, 'double'), control[2]], { vlen: 32 }).warnings.map(w => w.code)).toContain('W9')
  })

  it('vectorizing single -> double converts in two halves', () => {
    const r = transformLoop(WIDEN, { lanes: 8 })
    expect(r.vlen).toBe(32)
    expect(r.program.map(i => `${i.text} | ${i.type}.${i.oper} L=${i.lanes}`)).toEqual([
      'x[0:7] = X[i:i+7] | VMEM.LOAD L=8',
      'y_lo[0:3] = double(x[0:3]) | VFLOAT.CVT L=4',
      'y_hi[0:3] = double(x[4:7]) | VFLOAT.CVT L=4',
      's_lo[0:3] = s_lo[0:3] + y_lo[0:3] | VFLOAT.ADD L=4',
      's_hi[0:3] = s_hi[0:3] + y_hi[0:3] | VFLOAT.ADD L=4',
      'i = i + 8 | INT.ARITH L=1',
      'c = i != N | INT.ARITH L=1',
      'if c go back | BRANCH. L=1',
    ])
    expect(r.program.at(-1).stride).toBe(8)
    expect(issues(r.program, r.vlen)).toEqual([])
  })

  it('vectorizing double -> single loads in halves and writes half registers', () => {
    const r = transformLoop(NARROW, { lanes: 8 })
    expect(r.program.slice(0, 5).map(i => `${i.text} | s=${i.stride} c=${i.constant} | ${i.source1},${i.source2}`)).toEqual([
      'a_lo[0:3] = A[i:i+3] | s=2 c= | i,A',
      'a_hi[0:3] = A[i+4:i+7] | s=2 c=4 | i,A',
      'b[0:3] = single(a_lo[0:3]) | s=1 c= | a_lo,',
      'b[4:7] = single(a_hi[0:3]) | s=1 c= | a_hi,b',
      'B[i:i+7] = b[0:7] | s=1 c= | b,B',
    ])
    expect(issues(r.program, r.vlen)).toEqual([])
  })

  it('stays coherent when unrolled after vectorizing', () => {
    for (const list of [WIDEN, NARROW, INTS]) {
      const r = transformLoop(list, { lanes: 8, unroll: 2, splitAccumulators: true })
      expect(issues(r.program, r.vlen)).toEqual([])
    }
  })
})

describe('processor timing', () => {
  it('reads latencies of each size, also with the old keys', () => {
    const lat = normalizeLatencyKeys({ 'FLOAT.DIV': 8, 'FLOAT-DIV-double': 14 })
    expect(lat).toEqual({ 'FLOAT.DIV': 8, 'FLOAT.DIV.double': 14 })
    expect(instructionTiming({ type: 'FLOAT', oper: 'DIV', size: 'double' }, lat).latency).toBe(14)
    expect(instructionTiming({ type: 'FLOAT', oper: 'DIV', size: 'single' }, lat).latency).toBe(8)
  })

  it('has CVT in the distributed processors, and a default for older ones', () => {
    expect(typeOperations.FLOAT).toContain('CVT')
    expect(B1.latencies['FLOAT.CVT']).toBe(3)
    const opToMask = { 'FLOAT.ADD': 2, 'VFLOAT.ADD': 4 }
    expect(instructionTiming({ type: 'INT', oper: 'CVT', size: 'word' }, {}, opToMask)).toEqual({ latency: 3, ports: 2 })
    expect(instructionTiming({ type: 'VFLOAT', oper: 'CVT', size: 'double' }, {}, opToMask)).toEqual({ latency: 3, ports: 4 })
  })
})

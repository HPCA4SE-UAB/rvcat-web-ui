import { describe, it, expect } from 'vitest'
import { parseInstruction, analyzeProgramText, deriveRowFields } from './instructionText'
import { checkProgram } from './programChecks'
import { transformLoop } from './loopTransforms'
import { instructionTiming, typeOperations } from './common'
import B4 from '../public/processor/B4.json'

const I = (text, type, oper, size, destin, s1 = '', s2 = '', s3 = '', constant = '', stride = 1, lanes = 1) =>
  ({ text, type, oper, size, destin, source1: s1, source2: s2, source3: s3, constant, stride, lanes })
// Complex products: (a + bi)·(c + di), pairs re/im interleaved in the vectors
const COMPLEX = [
  I('x[0:7] = X[i:i+7]',                    'VMEM',   'LOAD',    'word',   'x', 'i', 'X', '', '', 1, 8),
  I('y[0:7] = Y[i:i+7]',                    'VMEM',   'LOAD',    'word',   'y', 'i', 'Y', '', '', 1, 8),
  I('p[0:7] = x[0:7] * y[0:7]',             'VFLOAT', 'MUL',     'single', 'p', 'x', 'y', '', '', 1, 8),
  I('t[0:7] = shuffle(y[0:7])',             'VFLOAT', 'SHUFFLE', 'single', 't', 'y', '', '', '', 1, 8),
  I('q[0:7] = x[0:7] * t[0:7]',             'VFLOAT', 'MUL',     'single', 'q', 'x', 't', '', '', 1, 8),
  I('r[0:7] = shuffle(p[0:7], q[0:7])',     'VFLOAT', 'SHUFFLE', 'single', 'r', 'p', 'q', '', '', 1, 8),
  I('Z[i:i+7] = r[0:7]',                    'VMEM',   'STORE',   'word',   '', 'r', 'Z', 'i', '', 1, 8),
  I('i = i + 8', 'INT', 'ARITH', 'word', 'i', 'i', '', '', '8'),
  I('c = i != N', 'INT', 'ARITH', 'word', 'c', 'i', 'N'),
  I('if c go back', 'BRANCH', '', '', '', 'c', '', '', '', 8),
]

describe('shuffle instruction', () => {
  it('parses one or two vector registers', () => {
    expect(parseInstruction('t1[0:3] = shuffle(t2[0:3], t3[0:3])').p).toMatchObject({ op: 'shuffle', L: 4, dest: 't1', sources: ['t2', 't3'] })
    expect(parseInstruction('t1[0:3] = shuffle( t2[0:3] )').p).toMatchObject({ op: 'shuffle', sources: ['t2'] })
    expect(parseInstruction('t1[0:7] = shuffle(a[0:3], b[0:3])').p).toMatchObject({ L: 8, sources: ['a', 'b'] })   // joins two halves
    for (const text of ['t1 = shuffle(t2[0:3], t3[0:3])', 't1[0:3] = shuffle(t2, t3)', 't1[0:3] = shuffle(a[0:3], b[0:3], c[0:3])',
                        't1[0:3] = shuffle(a[0:3], 2)', 'A[i:i+3] = shuffle(a[0:3])'])
      expect({ text, ok: parseInstruction(text).ok }).toEqual({ text, ok: false })
  })

  it('gives the fields: VINT or VFLOAT (type of its data), oper SHUFFLE', () => {
    expect(deriveRowFields(COMPLEX, 5)).toMatchObject({ type: 'VFLOAT', oper: 'SHUFFLE', size: 'single', destin: 'r', source1: 'p', source2: 'q', lanes: 8 })
    const ints = [I('a[0:3] = A[i:i+3]', 'VMEM', 'LOAD', 'word', 'a', 'i', 'A', '', '', 1, 4),
                  I('b[0:3] = a[0:3] << 1', 'VINT', 'SHIFT', 'word', 'b', 'a', '', '', '1', 1, 4),
                  I('s[0:3] = shuffle(a[0:3], b[0:3])', '', '', '', '', '', '', '', '', 1, 1),
                  I('i = i + 4', 'INT', 'ARITH', 'word', 'i', 'i', '', '', '4'), I('if c go back', 'BRANCH', '', '', '', 'c', '', '', '', 4)]
    expect(deriveRowFields(ints, 2)).toMatchObject({ type: 'VINT', oper: 'SHUFFLE', size: 'word', source1: 'a', source2: 'b', lanes: 4 })
  })

  it('keeps the data type of its registers, without warnings', () => {
    const a = analyzeProgramText(COMPLEX), c = checkProgram(COMPLEX)
    expect([...a.warnings, ...a.infos, ...c.errors, ...c.warnings]).toEqual([])
    expect(a.variables.find(v => v.name === 'r')).toMatchObject({ kind: 'FLOAT', size: 'single' })
  })

  it('runs in 1 cycle in the ports of the vector integer ALU', () => {
    expect(typeOperations.VINT).toContain('SHUFFLE')
    expect(typeOperations.VFLOAT).toContain('SHUFFLE')
    expect(typeOperations.INT).not.toContain('SHUFFLE')
    expect(B4.latencies['VFLOAT.SHUFFLE']).toBe(1)
    expect(B4.ports['1']).toContain('VFLOAT.SHUFFLE')
    // processors without SHUFFLE: 1 cycle in the ports of VINT.LOGIC
    expect(instructionTiming({ type: 'VFLOAT', oper: 'SHUFFLE', size: 'single' }, {}, { 'VINT.LOGIC': 6 }))
      .toEqual({ latency: 1, ports: 6 })
  })

  it('is kept by the unroll assistant (the vectorizer refuses an already vectorized loop)', () => {
    const r = transformLoop(COMPLEX, { unroll: 2 })
    expect(r.program.filter(i => i.oper === 'SHUFFLE')).toHaveLength(4)
    const a = analyzeProgramText(r.program)
    expect([...a.warnings, ...a.infos, ...r.checks.warnings]).toEqual([])
    expect(transformLoop(COMPLEX, { lanes: 2 }).errors.join(' ')).toMatch(/already vectorized/)
  })
})

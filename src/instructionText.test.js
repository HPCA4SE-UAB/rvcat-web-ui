import { describe, it, expect } from 'vitest'
import { parseInstruction, analyzeProgramText, deriveRowFields, fillFromText, declarationsFromAnalysis,
         declareVariable, checkDeclarations, shiftIndexText, vectorIndexText } from './instructionText'
import { transformLoop } from './loopTransforms'
import Base     from '../public/program/Base.json'
import BaseSIMD from '../public/program/BaseSIMD.json'
import V1       from '../public/program/V1.json'
import V2       from '../public/program/V2.json'
import example  from '../public/program/example.json'
import f2       from '../public/program/f2.json'
import f2SIMD   from '../public/program/f2-SIMD.json'
import f3       from '../public/program/f3.json'
import f3SIMD   from '../public/program/f3-SIMD.json'
import f4       from '../public/program/f4.json'
import f0       from '../public/program/f0.json'
import f0SIMD   from '../public/program/f0-SIMD.json'
import f0AVX    from '../public/program/f0-AVX.json'
import f2AVX    from '../public/program/f2-AVX.json'
import f3AVX    from '../public/program/f3-AVX.json'
import f4AVX    from '../public/program/f4-AVX.json'
import f1       from '../public/program/f1.json'
import f1B      from '../public/program/f1B.json'

const DISTRIBUTED = { Base, BaseSIMD, V1, V2, example, f2, 'f2-SIMD': f2SIMD, f3, 'f3-SIMD': f3SIMD, f4, f0, 'f0-SIMD': f0SIMD,
                      'f0-AVX': f0AVX, 'f2-AVX': f2AVX, 'f3-AVX': f3AVX, 'f4-AVX': f4AVX, f1, f1B }
const FIELDS = ['type', 'oper', 'size', 'destin', 'source1', 'source2', 'source3']
const branch = (S = 1) => ({ text: 'if c go back', type: 'BRANCH', oper: '', size: '', destin: '', source1: 'c',
                             source2: '', source3: '', constant: '', stride: S, lanes: 1 })
const row = (text, fields = {}) => ({ text, type: '', oper: '', size: '', destin: '', source1: '', source2: '',
                                      source3: '', constant: '', stride: 1, lanes: 1, ...fields })

describe('instruction text parser', () => {
  it('parses the canonical forms', () => {
    expect(parseInstruction('sum = sum + tmp').p).toMatchObject({ kind: 'compute', op: 'add', dest: 'sum', sources: ['sum', 'tmp'] })
    expect(parseInstruction('t3 = t4*t2 + t3').p).toMatchObject({ op: 'fma', sources: ['t4', 't2', 't3'] })
    expect(parseInstruction('t = c + a*b').p).toMatchObject({ op: 'fma', sources: ['a', 'b', 'c'] })
    expect(parseInstruction('x = sqrt(y)').p).toMatchObject({ op: 'sqrt', sources: ['y'] })
    expect(parseInstruction('c = i != N').p).toMatchObject({ op: 'cmp', sources: ['i', 'N'] })
    expect(parseInstruction('i = i + 1').p).toMatchObject({ op: 'add', sources: ['i'], constant: '1' })
    expect(parseInstruction('B[x+1] = t1').p).toMatchObject({ kind: 'store', value: 't1', mem: { array: 'B', v: 'x', b: 1 } })
    expect(parseInstruction('t = A[N-1-i]').p.mem).toMatchObject({ dir: 'backward', size: 'N', v: 'i', a: 1, b: -1 })
    expect(parseInstruction('t = A[2*i+1]').p.mem).toMatchObject({ dir: 'forward', a: 2, b: 1 })
    expect(parseInstruction('t = T[3]').p.mem).toMatchObject({ dir: 'fixed', b: 3 })
    expect(parseInstruction('tmp[0:3] = V[i:i+3]').p).toMatchObject({ kind: 'load', L: 4 })
  })

  it('marks other texts as not analyzed, with a reason', () => {
    for (const text of ['a = b + c + d', 'x = y', 'x = 3', 'A[i] = B[i]', 'x = A[B[i]]', 'x = (a + b)',
                        'x[0:3] = y[0:1] + z[0:3]', 'x = 2 * 3', 'A[i] = x + 1', 'x = a ? b'])
      expect({ text, ...parseInstruction(text) }).toMatchObject({ text, ok: false })
    expect(parseInstruction('a = b + c + d').reason).toMatch(/more than one operation/)
    expect(parseInstruction('   ').empty).toBe(true)
  })
})

describe('text and fields of the distributed programs', () => {
  for (const [name, program] of Object.entries(DISTRIBUTED)) {
    it(`${name}: the text gives exactly the fields`, () => {
      const list = program.instruction_list
      const analysis = analyzeProgramText(list, program.declarations)
      expect(analysis.warnings).toEqual([])
      expect(analysis.infos).toEqual([])
      list.slice(0, -1).forEach((inst, index) => {
        const d = deriveRowFields(list, index, program.declarations)
        for (const f of FIELDS) expect(d[f] ?? inst[f], `${name} #${index} ${f}`).toBe(inst[f] ?? '')
      })
    })
    it(`${name}: declarations are coherent`, () => {
      expect(checkDeclarations(program)).toEqual([])
    })
  }
})

describe('type inference', () => {
  it('propagates the data type to the whole program (also backwards)', () => {
    const list = [row('tmp = V[i]'), row('sum = sum + tmp', { type: 'FLOAT', oper: 'ADD', size: 'double' }),
                  row('i = i + 1'), row('c = i != N'), branch()]
    const d0 = deriveRowFields(list, 0)
    expect(d0).toMatchObject({ type: 'MEM', oper: 'LOAD', size: 'long', destin: 'tmp', source1: 'i', source2: 'V', stride: 1 })
    expect(deriveRowFields(list, 2)).toMatchObject({ type: 'INT', oper: 'ARITH', size: 'word', constant: '1' })
    const vars = analyzeProgramText(list).variables
    expect(vars.find(v => v.name === 'V')).toMatchObject({ role: 'array', kind: 'FLOAT', size: 'double' })
    expect(vars.find(v => v.name === 'i')).toMatchObject({ role: 'index', kind: 'INT', size: 'word', assumed: true })
    expect(vars.find(v => v.name === 'N')).toMatchObject({ readOnly: true })
  })

  it('uses the operations: / and FMA are FLOAT, shifts INT', () => {
    const list = [row('x = a / b'), row('y = x << 2'), branch()]
    list.slice(0, -1).forEach((inst, k) => fillFromText(inst, deriveRowFields(list, k)))
    const a = analyzeProgramText(list)
    expect(a.derived[0].type).toBe('FLOAT')
    expect(a.warnings.map(w => w.code)).toEqual(['T3'])    // x is FLOAT (/) and INT (<<)
  })

  it('reports fields that differ from the text', () => {
    const list = [row('t = V[i+1]', { type: 'MEM', oper: 'LOAD', size: 'word', destin: 't', source1: 'i', source2: 'V' }),
                  row('i = i + 2', { type: 'INT', oper: 'ARITH', size: 'word', destin: 'i', source1: 'i', constant: '2' }),
                  branch(2)]
    const w = analyzeProgramText(list).warnings
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ code: 'T2', index: 0 })
    expect(w[0].message).toMatch(/Constant is \(empty\), the text gives "1"; Stride is "1", the text gives "2"/)
  })

  it('deduces strides from the counter and the lanes', () => {
    const list = [row('t[0:3] = A[N-4-i:N-1-i]'), row('i = i + 4'), branch(4)]
    expect(deriveRowFields(list, 0)).toMatchObject({ type: 'VMEM', lanes: 4, stride: -1, constant: '4', source1: 'i' })
  })
})

describe('autofill and declarations', () => {
  it('fills the fields deduced from the text, overwriting them', () => {
    const list = [row('sum = sum + tmp', { type: 'FLOAT', oper: 'ADD', size: 'single' }),
                  row('tmp = W[i+2]', { type: 'FLOAT', oper: 'MUL', destin: 'x' }), row('i = i + 1'), branch()]
    const changed = fillFromText(list[1], deriveRowFields(list, 1))
    expect(list[1]).toMatchObject({ type: 'MEM', oper: 'LOAD', size: 'word', destin: 'tmp', source1: 'i',
                                    source2: 'W', constant: '2', stride: 1 })
    expect(changed).toContain('type')
  })

  it('saves and rereads declarations', () => {
    const program = { name: 'p', instruction_list: Base.instruction_list }
    const decls = declarationsFromAnalysis(analyzeProgramText(program.instruction_list))
    expect(decls.find(d => d.name === 'V')).toEqual({ name: 'V', role: 'array', type: 'FLOAT', size: 'single' })
    expect(decls.find(d => d.name === 'N')).toEqual({ name: 'N', role: 'read-only', type: 'INT', size: 'word' })
    expect(checkDeclarations({ ...program, declarations: decls })).toEqual([])
    const wrong = decls.map(d => (d.name === 'sum' ? { ...d, type: 'INT', size: 'long' } : d)).concat({ name: 'zz', type: 'INT' })
    const msgs = checkDeclarations({ ...program, declarations: wrong })
    expect(msgs.some(m => /zz is not used/.test(m))).toBe(true)
    expect(msgs.some(m => /declaration of sum/.test(m))).toBe(true)
  })

  it('declaring a variable rewrites the instructions of its class', () => {
    const list = Base.instruction_list
    const { declarations, updates } = declareVariable(list, [], 'tmp', { type: 'FLOAT', size: 'double' })
    expect(declarations.map(d => d.name).sort()).toEqual(['V', 'W', 'sum', 'tmp'])
    expect(updates.find(u => u.index === 0).fields).toEqual({ type: 'MEM', oper: 'LOAD', size: 'long' })
    expect(updates.find(u => u.index === 1).fields).toEqual({ type: 'FLOAT', oper: 'ADD', size: 'double' })
  })
})

describe('index text helpers and the assistant', () => {
  it('shifts and widens indexes', () => {
    expect(shiftIndexText('N-1-i', -1)).toBe('N-2-i')
    expect(shiftIndexText('N-4-i:N-1-i', -4)).toBe('N-8-i:N-5-i')
    expect(shiftIndexText('2*i+1', 2)).toBe('2*i+3')
    expect(vectorIndexText('N-1-i', 4)).toBe('N-4-i:N-1-i')
    expect(vectorIndexText('i+1', 4)).toBe('i+1:i+4')
  })

  it('programs generated by the assistant have coherent texts', () => {
    const backward = [row('t = A[N-1-i]', { type: 'MEM', oper: 'LOAD', size: 'word', destin: 't', source1: 'i', source2: 'A', constant: '1', stride: -1 }),
                      row('s = s + t', { type: 'FLOAT', oper: 'ADD', size: 'single', destin: 's', source1: 's', source2: 't' }),
                      row('i = i + 1', { type: 'INT', oper: 'ARITH', size: 'word', destin: 'i', source1: 'i', constant: '1' }),
                      row('c = i != N', { type: 'INT', oper: 'ARITH', size: 'word', destin: 'c', source1: 'i', source2: 'N' }),
                      branch()]
    for (const program of [Base.instruction_list, backward]) {
      for (const options of [{ lanes: 4, unroll: 1 }, { lanes: 1, unroll: 3 }, { lanes: 4, unroll: 2, splitAccumulators: true }]) {
        const r = transformLoop(program, options)
        const a = analyzeProgramText(r.program)
        expect({ options, issues: [...a.warnings, ...a.infos] }).toEqual({ options, issues: [] })
      }
    }
  })
})

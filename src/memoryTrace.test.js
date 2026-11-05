import { describe, it, expect } from 'vitest'
import { buildTraceView, effectiveN, elementRange, byteRange, traceToText } from './memoryTrace'
import { validateProgram } from './common'

// Trace as returned by Program.get_memory_trace: Base-like loop, N = 10, K = 2,
// plus a vector access A[i+1] (lanes 2, S = 2) and a backward access with offset 1
const TRACE = {
  N: 10, S: 1, iterations: 10, shown: [0, 1, 8, 9],
  arrays: [{ name: 'V', base: 0, elem_size: 4, bytes: 40 }, { name: 'B', base: 40, elem_size: 8, bytes: 88 }],
  accesses: [
    { index: 0, array: 'V', oper: 'LOAD',  size: 4, lanes: 1, stride: 1,  constant: '',  addr: [0, 4, 32, 36],    elem: [0, 1, 8, 9] },
    { index: 2, array: 'V', oper: 'LOAD',  size: 4, lanes: 1, stride: 1,  constant: '1', addr: [4, 8, 36, 40],    elem: [1, 2, 9, 10] },
    { index: 3, array: 'B', oper: 'STORE', size: 8, lanes: 1, stride: -1, constant: '0', addr: [120, 112, 56, 48], elem: [10, 9, 2, 1] },
  ],
}

describe('memory trace view', () => {
  const view = buildTraceView(TRACE)

  it('has one column per memory instruction and one row per shown iteration', () => {
    expect(view.columns.map(c => c.index)).toEqual([0, 2, 3])
    expect(view.rows.map(r => r.k)).toEqual([0, 1, 8, 9])
    expect(view.rows.map(r => r.skipped)).toEqual([0, 0, 6, 0])
  })

  it('computes element and byte ranges', () => {
    const cell = view.rows[2].cells[0]
    expect(elementRange('V', cell)).toBe('V[8]')
    expect(byteRange(cell, false)).toBe('32–35')
    expect(byteRange(cell, true)).toBe('0x0020–0x0023')
    expect(elementRange('A', { first: 4, last: 7 })).toBe('A[4..7]')
  })

  it('flags accesses outside the elements swept by the loop', () => {
    expect(view.rows.map(r => r.cells[0].outside)).toEqual([false, false, false, false])
    expect(view.rows.map(r => r.cells[1].outside)).toEqual([false, false, false, true])   // V[i+1], i = 9
    expect(view.rows.map(r => r.cells[2].outside)).toEqual([true, false, false, false])   // B[N-0]
  })

  it('exports tab-separated text with the omitted iterations', () => {
    const lines = traceToText(view, false).split('\n')
    expect(lines[0]).toBe('iteration\t#0 LOAD V\t#2 LOAD V\t#3 STORE B')
    expect(lines[3]).toBe('… 6 iterations')
    expect(lines[4]).toBe('8\tV[8] 32–35\tV[9] 36–39\tB[2] 56–63')
  })

  it('rounds N down to a multiple of S, as the simulator', () => {
    expect(effectiveN(35, 8)).toBe(32)
    expect(effectiveN(3, 4)).toBe(4)
    expect(effectiveN(100, 1)).toBe(100)
  })
})

describe('program N', () => {
  const program = (N) => ({
    name: 'p', N,
    instruction_list: [{ text: 'if c go back', type: 'BRANCH', oper: '', size: '', stride: 1 }],
  })
  it('is optional, and must be an integer in range when present', () => {
    expect(validateProgram(program(undefined))).toEqual([])
    expect(validateProgram(program(64))).toEqual([])
    expect(validateProgram(program(0))).toHaveLength(1)
    expect(validateProgram(program(2.5))).toHaveLength(1)
  })
})

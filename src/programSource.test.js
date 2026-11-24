import { describe, it, expect } from 'vitest'
import { instrLines, linkedLines, summaryLines, sourceFieldErrors } from './programSource'
import { validateProgram } from './common'

const CODE = 'double my_sum ( double V[], int N ) {\n  double sum = 0;\n  for ( int i = 0; i < N; i++ )\n' +
             '     sum = sum + V[i];\n  return sum;\n}'
const program = (extra = {}) => ({
  name: 'SUM', description: CODE,
  instruction_list: [
    { text: 't0 = V[i]', type: 'MEM', cLine: 4 },
    { text: 'sum = sum + t0', type: 'FLOAT', cLine: 4 },
    { text: 'i = i + 1', type: 'INT', cLine: 3 },
    { text: 'if c go back', type: 'BRANCH', cLine: [3] },
  ],
  ...extra,
})

describe('source code of a program', () => {
  it('reads the lines of an instruction (a number or a list)', () => {
    expect(instrLines({ cLine: 4 })).toEqual([4])
    expect(instrLines({ cLine: [3, 4] })).toEqual([3, 4])
    expect(instrLines({})).toEqual([])
    expect(instrLines({ cLine: 0 })).toEqual([])
  })

  it('collects the lines that the instructions implement, also after each call', () => {
    expect(linkedLines(program({ epilogue: [{ text: 'r = sum', cLine: 5 }] }))).toEqual([3, 4, 5])
  })

  it('summarizes the code with the linked lines, or the first line that is not a comment', () => {
    expect(summaryLines(program()).map(s => s.text)).toEqual(['for ( int i = 0; i < N; i++ )', 'sum = sum + V[i];'])
    expect(summaryLines({ description: '// comment\nfor (;;) x++;', instruction_list: [] }))
      .toEqual([{ line: 2, text: 'for (;;) x++;' }])
    expect(summaryLines({ instruction_list: [] })).toEqual([])
  })

  it('validates sourceNote, compile and cLine', () => {
    expect(sourceFieldErrors(program({ sourceNote: { en: 'a', es: 'b' }, compile: 'gcc -O3' }))).toEqual([])
    expect(sourceFieldErrors(program({ sourceNote: 3 }))).toHaveLength(1)
    expect(sourceFieldErrors(program({ compile: ['gcc'] }))).toHaveLength(1)
    const bad = program()
    bad.instruction_list[0].cLine = 9
    expect(sourceFieldErrors(bad)[0]).toMatch(/Instruction 0: cLine/)
    expect(validateProgram(bad).some(e => /cLine/.test(e))).toBe(true)
  })
})

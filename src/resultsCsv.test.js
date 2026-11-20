import { describe, it, expect } from 'vitest'
import { resultsToCsv, csvField, CSV_COLUMNS, hasAlgOps } from './resultsCsv'

const result = (cycles, stride = 1, extra = {}) => ({
  total_iterations: 100, total_instructions: 700, total_cycles: cycles, ipc: 700 / cycles,
  read_primary_misses: 3, write_primary_misses: 1, read_secondary_misses: 2, write_secondary_misses: 0,
  MM_Reads: 4, MM_Writes: 1,
  context: { program: { name: 'Base, v1', N: 100 * stride, stride },
             processor: { name: 'B4', dispatch: 4, retire: 5, ROBsize: 64, nBlocks: 0, blkSize: 64 },
             simulation: { sched: 'optimal', speculation: 'stall' } },
  ...extra,
})

describe('stored results as CSV', () => {
  it('quotes fields with separators or quotes', () => {
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField(3)).toBe('3')
    expect(csvField(null)).toBe('')
  })

  it('writes a header and one row per result, with the speedup over the reference', () => {
    const csv = resultsToCsv([{ name: 'base', result: result(400) }, { name: 'fast', result: result(200) }], 'base')
    const lines = csv.trimEnd().split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(CSV_COLUMNS.join(','))
    const fast = lines[2].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    const col = (name) => fast[CSV_COLUMNS.indexOf(name)]
    expect(col('Name')).toBe('fast')
    expect(col('Program')).toBe('"Base, v1"')
    expect(col('Cycles/iter')).toBe('2.000')
    expect(col('Speedup')).toBe('2.000')
    expect(col('Primary misses')).toBe('4')
    expect(col('MM transfers')).toBe('5')
    expect(col('Block size')).toBe('')          // no cache
    expect(col('Mispred/iter')).toBe('')        // no branches
  })

  it('leaves the speedup empty without a reference', () => {
    const csv = resultsToCsv([{ name: 'a', result: result(400) }])
    const fields = csv.split('\r\n')[1].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    expect(fields[CSV_COLUMNS.indexOf('Speedup')]).toBe('')
  })

  it('knows when a result has a loop stride > 1', () => {
    expect(hasAlgOps([result(400), result(400, 2)])).toBe(true)
    expect(hasAlgOps([result(400)])).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildResultContext, defaultResultName, resultMemoryColumns, resultContextLines
} from './resultContext'

const process = {
  name: 'Base', iters: 250,
  dispatch: 2, retire: 3, ROBsize: 32, sched: 'optimal',
  nBlocks: 4, blkSize: 8, mPenalty: 12, mIssueTime: 8,
  nFillBuffers: 2, nWriteBuffers: 2, rThru: 1,
  latencies: { INT: 1, 'MEM.LOAD': 4 },
  ports: { 1: ['FLOAT.ADD', 'BRANCH'], 0: ['INT.ARITH', 'INT.LOGIC', 'INT.SHIFT', 'MEM.LOAD'] },
  instruction_list: [{ type: 'INT' }, { type: 'BRANCH', stride: 4 }],
}

describe('buildResultContext', () => {
  it('stores program name, N (= iters x stride) and a copy of the processor', () => {
    const ctx = buildResultContext(process, 'B2')
    expect(ctx.program).toEqual({ name: 'Base', N: 1000, stride: 4 })
    expect(ctx.processor).toMatchObject({ name: 'B2', dispatch: 2, nBlocks: 4, rThru: 1 })
    expect(ctx.processor.latencies).toEqual(process.latencies)
    expect(ctx.processor.ports).not.toBe(process.ports)
  })
})

describe('defaultResultName', () => {
  const ctx = buildResultContext(process, 'B2')
  it('uses Program-Processor-N and makes it unique', () => {
    expect(defaultResultName(ctx, [])).toBe('Base-B2-N1000')
    expect(defaultResultName(ctx, ['Base-B2-N1000', 'Base-B2-N1000 (1)'])).toBe('Base-B2-N1000 (2)')
  })
  it('falls back to "current" without context', () => {
    expect(defaultResultName(undefined, ['current'])).toBe('current (1)')
  })
})

describe('resultMemoryColumns', () => {
  it('shows miss totals and MM reads+writes with usage', () => {
    const cols = resultMemoryColumns({
      read_primary_misses: 120, write_primary_misses: 30,
      read_secondary_misses: 10, write_secondary_misses: 2,
      MM_Reads: 150, MM_Writes: 25, MM_usage_percent: 32.14,
    })
    expect(cols.primary).toBe('150')
    expect(cols.primaryDetail).toBe('LD 120 + ST 30')
    expect(cols.secondary).toBe('12')
    expect(cols.MM).toBe('150+25 (32.1%)')
  })
  it('returns null for missing data', () => {
    expect(resultMemoryColumns({})).toMatchObject({ primary: null, secondary: null, MM: null })
  })
})

describe('resultContextLines', () => {
  it('describes program, processor, cache, latencies and compacted ports', () => {
    const lines = resultContextLines(buildResultContext(process, 'B2'))
    expect(lines[0]).toBe(`Program: Base  ·  N = ${(1000).toLocaleString()} alg opers  ·  loop stride 4 (250 iterations)`)
    expect(lines).toContain('  Cache: 4 blocks × 8 B · Miss penalty 12 · Issue time 8')
    expect(lines.at(-1)).toBe('  Ports: P0 INT.ARITH, INT.LOGIC, INT.SHIFT, MEM.LOAD · P1 BRANCH, FLOAT.ADD')
  })
  it('reports when there is no cache or no context', () => {
    expect(resultContextLines(buildResultContext({ ...process, nBlocks: 0 }, 'B1'))).toContain('  Cache: none')
    expect(resultContextLines(undefined)).toEqual(['No configuration saved for these results.'])
  })
})

import { describe, it, expect } from 'vitest'
import { validateCacheConfig } from './common'

const ok = { nBlocks: 16, blkSize: 64, mPenalty: 12, mIssueTime: 1, nFillBuffers: 16, nWriteBuffers: 16, rThru: 2, nStoreBuffers: 114 }
const vload = [{ type: 'VMEM', oper: 'LOAD', size: 'long', lanes: 4 }]   // 32-byte accesses

describe('cache configuration', () => {
  it('accepts a correct configuration', () => {
    expect(validateCacheConfig(ok)).toEqual({})
  })
  it('checks the limits and integers', () => {
    expect(Object.keys(validateCacheConfig({ ...ok, nBlocks: 33, nFillBuffers: 0, rThru: 1.5 })).sort())
      .toEqual(['nBlocks', 'nFillBuffers', 'rThru'])
  })
  it('limits the store buffer to 1 - 256 entries', () => {
    expect(validateCacheConfig({ ...ok, nStoreBuffers: 300 }).nStoreBuffers.args.max).toBe(256)
    expect(validateCacheConfig({ ...ok, nStoreBuffers: 0 }).nStoreBuffers).toBeTruthy()
  })
  it('requires a penalty not below the issue time', () => {
    expect(validateCacheConfig({ ...ok, mPenalty: 4, mIssueTime: 8 }).mPenalty.args.n).toBe(8)
  })
  it('marks the issue time when it is raised above the penalty', () => {
    const e = validateCacheConfig({ ...ok, mPenalty: 12, mIssueTime: 20 }, [], 'mIssueTime')
    expect(e.mIssueTime.args.n).toBe(12)
    expect(e.mPenalty).toBeUndefined()
  })
  it('requires a block that holds the largest memory access', () => {
    expect(validateCacheConfig({ ...ok, blkSize: 16 }, vload).blkSize.args.sizes).toBe('32, 64, 128')
    expect(validateCacheConfig({ ...ok, blkSize: 32 }, vload)).toEqual({})
  })
  it('ignores the other parameters without a cache', () => {
    expect(validateCacheConfig({ ...ok, nBlocks: 0, mPenalty: 0, blkSize: 3 })).toEqual({})
  })
})

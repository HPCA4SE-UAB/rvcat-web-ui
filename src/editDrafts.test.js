import { describe, expect, it } from 'vitest'
import { processorDraftFrom, programDraftFrom, isEmptyProgramDraft } from './editDrafts'

describe('edit drafts', () => {
  const process = {
    name: 'Base', dispatch: 4, retire: 5, ROBsize: 64, sched: 'greedy', nBlocks: 4, blkSize: 16,
    mPenalty: 12, mIssueTime: 4, rThru: 2, latencies: { INT: 1 }, ports: { 0: ['INT'] },
    instruction_list: [{ text: 'i = i + 1', type: 'INT' }, { text: 'if c go back', type: 'BRANCH' }],
  }

  it('copies the current processor and program', () => {
    expect(processorDraftFrom(process)).toMatchObject({
      dispatch: 4, retire: 5, ROBsize: 64, sched: 'greedy', nBlocks: 4, rThru: 2,
      nFillBuffers: 2, ports: { 0: ['INT'] },
    })
    const program = programDraftFrom(process)
    expect(program.name).toBe('Base')
    expect(program.instruction_list).not.toBe(process.instruction_list)
  })

  it('detects an empty program draft', () => {
    expect(isEmptyProgramDraft(null)).toBe(true)
    expect(isEmptyProgramDraft({ instruction_list: [
      { text: '', type: '' }, { text: 'if c go back', type: 'BRANCH' }] })).toBe(true)
    expect(isEmptyProgramDraft(programDraftFrom(process))).toBe(false)
  })
})

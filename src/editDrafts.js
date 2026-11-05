// Drafts used by the program and processor editors ('programTemp', 'processorTemp').
// When an editor is opened from the header and its draft is empty or untouched,
// it starts from the program/processor currently selected.

// Processor configuration to edit, from the current simulated process
export function processorDraftFrom(process) {
  return {
    name:          'edit',
    sched:         process.sched         || 'optimal',
    dispatch:      process.dispatch      || 1,
    retire:        process.retire        || 1,
    ROBsize:       process.ROBsize       || 20,
    nBlocks:       process.nBlocks       || 0,
    blkSize:       process.blkSize       || 4,
    mPenalty:      process.mPenalty      || 1,
    mIssueTime:    process.mIssueTime    || 1,
    nFillBuffers:  process.nFillBuffers  || 2,
    nWriteBuffers: process.nWriteBuffers || 2,
    rThru:         process.rThru         || 1,
    latencies:     JSON.parse(JSON.stringify(process.latencies ?? {})),
    ports:         JSON.parse(JSON.stringify(process.ports ?? {})),
  }
}

// Program to edit, from the current simulated process
export function programDraftFrom(process) {
  return {
    name:             process.name,
    ...(process.N ? { N: process.N } : {}),
    ...(process.vlen ? { vlen: process.vlen } : {}),
    ...(Array.isArray(process.declarations) ? { declarations: JSON.parse(JSON.stringify(process.declarations)) } : {}),
    instruction_list: JSON.parse(JSON.stringify(process.instruction_list ?? [])),
  }
}

// A program draft is empty when, apart from the loop branch, no instruction has content
export function isEmptyProgramDraft(draft) {
  const list = draft?.instruction_list
  if (!Array.isArray(list)) return true
  return list.every(i => i.type === 'BRANCH' || (!i.type && !i.text?.trim()))
}

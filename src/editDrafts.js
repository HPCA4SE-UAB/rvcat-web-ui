// Drafts used by the program editor ('programTemp'): when the editor is opened from the
// header and its draft is empty or untouched, it starts from the program currently selected.
// The processor is edited in its own panel; processorDraftFrom gives the configuration to save.

// Processor configuration (to save or compare), from the current simulated process
export function processorDraftFrom(process) {
  return {
    name:          'edit',
    bPenalty:      process.bPenalty      ?? 5,
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

// Text that is equal for two processors with the same configuration (whatever the name, the
// order of the keys or the order of the operation types in each port)
export function processorSignature(process) {
  const config = processorDraftFrom(process)
  delete config.name
  const sorted = (obj) => Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]))
  config.latencies = sorted(config.latencies)
  config.ports = Object.fromEntries(Object.keys(config.ports).sort((a, b) => Number(a) - Number(b))
    .map(p => [p, [...(config.ports[p] ?? [])].sort()]))
  return JSON.stringify(sorted(config))
}

// Program to edit, from the current simulated process
export function programDraftFrom(process) {
  return {
    name:             process.name,
    ...(process.N ? { N: process.N } : {}),
    ...(process.vlen ? { vlen: process.vlen } : {}),
    ...(typeof process.description === 'string' ? { description: process.description } : {}),
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

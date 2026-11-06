// Context and formatting of stored simulation results.
// Each stored result = RVCAT results + `context` (program name, N, full processor configuration).
import { typeOperations } from './common.js'
import { loopStride }     from './algOps.js'

const PROCESSOR_FIELDS = [
  'dispatch', 'retire', 'ROBsize', 'bPenalty',
  'nBlocks', 'blkSize', 'mPenalty', 'mIssueTime',
  'nFillBuffers', 'nWriteBuffers', 'rThru'
]

// Snapshot of what was simulated: program name, N, the complete processor configuration and
// the options of the simulation (scheduler, behavior after a mispredicted branch)
export function buildResultContext(process, processorName, settings = {}) {
  const instructions = Array.isArray(process?.instruction_list) ? process.instruction_list : []
  const stride = loopStride(instructions)   // algorithmic operations per loop iteration
  const processor = { name: processorName || '' }
  for (const field of PROCESSOR_FIELDS) processor[field] = process?.[field]
  processor.latencies = structuredClone(process?.latencies ?? {})
  processor.ports     = structuredClone(process?.ports ?? {})
  return {
    program: { name: process?.name || '', N: (process?.iters ?? 0) * stride, stride },
    processor,
    simulation: { sched: settings.sched ?? 'optimal', speculation: settings.speculation ?? 'stall' }
  }
}

// Default name of a stored result: Program-Processor-N<N>, made unique with " (k)"
export function defaultResultName(context, existingNames = []) {
  const base = context
    ? [context.program?.name, context.processor?.name, `N${context.program?.N}`]
        .filter(Boolean).join('-')
    : 'current'
  let name = base
  for (let k = 1; existingNames.includes(name); k++) name = `${base} (${k})`
  return name
}

const sum = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? a + b : null)
const fmt = (n) => n.toLocaleString()

// Values shown in the stored-results table (null when the result has no such data)
export function resultMemoryColumns(r) {
  const primary   = sum(r?.read_primary_misses,   r?.write_primary_misses)
  const secondary = sum(r?.read_secondary_misses, r?.write_secondary_misses)
  const hasMM     = Number.isFinite(r?.MM_Reads) && Number.isFinite(r?.MM_Writes)
  const pct       = Number.isFinite(r?.MM_usage_percent) ? ` (${r.MM_usage_percent.toFixed(1)}%)` : ''
  return {
    primary:          primary   === null ? null : fmt(primary),
    primaryDetail:    primary   === null ? '' : `LD ${fmt(r.read_primary_misses)} + ST ${fmt(r.write_primary_misses)}`,
    secondary:        secondary === null ? null : fmt(secondary),
    secondaryDetail:  secondary === null ? '' : `LD ${fmt(r.read_secondary_misses)} + ST ${fmt(r.write_secondary_misses)}`,
    MM:               hasMM ? `${fmt(r.MM_Reads)}+${fmt(r.MM_Writes)}${pct}` : null,
  }
}

// "INT.ARITH, INT.LOGIC, INT.SHIFT" -> "INT" when a port runs every operation of a type
function compactPortOperations(list) {
  const ops = new Set(list)
  const out = []
  for (const [type, typeOps] of Object.entries(typeOperations)) {
    const full = typeOps.map(op => `${type}.${op}`)
    if (ops.has(type) || (typeOps.length && full.every(o => ops.has(o)))) {
      out.push(type)
      ops.delete(type)
      full.forEach(o => ops.delete(o))
    }
  }
  return [...out, ...ops]
}

// Lines of the hover box over the name of a stored result
export function resultContextLines(context) {
  if (!context?.program || !context?.processor)
    return ['No configuration saved for these results.']
  const { program, processor: p } = context
  const lines = [
    `Program: ${program.name || '?'}  ·  N = ${Number.isFinite(program.N) ? fmt(program.N) : '?'} alg opers` +
      (program.stride > 1 ? `  ·  loop stride ${program.stride} (${fmt(program.N / program.stride)} iterations)` : ''),
    `Processor: ${p.name || '?'}`,
    `  Dispatch ${p.dispatch} · Retire ${p.retire} · ROB ${p.ROBsize}` +
      (Number.isFinite(p.bPenalty) ? ` · Branch penalty ${p.bPenalty}` : ''),
  ]
  // results saved before the scheduler became an option of the simulation keep it in the processor
  const sim = context.simulation ?? (p.sched ? { sched: p.sched } : null)
  if (sim)
    lines.splice(1, 0, `Simulation: scheduler ${sim.sched}` +
      (sim.speculation ? ` · after a misprediction: ${sim.speculation === 'wrong-path' ? 'wrong path executed' : 'dispatch stalls'}` : ''))
  if (p.nBlocks > 0) {
    lines.push(`  Cache: ${p.nBlocks} blocks × ${p.blkSize} B · Miss penalty ${p.mPenalty} · Issue time ${p.mIssueTime}`)
    lines.push(`         Fill buffers ${p.nFillBuffers} · Write buffers ${p.nWriteBuffers} · rThru ${p.rThru}`)
  } else {
    lines.push('  Cache: none')
  }
  const latencies = Object.entries(p.latencies ?? {}).map(([k, v]) => `${k} ${v}`)
  if (latencies.length) lines.push(`  Latencies: ${latencies.join(' · ')}`)
  const ports = Object.entries(p.ports ?? {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([port, list]) => `P${port} ${compactPortOperations(list ?? []).join(', ')}`)
  if (ports.length) lines.push(`  Ports: ${ports.join(' · ')}`)
  return lines
}

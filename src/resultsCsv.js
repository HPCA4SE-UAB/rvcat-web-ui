// Stored simulation results as a CSV file (one row per result), to compare versions in a
// spreadsheet or a report. Numbers are written with a dot as decimal separator and no
// thousands separator; text fields are quoted when needed.
import { resultStride, resultCyclesPerAlgOp, resultInstrPerAlgOp, speedupOver } from './algOps.js'

const sum = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? a + b : null)
const num = (v, digits) => (Number.isFinite(v) ? (digits === undefined ? String(v) : v.toFixed(digits)) : '')

export function csvField(value) {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const CSV_COLUMNS = [
  'Name', 'Program', 'Processor', 'N', 'Calls', 'Iterations', 'Instructions', 'Cycles',
  'Cycles/iter', 'Instr/Alg Oper', 'Cycles/Alg Oper', 'Speedup', 'IPC', 'Mispred/iter',
  'Primary misses', 'Secondary misses', 'MM transfers',
  'Dispatch', 'Retire', 'ROB', 'Cache blocks', 'Block size', 'Scheduler', 'Mispredictions',
]

// rows: [{ name, result }] in the order of the table; referenceName: result used for the speedup
export function resultsToCsv(rows, referenceName = '') {
  const reference = rows.find(r => r.name === referenceName)?.result ?? null
  const lines = [CSV_COLUMNS.join(',')]
  for (const { name, result: r } of rows) {
    const c = r?.context ?? {}
    const cycPerIter = r?.total_cycles > 0 && r?.total_iterations > 0 ? r.total_cycles / r.total_iterations : null
    const speedup = reference ? speedupOver(reference, r) : null
    const values = [
      name, c.program?.name ?? '', c.processor?.name ?? '', c.program?.N ?? '',
      r?.repetitions ?? c.program?.rep ?? 1,
      num(r?.total_iterations), num(r?.total_instructions), num(r?.total_cycles),
      num(cycPerIter, 3), num(resultInstrPerAlgOp(r), 3), num(resultCyclesPerAlgOp(r), 3),
      num(speedup, 3), num(r?.ipc, 3),
      r?.branch ? num(r.branch.mispredictions_per_iteration, 4) : '',
      num(sum(r?.read_primary_misses, r?.write_primary_misses)),
      num(sum(r?.read_secondary_misses, r?.write_secondary_misses)),
      num(sum(r?.MM_Reads, r?.MM_Writes)),
      c.processor?.dispatch ?? '', c.processor?.retire ?? '', c.processor?.ROBsize ?? '',
      c.processor?.nBlocks ?? '', c.processor?.nBlocks > 0 ? (c.processor?.blkSize ?? '') : '',
      c.simulation?.sched ?? '', c.simulation?.speculation ?? '',
    ]
    lines.push(values.map(csvField).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

// The stride is part of the context; exported for the table (columns of algorithmic operations)
export const hasAlgOps = (results) => results.some(r => (resultStride(r) ?? 1) > 1)

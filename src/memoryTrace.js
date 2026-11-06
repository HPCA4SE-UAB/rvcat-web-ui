// Memory trace of the program editor. The addresses are computed by RVCAT
// (Program.get_memory_trace, same model as the simulator); this module only arranges them
// in a table: one row per shown iteration, one column per memory instruction.

export const TRACE_MAX_K = 16

// N used by the simulator: rounded down to a multiple of S (at least S)
export function effectiveN(N, S) {
  const s = Math.max(1, Math.round(Number(S)) || 1)
  const n = Math.max(1, Math.round(Number(N)) || 1)
  return Math.max(s, n - (n % s))
}

export function formatAddress(value, hex) {
  return hex ? '0x' + value.toString(16).toUpperCase().padStart(4, '0') : String(value)
}

// trace: object returned by get_memory_trace.
// Returns { N, S, iterations, arrays, columns, rows }:
//   columns: [{ index, array, oper, lanes, stride, constant, size, length }]
//            length = elements swept by the access over the whole loop (iterations·L·|s|)
//   rows:    [{ k, skipped, cells: [{ first, last, addrFirst, addrLast, outside }] }]
//            skipped = iterations omitted before this row (0 when consecutive)
export function buildTraceView(trace) {
  const columns = (trace?.accesses ?? []).map(a => {
    const lanes = Number(a.lanes) || 1, stride = Number(a.stride) || 0
    return {
      index: a.index, array: a.array, oper: a.oper, lanes, stride,
      constant: a.constant === '' || a.constant === undefined ? 0 : Number(a.constant),
      size: a.size, length: trace.iterations * lanes * Math.abs(stride),
      execProb: Number.isFinite(a.exec_prob) ? a.exec_prob : 1,   // < 1: inside a conditional block
    }
  })
  const shown = trace?.shown ?? []
  const rows = shown.map((k, r) => ({
    k,
    skipped: r > 0 ? k - shown[r - 1] - 1 : 0,
    cells: columns.map((col, c) => {
      const access = trace.accesses[c]
      const first  = access.elem[r], addrFirst = access.addr[r]
      const last   = first + col.lanes - 1
      // Outside the elements swept by the loop (e.g. A[i+1] in the last iteration, or a
      // backward access with offset < lanes). Fixed accesses (stride 0) are not flagged.
      const outside = col.stride !== 0 && (first < 0 || last >= col.length)
      return { first, last, addrFirst, addrLast: addrFirst + col.lanes * col.size - 1, outside }
    }),
  }))
  return { N: trace?.N, S: trace?.S, iterations: trace?.iterations, arrays: trace?.arrays ?? [], columns, rows }
}

export const elementRange = (array, cell) =>
  cell.first === cell.last ? `${array}[${cell.first}]` : `${array}[${cell.first}..${cell.last}]`

export const byteRange = (cell, hex) =>
  `${formatAddress(cell.addrFirst, hex)}–${formatAddress(cell.addrLast, hex)}`

// Tab-separated text (to paste in a spreadsheet or a document)
export function traceToText(view, hex) {
  const header = ['iteration', ...view.columns.map(c => `#${c.index} ${c.oper} ${c.array}`)]
  const lines = [header.join('\t')]
  for (const row of view.rows) {
    if (row.skipped > 0) lines.push(`… ${row.skipped} iterations`)
    lines.push([row.k, ...row.cells.map((cell, c) =>
      `${elementRange(view.columns[c].array, cell)} ${byteRange(cell, hex)}`)].join('\t'))
  }
  return lines.join('\n')
}

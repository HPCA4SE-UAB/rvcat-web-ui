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
// Returns { N, S, iterations, rep, arrays, columns, rows, blocks }:
//   columns: [{ index, array, oper, lanes, stride, constant, size, length, repStride }]
//            length = elements swept by the access over the whole loop (iterations·L·|s|)
//   rows:    [{ rep, k, skipped, callStart, callEnd, cells: [{ first, last, addrFirst, addrLast, outside }] }]
//            rep = call of the loop (0, 1: the 1st and the 2nd calls when the loop is repeated)
//            skipped = iterations omitted before this row, in the same call (0 when consecutive)
//   blocks:  { rep: [{ index, array, oper, cell }] }  accesses of the block after each shown call
function traceCell(first, addrFirst, lanes, size) {
  return { first, last: first + lanes - 1, addrFirst, addrLast: addrFirst + lanes * size - 1 }
}

export function buildTraceView(trace) {
  const columns = (trace?.accesses ?? []).map(a => {
    const lanes = Number(a.lanes) || 1, stride = Number(a.stride) || 0
    return {
      index: a.index, array: a.array, oper: a.oper, lanes, stride,
      constant: a.constant === '' || a.constant === undefined ? 0 : Number(a.constant),
      size: a.size, length: trace.iterations * lanes * Math.abs(stride),
      repStride: Number(a.rep_stride) || 0,                       // elements advanced in each call
      execProb: Number.isFinite(a.exec_prob) ? a.exec_prob : 1,   // < 1: inside a conditional block
    }
  })
  // rows: (call, iteration); traces without calls (older RVCAT) have only the iterations
  const traceRows = trace?.rows ?? (trace?.shown ?? []).map(k => ({ rep: 0, k }))
  const rows = traceRows.map(({ rep, k }, r) => {
    const prev = traceRows[r - 1], next = traceRows[r + 1]
    const callStart = !prev || prev.rep !== rep
    return {
      rep, k, callStart, callEnd: !next || next.rep !== rep,
      skipped: callStart ? k : k - prev.k - 1,
      cells: columns.map((col, c) => {
        const access = trace.accesses[c]
        const cell   = traceCell(access.elem[r], access.addr[r], col.lanes, col.size)
        // Outside the elements swept by the loop in this call (e.g. A[i+1] in the last iteration,
        // or a backward access with offset < lanes). Fixed accesses (stride 0) are not flagged.
        const first = cell.first - rep * col.repStride
        cell.outside = col.stride !== 0 && (first < 0 || first + col.lanes - 1 >= col.length)
        return cell
      }),
    }
  })
  const blocks = {}
  for (const [i, rep] of (trace?.calls ?? [0]).entries()) {
    blocks[rep] = (trace?.epilogue ?? []).map(a => ({
      index: a.index, array: a.array, oper: a.oper,
      cell: traceCell(a.elem[i], a.addr[i], Number(a.lanes) || 1, a.size),
    }))
  }
  return { N: trace?.N, S: trace?.S, iterations: trace?.iterations, rep: trace?.rep ?? 1,
           arrays: trace?.arrays ?? [], columns, rows, blocks }
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
    if (row.callStart && view.rep > 1) lines.push(`call ${row.rep + 1} of ${view.rep}`)
    if (row.skipped > 0) lines.push(`… ${row.skipped} iterations`)
    lines.push([row.k, ...row.cells.map((cell, c) =>
      `${elementRange(view.columns[c].array, cell)} ${byteRange(cell, hex)}`)].join('\t'))
    if (row.callEnd && view.blocks[row.rep]?.length)
      lines.push(['block', ...view.blocks[row.rep].map(b =>
        `#${b.index} ${b.oper} ${elementRange(b.array, b.cell)} ${byteRange(b.cell, hex)}`)].join('\t'))
  }
  return lines.join('\n')
}

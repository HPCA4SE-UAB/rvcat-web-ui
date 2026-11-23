// The critical path of a timeline, from the causes that RVCAT records (option 3.b): from the retire
// of the last instruction, backwards, each cell of the path is explained by the previous cell of its
// own instruction (it was executing, writing, in a step of the pipeline) or by another instruction
// that held it back: then the path jumps to that one, and the jump is a link of a kind.
//
// Kinds of link (from -> to):
//   data      the producer whose result arrived last -> the first E of the consumer
//   port      the instruction that had the port -> the first E of the one that waited (*)
//   block     the primary miss of a block -> a secondary miss (2) of the same block
//   fill      the instruction whose data freed a fill buffer -> the miss admitted then (after f)
//   retire    the previous instruction retires -> the retire of the next one (in order, width)
//   dispatch  the previous instruction is dispatched -> the dispatch of the next one (in order, width)
//   rob       the oldest instruction retires and frees its entry -> the dispatch of a new one
//   sb        the oldest store of the store buffer -> the dispatch of a store (the store buffer was full)
//   branch    a mispredicted branch is resolved -> the dispatch of the right path
//
// Input: the timeline of RVCAT (instructions, wait_details, dispatch_stalls, resource_usage) and the
// row of the last instruction retired. Output: { cells: Map row -> Set of cycles, links: [{ from:
// { row, col }, to: { row, col }, kind }], gaps } (gaps: cycles that no step explains; 0 when the
// path covers the whole time).

const WAITS_MEMORY = '!f2:@'

export function criticalCauses(timeline, targetRow) {
  const rows = timeline?.instructions ?? []
  if (!rows.length || !Number.isInteger(targetRow) || targetRow < 0 || targetRow >= rows.length) return null
  const waits = new Map((timeline.wait_details ?? []).map(d => [`${d.instruction_index}:${d.cycle}`, d]))
  const stalls = new Map((timeline.dispatch_stalls ?? []).map(s => [s.cycle, s]))
  const requests = (timeline.resource_usage?.mm_requests ?? []).filter(q => q.operation !== 'write')

  const start = (r) => rows[r][2]
  const states = (r) => rows[r][4]
  const charAt = (r, col) => states(r)[col - start(r)] ?? ' '
  const colOf = (r, ch, last = false) => {
    const k = last ? states(r).lastIndexOf(ch) : states(r).indexOf(ch)
    return k >= 0 ? start(r) + k : null
  }
  const wrong = (r) => !!rows[r][7]?.wrong
  // the previous row in program order that retires (not a wrong-path one)
  const previousRetired = (r) => { for (let p = r - 1; p >= 0; p--) if (!wrong(p) && colOf(p, 'R') !== null) return p; return null }

  const cells = new Map()
  const links = []
  // the steps of the walk, backwards: { row, col, next } (next: the kind of the link from this cell
  // to the later one; null: the later one is the next cell of the same row)
  const steps = []
  let nextKind = null
  const mark = (r, col) => {
    if (!cells.has(r)) cells.set(r, new Set())
    cells.get(r).add(col)
    steps.push({ row: r, col, next: nextKind })
    nextKind = null
  }
  let gaps = 0
  let row = targetRow, col = colOf(targetRow, 'R')
  if (col === null) return null
  const jump = (kind, r, c) => {
    if (r === null || r === undefined || r < 0 || r >= rows.length || c === null || c === undefined) return false
    if (c > col || (c === col && r >= row)) return false            // (only backwards: it must end)
    links.push({ from: { row: r, col: c }, to: { row, col }, kind })
    nextKind = kind
    if (c < col - 1) gaps += col - 1 - c
    row = r
    col = c
    return true
  }
  const inRow = () => { col -= 1 }                                  // the previous cell of the same row

  for (let guard = 0; guard < 1e6; guard++) {
    mark(row, col)
    const ch = charAt(row, col)
    const prev = charAt(row, col - 1)
    if (ch === 'R') {
      if (prev === '-') {                    // it waited to retire: the previous one (in order, or the width)
        const p = previousRetired(row)
        if (jump('retire', p, p === null ? null : colOf(p, 'R'))) continue
      }
      inRow(); continue
    }
    if (ch === 'D') {
      if (col === 0 && row === 0) break
      const stall = stalls.get(col - 1)
      const p = row - 1
      if (stall && p >= 0 && colOf(p, 'D') !== col) {             // it could not be dispatched before: why
        const b = stall.blocker
        const target = stall.reason === 'rob' ? [b, b === null ? null : colOf(b, 'R')]
                     : stall.reason === 'sb' ? [b, b === null ? null : colOf(b, 'R')]
                     : stall.reason === 'branch' || stall.reason === 'branch-wait' ? [b, b === null ? null : colOf(b, 'W')]
                     : stall.reason === 'width' ? [b, b === null ? null : colOf(b, 'D')]
                     : [p, colOf(p, 'D')]
        const kind = { rob: 'rob', sb: 'sb', branch: 'branch', 'branch-wait': 'branch', width: 'dispatch' }[stall.reason] ?? 'dispatch'
        if (jump(kind, target[0], target[1])) continue
      }
      if (p >= 0 && jump('dispatch', p, colOf(p, 'D'))) continue
      break                                  // the first instruction
    }
    if (ch === 'E' && prev !== 'E') {        // it starts to execute: what it waited for
      if (prev === '.') {                    // data: the producer whose result arrived last
        const d = waits.get(`${row}:${col - 1}`)
        const producers = (d?.dependencies ?? timeline.producers?.[row] ?? []).filter(p => p < rows.length)
        const last = producers.map(p => [p, colOf(p, 'W')]).filter(([, w]) => w !== null).sort((a, b) => b[1] - a[1])[0]
        if (last && jump('data', last[0], last[1] - 1)) continue
      } else if (prev === '*') {             // a port: the one that had it in the last cycle of the wait
        const d = waits.get(`${row}:${col - 1}`)
        const b = (d?.blockers ?? [])[0]
        if (b !== undefined && jump('port', b, col - 1)) continue
      }
      inRow(); continue
    }
    if (ch === '2') {                        // a secondary miss: the primary miss of the block brings it
      const q = requests.find(q => (q.instruction_indices ?? []).includes(row) && q.instruction_index !== row)
      const primary = q?.instruction_index
      if (Number.isInteger(primary) && primary < rows.length && jump('block', primary, colOf(primary, '!', true))) continue
      inRow(); continue
    }
    if (ch === '!' && (prev === '!' || prev === 'f')) {   // admitted after a wait: what let it in
      const q = requests.find(q => q.instruction_index === row && q.admission)
      const freed = q?.admission?.fill_freed
      if (freed && Number.isInteger(freed.instruction_index) && freed.instruction_index < rows.length &&
          jump('fill', freed.instruction_index, freed.cycle)) continue
      inRow(); continue
    }
    if (col <= start(row)) break             // (nothing before: the path cannot go on)
    inRow()
  }
  return { cells, links, gaps, steps }
}

// What the time of the critical path goes to: each cycle that the path advances, from a cell to the
// next one (forwards), is due to the execution of an instruction (its E, and the cycle after the
// result of a producer: a chain of data is the execution of its instructions), to the memory (the
// waits ! 2 : @, a freed fill buffer, the miss of a block), to a port, or to the dispatch, the retire,
// the ROB, the store buffer or a branch. Returns { total, groups: [{ kind, cycles, parts: [{ key, cycles }] }] }
// (parts: by instruction of the program for execution and memory, by port for port), largest first.
const LINK_GROUP = { port: 'port', fill: 'memory', block: 'memory', dispatch: 'dispatch', retire: 'retire',
                     rob: 'rob', sb: 'sb', branch: 'branch' }
export function criticalSummary(timeline, path) {
  const rows = timeline?.instructions ?? []
  const steps = path?.steps ?? []
  const groups = new Map()
  let total = 0
  const add = (kind, key, cycles) => {
    if (!groups.has(kind)) groups.set(kind, { kind, cycles: 0, parts: new Map() })
    const g = groups.get(kind)
    g.cycles += cycles
    g.parts.set(key, (g.parts.get(key) ?? 0) + cycles)
    total += cycles
  }
  for (let i = steps.length - 1; i > 0; i--) {          // forwards: from steps[i] to steps[i - 1]
    const from = steps[i], to = steps[i - 1]
    const cycles = to.col - from.col
    if (cycles <= 0) continue
    const row = rows[to.row]
    const ch = row[4][to.col - row[2]] ?? ' '
    const kind = from.next && from.next !== 'data' ? LINK_GROUP[from.next] ?? 'other'
               : WAITS_MEMORY.includes(ch) ? 'memory'
               : ch === 'R' ? 'retire'
               : ch === 'D' ? 'dispatch'
               : 'execution'
    add(kind, kind === 'port' ? row[3] : kind === 'execution' || kind === 'memory' ? row[1] : '', cycles)
  }
  const list = [...groups.values()].sort((a, b) => b.cycles - a.cycles)
  for (const g of list) g.parts = [...g.parts].map(([key, cycles]) => ({ key, cycles })).sort((a, b) => b.cycles - a.cycles)
  return { total, groups: list }
}

// The critical cells of each row, as offsets from its dispatch (the format of the timeline)
export function criticalOffsets(timeline, path) {
  const rows = timeline?.instructions ?? []
  return rows.map((row, r) => [...(path?.cells.get(r) ?? [])].map(c => c - row[2]).sort((a, b) => a - b))
}

export const MEMORY_WAITS = WAITS_MEMORY

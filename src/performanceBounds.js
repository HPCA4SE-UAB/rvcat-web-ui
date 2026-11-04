// Rows of the "Latency bounds" and "Throughput bounds" tables of the Static Performance
// Analysis panel, from the lists returned by RVCAT's get_performance_analysis
// ("Latency-Bounds" and "Throughput-Bounds").

export const MAX_BOUND_ROWS = 12   // more rows than this: show only the highest bounds

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const portName = (p) => `P${p}`
const instrText = (list, i) => `${i}: ${list[i]?.text ?? ''}`

// Type.Oper of an instruction (the name used by the processor for latencies and ports)
export function instrTypeOper(instr) {
  if (!instr?.type) return ''
  return instr.oper ? `${instr.type}.${instr.oper}` : instr.type
}

// Ports (bit mask) that an instruction can use, as "P1, P2"
export function instrPorts(instr) {
  const mask = Number(instr?.ports ?? 0)
  const ports = []
  for (let p = 0; p < 32; p++) if ((mask >> p) & 1) ports.push(portName(p))
  return ports.join(', ')
}

// Tooltip of an instruction in the throughput table: text, Type.Oper and usable ports
function instrPortsTitle(list, i) {
  const instr = list[i]
  const typeOper = instrTypeOper(instr)
  const ports = instrPorts(instr)
  return `${instrText(list, i)}\n${typeOper || 'type ?'} → ${ports ? 'can use ' + ports : 'no ports'}`
}

// Keep the `max` rows with the highest cycles, in their original order
function keepHighest(rows, max) {
  if (rows.length <= max) return { rows, hidden: 0 }
  const keep = new Set(
    rows.map((row, i) => ({ i, cycles: row.cyclesValue }))
        .sort((a, b) => b.cycles - a.cycles || a.i - b.i)
        .slice(0, max)
        .map(r => r.i)
  )
  return { rows: rows.filter((_, i) => keep.has(i)), hidden: rows.length - max }
}

export function throughputBoundRows(bounds, instructionList = [], max = MAX_BOUND_ROWS) {
  if (!Array.isArray(bounds)) return { rows: [], hidden: 0 }
  const rows = bounds.map(b => {
    const instrs  = b.instructions ?? []
    const isPorts = b.resource === 'Ports'
    const cycles  = Number(b.cycles)
    const resource = isPorts ? b.ports.map(portName).join('+') : b.resource

    const resourceTitle = isPorts
      ? `${b.ports.length > 1 ? 'Ports' : 'Port'} ${resource}: ${plural(b.throughput, 'instruction')} per cycle`
      : `${b.resource} width: ${plural(b.throughput, 'instruction')} per cycle`

    const formula = isPorts
      ? `${plural(instrs.length, 'instruction')} / (${plural(b.throughput, 'port')} × 1 instruction/cycle) = ${cycles.toFixed(2)} cycles/iter`
      : `${plural(instrs.length, 'instruction')} / ${b.throughput} instructions/cycle (${b.resource.toLowerCase()} width) = ${cycles.toFixed(2)} cycles/iter`

    return {
      resource, resourceTitle, formula,
      // Dispatch/retire process every instruction: shown as a range
      allRange:   isPorts ? '' : (instrs.length ? `All (${instrs[0]}–${instrs.at(-1)})` : 'All'),
      included:   isPorts ? instrs.map(i => ({ index: i, title: instrPortsTitle(instructionList, i) })) : [],
      excluded:   (b.excluded ?? []).map(e => ({
        index: e.index,
        title: `${instrPortsTitle(instructionList, e.index)}\nNot counted: it can also use ${e.other_ports.map(portName).join(', ')}`,
      })),
      cycles:      cycles.toFixed(2),
      cyclesValue: cycles,
      bottleneck:  Boolean(b.bottleneck),
    }
  })
  return keepHighest(rows, max)
}

export function latencyBoundRows(bounds, instructionList = [], max = MAX_BOUND_ROWS) {
  if (!Array.isArray(bounds)) return { rows: [], hidden: 0 }
  const rows = bounds.map(b => {
    const chain   = b.instructions ?? []
    const lats    = b.latencies ?? []
    const cycles  = Number(b.cycles)
    const total   = lats.reduce((s, l) => s + l, 0)
    return {
      key:          chain.join(','),   // identifies the chain across re-analyses
      instructions: chain,
      iterations:   b.iterations,
      recurrence: b.variable ? `${b.variable} → ${b.variable}` : '—',
      recurrenceTitle: b.variable
        ? `Each value of ${b.variable} depends on its value ${plural(b.iterations, 'iteration')} before`
        : '',
      chain: chain.map((i, k) => ({
        index: i,
        title: `${instrText(instructionList, i)}\n${instrTypeOper(instructionList[i]) || 'type ?'} → latency ${lats[k]}`,
      })),
      formula: `(${lats.join('+')}) = ${total} cycles / ${plural(b.iterations, 'iteration')} = ${cycles.toFixed(2)} cycles/iter`,
      cycles:      cycles.toFixed(2),
      cyclesValue: cycles,
      bottleneck:  Boolean(b.bottleneck),
    }
  })
  return keepHighest(rows, max)
}

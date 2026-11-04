// Rows of the "Latency bounds" and "Throughput bounds" tables of the Static Performance
// Analysis panel, from the lists returned by RVCAT's get_performance_analysis
// ("Latency-Bounds" and "Throughput-Bounds").

export const MAX_BOUND_ROWS = 12   // more rows than this: show only the highest bounds

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const portName = (p) => `P${p}`
const instrText = (list, i) => `${i}: ${list[i]?.text ?? ''}`

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
      included:   isPorts ? instrs.map(i => ({ index: i, title: instrText(instructionList, i) })) : [],
      excluded:   (b.excluded ?? []).map(e => ({
        index: e.index,
        title: `${instrText(instructionList, e.index)} — can also use ${e.other_ports.map(portName).join(', ')}`,
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
        title: `${instrText(instructionList, i)} (latency ${lats[k]})`,
      })),
      formula: `(${lats.join('+')}) = ${total} cycles / ${plural(b.iterations, 'iteration')} = ${cycles.toFixed(2)} cycles/iter`,
      cycles:      cycles.toFixed(2),
      cyclesValue: cycles,
      bottleneck:  Boolean(b.bottleneck),
    }
  })
  return keepHighest(rows, max)
}

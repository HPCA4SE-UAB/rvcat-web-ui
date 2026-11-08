// Rows of the "Latency bounds" and "Throughput bounds" tables of the Static Performance
// Analysis panel, from the lists returned by RVCAT's get_performance_analysis
// ("Latency-Bounds" and "Throughput-Bounds").

export const MAX_BOUND_ROWS = 12   // more rows than this: show only the highest bounds

import { t } from '@/i18n'

// singular / plural texts in the language of the interface
const WORDS = {
  instruction: ['1 instruction', '{n} instructions'],
  iteration:   ['1 iteration', '{n} iterations'],
  port:        ['1 port', '{n} ports'],
}
const plural = (n, word) => t(n === 1 ? WORDS[word][0] : WORDS[word][1], { n })
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
  return `${instrText(list, i)}\n${typeOper || t('type ?')} → ${ports ? t('can use {ports}', { ports }) : t('no ports')}`
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

// Probability or expected count as a short number: 0.5, 0.25, 0.996, 0.0039, 8.996
const probText = (p) => String(Number(p >= 1 ? p.toFixed(3) : p.toPrecision(3)))

// execProb (programs with conditional branches): probability that each instruction is executed
// in an iteration; conditional instructions count with it ("expected" instructions per iteration)
export function throughputBoundRows(bounds, instructionList = [], max = MAX_BOUND_ROWS, execProb = null) {
  if (!Array.isArray(bounds)) return { rows: [], hidden: 0 }
  const probOf = (i) => (Array.isArray(execProb) && execProb[i] !== undefined ? Number(execProb[i]) : 1)
  const isConditional = (i) => probOf(i) < 1 - 1e-9
  const conditionalNote = (i) => '\n' + t('Conditional: executed with probability {p}, so it counts {p}', { p: probText(probOf(i)) })
  const rows = bounds.map(b => {
    const instrs  = b.instructions ?? []
    const isPorts = b.resource === 'Ports'
    const cycles  = Number(b.cycles)
    const resource = isPorts ? b.ports.map(portName).join('+') : b.resource
    const conditional = instrs.filter(isConditional)
    const expected = Number.isFinite(b.expected) ? b.expected : instrs.reduce((s, i) => s + probOf(i), 0)

    const resourceTitle = isPorts
      ? t(b.ports.length > 1 ? 'Ports {r}: {n} per cycle' : 'Port {r}: {n} per cycle', { r: resource, n: plural(b.throughput, 'instruction') })
      : t('{r} width: {n} per cycle', { r: b.resource, n: plural(b.throughput, 'instruction') })

    // instructions per iteration: with conditional ones, the expected number
    const count = conditional.length
      ? t('{e} instructions (expected: {n} − {s} skipped)', { e: probText(expected), n: instrs.length, s: probText(instrs.length - expected) })
      : plural(instrs.length, 'instruction')
    const formula = isPorts
      ? `${count} / (${plural(b.throughput, 'port')} × ${t('1 instruction/cycle')}) = ${cycles.toFixed(2)} cycles/iter`
      : `${count} / ${b.throughput} ${t('instructions/cycle')} (${t(b.resource === 'Dispatch' ? 'dispatch width' : 'retire width')}) = ${cycles.toFixed(2)} cycles/iter`

    const item = (i) => ({ index: i, title: instrPortsTitle(instructionList, i) + (isConditional(i) ? conditionalNote(i) : ''),
                           prob: isConditional(i) ? probText(probOf(i)) : '' })
    return {
      resource, resourceTitle, formula,
      // Dispatch/retire process every instruction: shown as a range, and its conditional instructions
      allRange:   isPorts ? '' : (instrs.length ? `${t('All')} (${instrs[0]}–${instrs.at(-1)})` : t('All')),
      conditional: isPorts ? [] : conditional.map(item),
      included:   isPorts ? instrs.map(item) : [],
      excluded:   (b.excluded ?? []).map(e => ({
        index: e.index,
        title: `${instrPortsTitle(instructionList, e.index)}\n${t('Not counted: it can also use {ports}', { ports: e.other_ports.map(portName).join(', ') })}`,
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
      variable:     b.variable ?? '',
      instructions: chain,
      iterations:   b.iterations,
      recurrence: b.variable ? `${b.variable} → ${b.variable}` : '—',
      recurrenceTitle: b.variable
        ? t('Each value of {v} depends on its value {n} before', { v: b.variable, n: plural(b.iterations, 'iteration') })
        : '',
      chain: chain.map((i, k) => ({
        index: i,
        title: `${instrText(instructionList, i)}\n${instrTypeOper(instructionList[i]) || t('type ?')} → ${t('latency {n}', { n: lats[k] })}`,
      })),
      formula: `(${lats.join('+')}) = ${total} ${t('cycles')} / ${plural(b.iterations, 'iteration')} = ${cycles.toFixed(2)} cycles/iter`,
      cycles:      cycles.toFixed(2),
      cyclesValue: cycles,
      bottleneck:  Boolean(b.bottleneck),
    }
  })
  return keepHighest(rows, max)
}

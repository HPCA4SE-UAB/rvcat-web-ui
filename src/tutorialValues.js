// Live values in the texts of the tutorial cards: {{name}} is replaced by the current value
// of the simulator, so that the texts follow the program, the processor and the results.
// {{name|d}} forces d decimals. A value that is not available yet is shown as "…".
//
// Names (TUTORIAL_VALUE_NAMES lists them for the tutorial editor):
//   program, processor, N, iterations
//   dispatch, retire, rob, bPenalty, latency.TYPE.OPER (e.g. latency.FLOAT.ADD)
//   instr.K (text of instruction K)
//   Static analysis:  latencyBound, throughputBound, minTime, boundType,
//                     chain.VAR (cycles/iter of the cyclic chain of variable VAR),
//                     resource.NAME (cycles/iter of Dispatch, Retire, P0, P1+P3, ...)
//   Simulation:       cycles, instructions, simIterations, cyclesPerIter, cyclesPerAlgOp, instrPerAlgOp, ipc,
//                     dispatchUsage, retireUsage, port.P (usage % of port P),
//                     critical.K (% of the critical path of instruction K),
//                     patternFrom, patternTo, patternCycles, mispredPerIter

export const TUTORIAL_VALUE_NAMES = [
  'program', 'processor', 'N', 'iterations', 'dispatch', 'retire', 'rob', 'bPenalty', 'latency.TYPE.OPER', 'instr.K',
  'latencyBound', 'throughputBound', 'minTime', 'boundType', 'chain.VAR', 'resource.NAME',
  'cycles', 'instructions', 'simIterations', 'cyclesPerIter', 'cyclesPerAlgOp', 'instrPerAlgOp', 'stride', 'ipc', 'dispatchUsage', 'retireUsage',
  'port.P', 'critical.K', 'patternFrom', 'patternTo', 'patternCycles', 'mispredPerIter',
]

const MISSING = '…'
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const fixed = (v, d) => (num(v) === null ? null : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }))

// Raw value of a name: { value, decimals } (decimals = default format), or null
export function tutorialValue(name, simState, extra = {}) {
  const p = simState?.simulatedProcess ?? {}
  const r = simState?.executionResults ?? null
  const a = simState?.performanceAnalysis ?? null
  const [head, ...rest] = name.split('.')
  const tail = rest.join('.')
  const val = (value, decimals = 0) => (value === null || value === undefined ? null : { value, decimals })

  switch (head) {
    case 'program':    return val(p.name)
    case 'processor':  return val(simState?.processorName)
    case 'N':          return val(num(extra.N ?? (num(p.iters) === null ? null : p.iters * (Number(p.instruction_list?.at(-1)?.stride) || 1))))
    case 'iterations': return val(num(p.iters))
    case 'dispatch':   return val(num(p.dispatch))
    case 'retire':     return val(num(p.retire))
    case 'rob':        return val(num(p.ROBsize))
    case 'bPenalty':   return val(num(p.bPenalty))
    case 'latency': {
      const lat = p.latencies ?? {}
      return val(num(lat[tail] ?? lat[tail.split('.')[0]]))
    }
    case 'instr':      return val(p.instruction_list?.[Number(tail)]?.text)

    case 'latencyBound':    return val(num(a?.LatencyTime), 2)
    case 'throughputBound': return val(num(a?.ThroughputTime), 2)
    case 'minTime':         return val(num(a?.BestTime), 2)
    case 'boundType':       return val(a?.['performance-bound']?.toLowerCase().replace('+', ' and '))
    case 'chain': {
      const chain = (a?.['Latency-Bounds'] ?? []).find(c => c.variable === tail)
      return val(num(chain?.cycles), 2)
    }
    case 'resource': {
      const b = (a?.['Throughput-Bounds'] ?? []).find(b =>
        (b.resource === 'Ports' ? b.ports.map(x => `P${x}`).join('+') : b.resource) === tail)
      return val(num(b?.cycles), 2)
    }

    case 'cycles':         return val(num(r?.total_cycles))
    case 'instructions':   return val(num(r?.total_instructions))
    case 'simIterations':  return val(num(r?.total_iterations))
    case 'cyclesPerIter':  return val(num(r?.cycles_per_iteration), 2)
    case 'cyclesPerAlgOp': return val(num(r?.cycles_per_iteration) === null ? null
      : r.cycles_per_iteration / (Number(p.instruction_list?.at(-1)?.stride) || 1), 2)
    case 'instrPerAlgOp':  return val(num(r?.total_instructions) === null || !num(r?.total_iterations) ? null
      : r.total_instructions / (r.total_iterations * (Number(p.instruction_list?.at(-1)?.stride) || 1)), 2)
    case 'stride':         return val(Number(p.instruction_list?.at(-1)?.stride) || 1)
    case 'ipc':            return val(num(r?.ipc), 3)
    case 'dispatchUsage':  return val(r && p.dispatch ? 100 * r.ipc / p.dispatch : null, 1)
    case 'retireUsage':    return val(r && p.retire ? 100 * r.ipc / p.retire : null, 1)
    case 'port':           return val(num(r?.ports?.[tail.replace(/^P/, '')]), 0)
    case 'critical':       return val(num(r?.critical_path?.instructions?.[Number(tail)]?.percentage), 0)
    case 'patternFrom':    return val(num(r?.critical_path?.repeating_pattern?.start_iteration))
    case 'patternTo':      return val(num(r?.critical_path?.repeating_pattern?.end_iteration))
    case 'patternCycles':  return val(num(r?.critical_path?.repeating_pattern?.cycles_per_iteration))
    case 'mispredPerIter': return val(num(r?.branch?.mispredictions_per_iteration), 3)
    default:               return null
  }
}

// Text of a card with its {{name}} / {{name|d}} replaced
export function renderTutorialText(text, simState, extra = {}) {
  if (typeof text !== 'string' || !text.includes('{{')) return text
  return text.replace(/\{\{\s*([\w.+]+)\s*(?:\|\s*(\d+)\s*)?\}\}/g, (_, name, digits) => {
    const v = tutorialValue(name, simState, extra)
    if (!v) return MISSING
    if (typeof v.value === 'number') return fixed(v.value, digits !== undefined ? Number(digits) : v.decimals) ?? MISSING
    return String(v.value)
  })
}

// Number given by a value or a live value ("{{minTime}}"), for numeric questions
export function tutorialNumber(spec, simState, extra = {}) {
  if (typeof spec === 'number') return spec
  const m = /^\s*\{\{\s*([\w.+]+)\s*\}\}\s*$/.exec(String(spec ?? ''))
  if (m) {
    const v = tutorialValue(m[1], simState, extra)
    return v && typeof v.value === 'number' ? v.value : null
  }
  return num(spec)
}

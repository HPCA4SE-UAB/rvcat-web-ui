// Short description (10 to 25 words) of an instruction of the simulated program, from the data of
// the simulator: memory access and stride, operation and operands, latency and ports, branches.
import { isConditionalBranch, skipCount } from './branches.js'

const portsText = (mask) => {
  const ports = []
  for (let p = 0; p < 32; p++) if ((Number(mask) >> p) & 1) ports.push(`P${p}`)
  return ports.join(', ')
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

export function instructionSummary(list, index) {
  const inst = list?.[index]
  if (!inst) return ''
  const lat   = Number.isFinite(inst.latency) ? inst.latency : null
  const ports = portsText(inst.ports)
  const exec  = lat === null ? '' : ` Latency ${plural(lat, 'cycle')}${ports ? `, ${ports}` : ''}.`
  const L     = Number(inst.lanes) || 1

  if (inst.type === 'BRANCH') {
    if (index === list.length - 1) {
      const S = Number(inst.stride) || 1
      return `Loop branch: repeats the body while ${inst.source1 || 'c'} is true; ` +
             `${plural(S, 'algorithmic operation')} per iteration.${exec}`
    }
    if (isConditionalBranch(list, index)) {
      const m = inst.mispredict ?? ''
      return `Conditional branch on ${inst.source1 || '?'}: skips the next ${plural(skipCount(inst) || 1, 'instruction')} ` +
             `with probability ${inst.prob ?? 0.5}; mispredicted ${m === '' ? 'as a 2-bit predictor says' : `at rate ${m}`}.${exec}`
    }
  }

  if (inst.type === 'MEM' || inst.type === 'VMEM') {
    const s = Number(inst.stride) || 0
    const c = Number(String(inst.constant ?? '').trim() || 0)
    const what  = L > 1 ? `${L} ${inst.size}s` : `one ${inst.size}`
    const array = inst.source2 || '?'
    const where = s === 0 ? `element ${c} (fixed address)`
                : s < 0   ? `element N−${c} backward`
                :           `element ${c}`
    const step  = s === 0 ? '' : `, advancing ${plural(L * Math.abs(s), 'element')} per iteration`
    const mask  = inst.mask ? `, only lanes where ${inst.mask} is true` : ''
    const verb  = inst.oper === 'STORE' ? `Stores ${inst.source1 || '?'} (${what}) into ${array}`
                                        : `Loads ${what} of ${array} into ${inst.destin || '?'}`
    return `${verb} from ${where}${step}${mask}.${exec}`
  }

  const sources = [inst.source1, inst.source2, inst.source3].filter(Boolean)
  const operands = [...sources, ...(String(inst.constant ?? '').trim() ? [String(inst.constant).trim()] : [])]
  return `${inst.type}.${inst.oper}${inst.size ? ` ${inst.size}` : ''}${L > 1 ? ` on ${L} lanes` : ''}: ` +
         `${inst.destin || '?'} ← ${operands.join(', ') || '—'}.${exec}`
}

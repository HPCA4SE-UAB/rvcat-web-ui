// Short description (10 to 25 words) of an instruction of the simulated program, from the data of
// the simulator: memory access and stride, operation and operands, latency and ports, branches.
import { isConditionalBranch, skipCount } from './branches.js'
import { t } from '@/i18n'

const portsText = (mask) => {
  const ports = []
  for (let p = 0; p < 32; p++) if ((Number(mask) >> p) & 1) ports.push(`P${p}`)
  return ports.join(', ')
}
// singular / plural texts: "{n} cycles"
const pl = (n, one, many) => t(n === 1 ? one : many, { n })

export function instructionSummary(list, index) {
  const inst = list?.[index]
  if (!inst) return ''
  const lat   = Number.isFinite(inst.latency) ? inst.latency : null
  const ports = portsText(inst.ports)
  const exec  = lat === null ? '' : ' ' + t('Latency {cycles}', { cycles: pl(lat, '1 cycle', '{n} cycles') }) + `${ports ? `, ${ports}` : ''}.`
  const L     = Number(inst.lanes) || 1

  if (inst.type === 'BRANCH') {
    if (index === list.length - 1) {
      const S = Number(inst.stride) || 1
      return t('Loop branch: repeats the body while {c} is true; {ops} per iteration.',
               { c: inst.source1 || 'c', ops: pl(S, '1 algorithmic operation', '{n} algorithmic operations') }) + exec
    }
    if (isConditionalBranch(list, index)) {
      const m = inst.mispredict ?? ''
      const k = skipCount(inst) || 1
      return t('Conditional branch on {c}: skips the next {k} with probability {p};',
               { c: inst.source1 || '?', k: pl(k, '1 instruction', '{n} instructions'), p: inst.prob ?? 0.5 }) + ' ' +
             (m === '' ? t('mispredicted as a 2-bit predictor says.') : t('mispredicted at rate {m}.', { m })) + exec
    }
  }

  if (inst.type === 'MEM' || inst.type === 'VMEM') {
    const s = Number(inst.stride) || 0
    const c = Number(String(inst.constant ?? '').trim() || 0)
    const what  = L > 1 ? t('{n} {size}s', { n: L, size: inst.size }) : t('one {size}', { size: inst.size })
    const array = inst.source2 || '?'
    const where = s === 0 ? t('element {c} (fixed address)', { c })
                : s < 0   ? t('element N−{c} backward', { c })
                :           t('element {c}', { c })
    const step  = s === 0 ? '' : ', ' + t('advancing {elements} per iteration',
                                         { elements: pl(L * Math.abs(s), '1 element', '{n} elements') })
    const mask  = inst.mask ? ', ' + t('only lanes where {m} is true', { m: inst.mask }) : ''
    const verb  = inst.oper === 'STORE'
      ? t('Stores {v} ({what}) into {array}', { v: inst.source1 || '?', what, array })
      : t('Loads {what} of {array} into {v}', { what, array, v: inst.destin || '?' })
    return `${verb} ${t('from')} ${where}${step}${mask}.${exec}`
  }

  const sources = [inst.source1, inst.source2, inst.source3].filter(Boolean)
  const operands = [...sources, ...(String(inst.constant ?? '').trim() ? [String(inst.constant).trim()] : [])]
  return `${inst.type}.${inst.oper}${inst.size ? ` ${inst.size}` : ''}${L > 1 ? ' ' + t('on {n} lanes', { n: L }) : ''}: ` +
         `${inst.destin || '?'} ← ${operands.join(', ') || '—'}.${exec}`
}

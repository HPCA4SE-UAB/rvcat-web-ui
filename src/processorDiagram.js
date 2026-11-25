// Data of the diagram of the processor (ProcessorDiagram.vue): what each box shows.
import { typeOperations } from '@/common'

// Short names of the types and the operations, to fit the box of a port
export const TYPE_SHORT = { INT: 'INT', FLOAT: 'FP', VINT: 'VINT', VFLOAT: 'VFP', MEM: 'MEM', VMEM: 'VMEM', BRANCH: 'BR' }
export const OP_SHORT = {
  ARITH: '+', LOGIC: '&', SHIFT: '<<', CVT: 'cvt', ADD: '+', MUL: '×', FMA: 'fma', DIV: '÷', SQRT: '√',
  CMP: 'cmp', SHUFFLE: 'shf', PERMUTE: 'prm', LOAD: 'LD', STORE: 'ST',
}
const TYPE_ORDER = ['INT', 'FLOAT', 'VINT', 'VFLOAT', 'MEM', 'VMEM', 'BRANCH']

// The operation types of a port, one line per type: { type, label, ops (null: all of them), title }
// ("INT" in the list stands for all the operations of INT)
export function portTypeLines(entries = []) {
  const byType = new Map()
  for (const entry of entries) {
    const [type, op] = String(entry).split('.')
    if (!byType.has(type)) byType.set(type, new Set())
    const all = typeOperations[type] ?? []
    if (!op) all.forEach(o => byType.get(type).add(o))
    else byType.get(type).add(op)
    if (!op && !all.length) byType.get(type).add('*')
  }
  const lines = []
  for (const type of [...byType.keys()].sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b))) {
    const all = typeOperations[type] ?? []
    const ops = [...byType.get(type)].filter(o => o !== '*')
    const whole = !all.length || all.every(o => ops.includes(o))
    const short = TYPE_SHORT[type] ?? type
    const ordered = all.filter(o => ops.includes(o))
    lines.push({
      type,
      label: whole ? short : `${short} ${ordered.map(o => OP_SHORT[o] ?? o.toLowerCase()).join(' ')}`,
      ops: whole ? null : ordered,
      title: whole ? type : ordered.map(o => `${type}.${o}`).join(', '),
    })
  }
  return lines
}

// Ports that execute memory instructions (LOAD or STORE): they are joined to the memory
export function memoryPorts(ports = {}) {
  return Object.keys(ports).filter(p => (ports[p] ?? []).some(e => /^V?MEM(\.|$)/.test(String(e))))
}

// Colours of the types (as the operation types of the old table)
export const TYPE_COLOR = { INT: '#d6e4ff', FLOAT: '#fff2b3', VINT: '#e6e4ff', VFLOAT: '#eff2b3', MEM: '#d6ffd6', VMEM: '#e6ffd6', BRANCH: '#ffd6d6' }

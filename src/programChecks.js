import { skipCount, fraction } from './branches.js'

// Coherence rules of an edited program: loop stride, vector lanes, memory strides and offsets.
// Documented in docs/program-editor-rules.md (rule codes E1..E4, W1..W7).
//
// Memory model of RVCAT, for a MEM/VMEM instruction with lanes L, stride s and constant c,
// in loop iteration k (0, 1, ... N/S - 1), it accesses the elements
//     s > 0:  c + k·L·s  ... + L-1        (forward, from the start of the array)
//     s < 0:  N - c + k·L·s ... + L-1     (backward, from the end of the array)
//     s = 0:  c ... c + L-1               (same elements in every iteration)
// The loop stride S (BRANCH stride) is the number of algorithmic operations per iteration.

export const VECTOR_TYPES = ['VINT', 'VMEM', 'VFLOAT']
export const MEMORY_TYPES = ['MEM', 'VMEM']

const isVector = (instr) => VECTOR_TYPES.includes(instr?.type)
const isMemory = (instr) => MEMORY_TYPES.includes(instr?.type)
const intOf    = (value, fallback) => {
  const n = Number(value)
  return value === '' || value === undefined || value === null || !Number.isFinite(n) ? fallback : n
}
const constantOf = (instr) => intOf(String(instr?.constant ?? '').trim(), 0)
const SIZE_BYTES = { byte: 1, word: 4, long: 8, single: 4, double: 8 }
export const VECTOR_WIDTHS = [8, 16, 32, 64]

// Bytes of one element of an instruction (its size). A conversion also handles the elements of
// its source, so it counts the larger of both sizes (the source size is the one of the last
// instruction that writes the source variable).
export function elementBytes(instr, list = []) {
  const own = SIZE_BYTES[instr?.size] ?? null
  if (instr?.oper !== 'CVT' || !own) return own
  const writer = [...list].reverse().find(i => i !== instr && i?.destin && i.destin === instr.source1)
  const src = SIZE_BYTES[writer?.size] ?? null
  return src ? Math.max(own, src) : own
}

// Width in bytes of the vector registers: the one given for the program, or else the largest
// vector instruction (lanes × element bytes). null when there are no vector instructions.
export function vectorWidth(instructionList, vlen) {
  if (Number.isInteger(vlen) && vlen > 0) return vlen
  const sizes = (instructionList ?? []).filter(isVector)
    .map(i => intOf(i.lanes, 1) * (elementBytes(i, instructionList) ?? 0)).filter(b => b > 0)
  return sizes.length ? Math.max(...sizes) : null
}

// Structural normalization applied by the editor (it makes rules E2/E3 hold by construction):
// only memory instructions and the BRANCH have a stride; only vector instructions have lanes.
export function enforceStructure(instr) {
  if (!instr) return instr
  if (!isMemory(instr) && instr.type !== 'BRANCH') instr.stride = 1
  if (!isVector(instr)) instr.lanes = 1
  else if (!(Number(instr.lanes) >= 2)) instr.lanes = 4
  return instr
}

// Returns { errors: [...], warnings: [...] }, each item { code, index (or -1), message }.
// Errors make the program incoherent for RVCAT; warnings are probably mistakes, but some
// algorithms need them (stencils, strided accesses...), so they do not block the program.
export function checkProgram(instructionList, { vlen = null } = {}) {
  const list = Array.isArray(instructionList) ? instructionList : []
  const errors = [], warnings = []
  const err  = (code, index, message) => errors.push({ code, index, message })
  const warn = (code, index, message) => warnings.push({ code, index, message })

  const branch = list.at(-1)
  const S = intOf(branch?.stride, 1)

  // E1: loop stride
  if (!Number.isInteger(S) || S < 1)
    err('E1', list.length - 1, `The loop stride S must be an integer ≥ 1 (it is ${branch?.stride}).`)

  list.forEach((instr, index) => {
    if (!instr?.type || instr.type === 'BRANCH') return
    const L = intOf(instr.lanes, 1), s = intOf(instr.stride, 1)
    // E2: lanes
    if (isVector(instr) && (!Number.isInteger(L) || L < 2))
      err('E2', index, `${instr.type} is a vector instruction: lanes must be an integer ≥ 2.`)
    if (!isVector(instr) && L !== 1)
      err('E2', index, `${instr.type} is a scalar instruction: lanes must be 1.`)
    // E3: stride only for memory instructions
    if (!isMemory(instr) && s !== 1)
      err('E3', index, `Only memory instructions (and the BRANCH) have a stride.`)
    if (!isMemory(instr)) return
    // E4: integer stride/offset, not before the start of the array
    const c = constantOf(instr)
    if (!Number.isInteger(s)) err('E4', index, 'The memory stride must be an integer.')
    if (!Number.isInteger(c)) err('E4', index, 'The memory offset (constant) must be an integer.')
    else if (s >= 0 && c < 0)
      err('E4', index, `Offset ${c} with stride ${s} ≥ 0 accesses elements before the start of array ` +
                       `"${instr.source2}". RVCAT arrays start at element 0.`)
  })
  // E5: conditional branches "if c skip k" (a BRANCH that is not the last instruction)
  list.forEach((instr, index) => {
    if (instr?.type !== 'BRANCH' || index === list.length - 1) return
    const k = skipCount(instr)
    if (!Number.isInteger(k) || k < 1 || index + k > list.length - 2)
      err('E5', index, `A conditional branch skips k ≥ 1 of the next instructions (Constant), without skipping the loop branch: ` +
                       `at most ${list.length - 2 - index} here.`)
    if (!instr.source1)
      err('E5', index, 'A conditional branch reads its condition in Source1.')
    for (const [field, what] of [['prob', 'probability of being taken'], ['mispredict', 'misprediction rate']]) {
      const v = instr[field]
      if (v !== undefined && v !== null && String(v).trim() !== '' && fraction(v) === null)
        err('E5', index, `The ${what} of a conditional branch is a number between 0 and 1.`)
    }
  })

  if (errors.some(e => e.code === 'E1')) return { errors, warnings }

  // W1: lanes and loop stride · W2, W9: lanes × element size and the vector register width
  const vectors = list.map((instr, index) => ({ instr, index })).filter(v => isVector(v.instr))
  const laneSet = [...new Set(vectors.map(v => intOf(v.instr.lanes, 1)))]
  const W = vectorWidth(list, vlen)
  for (const { instr, index } of vectors) {
    const L = intOf(instr.lanes, 1), d = elementBytes(instr, list)
    if (!W || !d || !Number.isInteger(L)) continue
    const what = `${L} lanes × ${d} bytes = ${L * d} bytes`
    // data moves and memory accesses may use parts of registers (e.g. movhps, cvtps2pd from 8 bytes)
    if (L * d < W && (instr.oper === 'SHUFFLE' || instr.oper === 'PERMUTE' || isMemory(instr))) continue
    if (L * d > W)
      warn('W9', index, `${what} do not fit in a ${W}-byte vector register: use ${Math.max(1, W / d)} lanes, ` +
                        `or split the instruction into parts${instr.oper === 'CVT' ? ' (a conversion that doubles the size is done in two halves)' : ''}.`)
    else if (L * d < W)
      warn('W2', index, `${what}: it uses only part of the ${W}-byte vector registers ` +
                        `(${W / d} lanes of ${d} bytes fill them).`)
  }
  for (const L of laneSet) {
    if (L >= 2 && S % L !== 0)
      warn('W1', list.length - 1,
           `Vector instructions with ${L} lanes, but the loop stride S = ${S} is not a multiple of ${L}: ` +
           `if each iteration processes ${L}×U elements (U = unrolling factor), S should be ${L}×U.`)
  }

  // W10: PERMUTE moves elements across 128-bit blocks, which exist only in registers > 16 bytes
  if (W && W <= 16)
    vectors.filter(v => v.instr.oper === 'PERMUTE').forEach(v =>
      warn('W10', v.index, `With vector registers of ${W} bytes there is a single 128-bit block: ` +
                           'a SHUFFLE moves the same elements, in less time than a PERMUTE.'))

  // W3..W6: memory accesses
  const groups = new Map()   // same array, same operation, lanes and stride
  list.forEach((instr, index) => {
    if (!isMemory(instr) || !instr.source2) return
    const L = intOf(instr.lanes, 1), s = intOf(instr.stride, 1), c = constantOf(instr)
    if (!Number.isInteger(L) || !Number.isInteger(s) || !Number.isInteger(c)) return
    const step = L * Math.abs(s)   // elements advanced per loop iteration

    // W3: elements per iteration vs algorithmic operations per iteration
    if (s !== 0 && step % S !== 0)
      warn('W3', index,
           `Advances ${step} element${step === 1 ? '' : 's'} of "${instr.source2}" per iteration (lanes ${L} × stride ${Math.abs(s)}), ` +
           `but each iteration does S = ${S} algorithmic operations: expected a multiple of ${S} ` +
           `(usually ${S}: one element per algorithmic operation, stride = S / lanes${S % L === 0 ? ` = ${S / L}` : ''}).`)
    // W7: backward accesses start at element N - c
    if (s < 0 && c < L)
      warn('W7', index,
           `Backward access (stride ${s}): the first access reads elements N-${c} … N-${c}+${L - 1}; ` +
           `the offset should be ≥ ${L} to stay inside an array of N elements (e.g. ${L} for A[N-${L}…N-1]).`)

    const key = `${instr.source2}|${instr.oper}|${L}|${s}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ index, c, L, s, step })
  })

  for (const group of groups.values()) {
    const { L, s, step } = group[0]
    // W4 (duplicated) and W5 (overlapping) accesses of unrolled copies
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j]
        if (a.c === b.c)
          warn('W4', b.index, `Same access as instruction ${a.index} (array "${list[b.index].source2}", offset ${b.c}): ` +
                              'an unrolled copy usually needs a different offset (constant).')
        else if (Math.abs(a.c - b.c) < L)
          warn('W5', b.index, `Its ${L} elements overlap those of instruction ${a.index} (offsets ${a.c} and ${b.c}): ` +
                              `copies of a vector access usually differ by a multiple of ${L}.`)
      }
    }
    // W6: unrolled copies do not cover all the elements advanced per iteration (counting all the
    // accesses to the array with the same operation and step, whatever their lanes)
    if (S > 1 && s !== 0 && step % S === 0) {
      const covered = new Set()
      const array = list[group[0].index].source2, oper = list[group[0].index].oper
      const sameStep = [...groups.values()].flat().filter(g => g.step === step && Math.sign(g.s) === Math.sign(s) &&
                         list[g.index].source2 === array && list[g.index].oper === oper)
      for (const g of sameStep) for (let e = 0; e < g.L; e++) covered.add((((g.c + e) % step) + step) % step)
      const perAlgOp = step / S
      if (perAlgOp === 1 && covered.size < step) {
        const missing = [...Array(step).keys()].filter(e => !covered.has(e))
        warn('W6', group[0].index,
             `Array "${list[group[0].index].source2}" (${list[group[0].index].oper}): each iteration advances ${step} elements, ` +
             `but only ${covered.size} are accessed (missing offset${missing.length > 1 ? 's' : ''} ${missing.slice(0, 6).join(', ')}` +
             `${missing.length > 6 ? '…' : ''}). Is an unrolled copy missing?`)
      }
    }
  }

  // W8: loop counter "i = i + k" (an INT instruction that increments a memory index; k is in the
  // constant field, or else in the text)
  list.forEach((instr, index) => {
    if (instr?.type !== 'INT' || !instr.destin || instr.destin !== instr.source1) return
    const counterUsed = list.some(other => isMemory(other) &&
      (other.oper === 'STORE' ? other.source3 : other.source1) === instr.destin)
    if (!counterUsed) return
    const m = /^\s*(\w+)\s*=\s*\1\s*\+\s*(\d+)\s*$/.exec(instr.text ?? '')
    const k = intOf(String(instr.constant ?? '').trim(), m ? Number(m[2]) : NaN)
    if (Number.isInteger(k) && k !== S)
      warn('W8', index, `"${(instr.text ?? '').trim()}" increments the index ${instr.destin} by ${k}, but the loop stride is S = ${S}: ` +
                        `the index usually advances S elements per iteration.`)
  })

  return { errors, warnings }
}

// Unroll / vectorize assistant of the program editor.
// It transforms a coherent loop into an unrolled and/or vectorized version whose loop stride S,
// lanes L, memory strides s and offsets c are coherent by construction
// (rules of docs/program-editor-rules.md).
//
// Memory model (see programChecks.js): an access with lanes L, stride s and offset c reads, in
// iteration k, elements c + k·L·s … + L−1 (s < 0: from element N − c). For the algorithmic
// operation a (a = 0 … N−1) of the original loop (L = 1, S = 1) it reads element c + a·s.

import { checkProgram } from './programChecks.js'

const VECTOR_OF   = { INT: 'VINT', MEM: 'VMEM', FLOAT: 'VFLOAT' }
const isMemory    = (instr) => instr?.type === 'MEM' || instr?.type === 'VMEM'
const isVector    = (instr) => ['VINT', 'VMEM', 'VFLOAT'].includes(instr?.type)
const intOf       = (value, fallback) => {
  const text = String(value ?? '').trim()
  return text === '' || !Number.isFinite(Number(text)) ? fallback : Number(text)
}
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Variables read by an instruction (memory: index and stored value; not the array name)
export function readsOf(instr) {
  const reads = isMemory(instr)
    ? (instr.oper === 'STORE' ? [instr.source1, instr.source3] : [instr.source1, instr.source3])
    : [instr.source1, instr.source2, instr.source3]
  return reads.filter(Boolean)
}
// Variable used as index by a memory instruction
const indexOf = (instr) => (instr.oper === 'STORE' ? instr.source3 : instr.source1) || ''

// ---------------------------------------------------------------------------------------------
// Loop analysis: control instructions, counter, loop-carried variables (reductions, recurrences)
// ---------------------------------------------------------------------------------------------
export function analyzeLoop(instructionList) {
  const list   = instructionList ?? []
  const body   = list.slice(0, -1)
  const branch = list.at(-1) ?? {}
  const S      = intOf(branch.stride, 1)
  const written = new Set(body.map(i => i.destin).filter(Boolean))

  // Control: instructions that compute memory indexes or the branch condition (counter, compare)
  const indexVars = new Set(body.filter(isMemory).map(indexOf).filter(Boolean))
  const controlVars = new Set([...indexVars, branch.source1].filter(Boolean))
  const control = new Set()
  let grown = true
  while (grown) {
    grown = false
    body.forEach((instr, k) => {
      if (control.has(k) || instr.type !== 'INT' || !controlVars.has(instr.destin)) return
      control.add(k)
      grown = true
      for (const r of readsOf(instr)) if (written.has(r)) controlVars.add(r)
    })
  }
  // Indexes computed by non-control instructions (e.g. loaded from memory): indirect accesses
  const indirect = [...indexVars].filter(v =>
    body.some((instr, k) => instr.destin === v && !control.has(k)))

  // Counter: control instruction "i = i + k" (k in the constant field, or in the text)
  let counter = null
  body.forEach((instr, k) => {
    if (!control.has(k) || instr.destin !== instr.source1 || !indexVars.has(instr.destin)) return
    const textStep = /^\s*(\w+)\s*=\s*\1\s*\+\s*(\d+)\s*$/.exec(instr.text ?? '')
    const step = intOf(instr.constant, textStep ? Number(textStep[2]) : null)
    if (Number.isInteger(step)) counter = { index: k, variable: instr.destin, step }
  })

  // Loop-carried variables: read before being written in the body
  const carried = new Set()
  const writtenSoFar = new Set()
  body.forEach((instr, k) => {
    if (control.has(k)) { if (instr.destin) writtenSoFar.add(instr.destin); return }
    for (const r of readsOf(instr)) if (written.has(r) && !writtenSoFar.has(r) && !controlVars.has(r)) carried.add(r)
    if (instr.destin) writtenSoFar.add(instr.destin)
  })

  // Reduction: v = v ⊕ x, with the same associative operation, and v not read anywhere else
  const reductions = [], recurrences = []
  for (const v of carried) {
    const writers = body.map((instr, k) => ({ instr, k })).filter(w => w.instr.destin === v)
    const readers = body.map((instr, k) => ({ instr, k })).filter(w => readsOf(w.instr).includes(v))
    const kind = (instr) => {
      const uses = readsOf(instr).filter(r => r === v).length
      if (uses !== 1) return null
      if (instr.oper === 'FMA') return instr.source3 === v ? 'add' : null
      if (instr.oper === 'ADD') return 'add'
      if (instr.oper === 'MUL') return 'mul'
      if (instr.type === 'INT' && instr.oper === 'ARITH') return 'add'
      return null
    }
    const kinds = new Set(writers.map(w => kind(w.instr)))
    const isReduction = writers.length > 0 && !kinds.has(null) && kinds.size === 1 &&
                        readers.every(r => writers.some(w => w.k === r.k))
    ;(isReduction ? reductions : recurrences).push(v)
  }

  return { S, control, counter, indexVars, indirect, carried: [...carried], reductions, recurrences,
           vectorized: body.some(isVector), lanes: Math.max(1, ...body.map(i => (isVector(i) ? intOf(i.lanes, 1) : 1))) }
}

// ---------------------------------------------------------------------------------------------
// Text helpers (the text is informal: rewritten only when it has the usual forms)
// ---------------------------------------------------------------------------------------------
const fmtIndex = (v, o) => (o === 0 ? v : o > 0 ? `${v}+${o}` : `${v}-${-o}`)
const fmtRange = (v, lo, hi) => (lo === hi ? fmtIndex(v, lo) : `${fmtIndex(v, lo)}:${fmtIndex(v, hi)}`)

// "i", "i+1", "i-2", "i:i+3", "i+4:i+7"  ->  { v, lo, hi }
export function parseIndex(expr) {
  const term = String.raw`(\w+)\s*(?:([+-])\s*(\d+))?`
  const off  = (sign, n) => (n ? (sign === '-' ? -Number(n) : Number(n)) : 0)
  let m = new RegExp(`^\\s*${term}\\s*$`).exec(expr)
  if (m && /^[A-Za-z_]/.test(m[1])) return { v: m[1], lo: off(m[2], m[3]), hi: off(m[2], m[3]) }
  m = new RegExp(`^\\s*${term}\\s*:\\s*${term}\\s*$`).exec(expr)
  if (m && m[1] === m[4] && /^[A-Za-z_]/.test(m[1])) return { v: m[1], lo: off(m[2], m[3]), hi: off(m[5], m[6]) }
  return null
}

// Rewrite the reference to `array[...]` in the text
function rewriteArrayRef(text, array, rewrite) {
  if (!array) return text
  return text.replace(new RegExp(`\\b${escapeRegExp(array)}\\s*\\[([^\\]]*)\\]`), (_, expr) => `${array}[${rewrite(expr)}]`)
}

// Write vector variables as v[0:L-1] (outside array references)
function vectorizeNames(text, names, L) {
  if (!names.length) return text
  const words = new RegExp(`\\b(${names.map(escapeRegExp).join('|')})\\b(?!\\s*\\[)`, 'g')
  return text.split(/(\w+\s*\[[^\]]*\])/).map((part, k) => (k % 2 ? part : part.replace(words, `$1[0:${L - 1}]`))).join('')
}

const renameWord = (text, from, to) => text.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, 'g'), to)

function setCounterStep(instr, step) {
  instr.constant = String(step)
  instr.text = (instr.text ?? '').replace(/^(\s*(\w+)\s*=\s*\2\s*\+\s*)(\d+)(\s*)$/, `$1${step}$4`)
}

// ---------------------------------------------------------------------------------------------
// Vectorize with L lanes: S = L. Memory strides keep their value (L·s elements per iteration).
// ---------------------------------------------------------------------------------------------
export function vectorizeLoop(instructionList, L) {
  const list = (instructionList ?? []).map(i => ({ ...i }))
  const info = analyzeLoop(list)
  const errors = [], notes = []
  if (!(Number.isInteger(L) && L >= 2)) errors.push('The number of lanes must be an integer ≥ 2.')
  if (info.vectorized) errors.push('The loop is already vectorized.')
  if (info.S !== 1) errors.push(`The loop is already unrolled (S = ${info.S}): vectorize the original loop, then unroll it.`)
  if (info.recurrences.length)
    errors.push(`Recurrence through ${info.recurrences.join(', ')}: each iteration needs the result of the previous ` +
                'one, so the iterations cannot be computed in parallel lanes.')
  if (info.indirect.length)
    errors.push(`Indirect accesses through ${info.indirect.join(', ')} (gather/scatter) are not supported by the assistant.`)
  if (errors.length) return { program: null, errors, notes }

  const body = list.slice(0, -1), branch = list.at(-1)
  const vectorNames = [...new Set(body.filter((instr, k) => !info.control.has(k) &&
                       !(isMemory(instr) && intOf(instr.stride, 1) === 0)).map(i => i.destin).filter(Boolean))]
  body.forEach((instr, k) => {
    if (info.control.has(k)) return
    const s = intOf(instr.stride, 1)
    if (isMemory(instr) && s === 0) {
      notes.push(`Instruction ${k} accesses a fixed address: it stays scalar (its value is used by all the lanes).`)
      return
    }
    instr.type  = VECTOR_OF[instr.type] ?? instr.type
    instr.lanes = L
    if (isMemory(instr)) {
      // backward access: the first vector covers elements N-c-L+1 … N-c of the original loop
      if (s < 0) instr.constant = String(intOf(instr.constant, 0) + L - 1)
      instr.text = rewriteArrayRef(instr.text ?? '', instr.source2, (expr) => {
        const p = s > 0 ? parseIndex(expr) : null
        return p ? fmtRange(p.v, p.lo, p.lo + L - 1) : `${expr.trim()} (${L} elements)`
      })
    }
    instr.text = vectorizeNames(instr.text ?? '', vectorNames, L)
  })
  if (info.counter) setCounterStep(list[info.counter.index], info.counter.step * L)
  else notes.push('No loop counter "i = i + k" found: check the instructions that control the loop.')
  branch.stride = info.S * L
  for (const v of info.reductions)
    notes.push(`Reduction ${v}: it becomes ${L} partial results ${v}[0:${L - 1}], to be combined after the loop (not simulated).`)
  return { program: list, errors, notes }
}

// ---------------------------------------------------------------------------------------------
// Unroll U times: S' = U·S, each memory stride s' = U·s and copy j has offset c ± j·L·s.
// Optionally, each copy of a reduction uses its own partial accumulator.
// ---------------------------------------------------------------------------------------------
export function unrollLoop(instructionList, U, { splitAccumulators = false } = {}) {
  const list = (instructionList ?? []).map(i => ({ ...i }))
  const info = analyzeLoop(list)
  const errors = [], notes = []
  if (!(Number.isInteger(U) && U >= 2)) errors.push('The unrolling factor must be an integer ≥ 2.')
  if (errors.length) return { program: null, errors, notes }

  const body = list.slice(0, -1), branch = list.at(-1)
  const used = new Set(body.flatMap(i => [i.destin, ...readsOf(i)]).filter(Boolean))
  const partialName = (v, j) => {
    let name = `${v}${j}`
    for (let n = 1; used.has(name); n++) name = `${v}_${j}${n > 1 ? n : ''}`
    used.add(name)
    return name
  }
  const renames = splitAccumulators
    ? info.reductions.map(v => [v, Array.from({ length: U }, (_, j) => (j === 0 ? v : partialName(v, j)))])
    : []

  const out = []
  for (let j = 0; j < U; j++) {
    body.forEach((original, k) => {
      if (info.control.has(k)) return
      // A load from a fixed address (stride 0) gives the same value to all the copies: load it once
      if (j > 0 && isMemory(original) && original.oper === 'LOAD' && intOf(original.stride, 1) === 0) return
      const instr = { ...original }
      if (isMemory(instr)) {
        const L = intOf(instr.lanes, 1), s = intOf(instr.stride, 1), c = intOf(instr.constant, 0)
        if (s !== 0) {
          const delta = j * L * s       // element shift of copy j
          instr.stride = s * U
          const constant = s > 0 ? c + delta : c - delta
          instr.constant = constant === 0 && !String(original.constant ?? '').trim() ? '' : String(constant)
          if (j > 0) {
            instr.text = rewriteArrayRef(instr.text ?? '', instr.source2, (expr) => {
              const p = parseIndex(expr)
              return p ? fmtRange(p.v, p.lo + delta, p.hi + delta) : `${expr.trim()} ${delta >= 0 ? '+' : '-'} ${Math.abs(delta)}`
            })
          }
        }
      }
      for (const [v, names] of renames) {
        if (j === 0) continue
        for (const field of ['destin', 'source1', 'source2', 'source3']) if (instr[field] === v) instr[field] = names[j]
        instr.text = renameWord(instr.text ?? '', v, names[j])
      }
      out.push(instr)
    })
  }
  // The loop control (counter, compare) runs once per iteration, after the copies
  body.forEach((instr, k) => { if (info.control.has(k)) out.push({ ...instr }) })
  if (info.counter) {
    const counter = out.find(i => i.destin === info.counter.variable && i.source1 === info.counter.variable)
    if (counter) setCounterStep(counter, info.counter.step * U)
  } else {
    notes.push('No loop counter "i = i + k" found: check the instructions that control the loop.')
  }
  branch.stride = info.S * U
  out.push(branch)

  for (const [v, names] of renames)
    notes.push(`Reduction ${v}: ${U} partial accumulators ${names.join(', ')}; they break the dependence chain ` +
               'and must be added after the loop (not simulated).')
  if (!splitAccumulators && info.reductions.length)
    notes.push(`Reduction ${info.reductions.join(', ')}: the copies still form one dependence chain ` +
               '(use partial accumulators to break it).')
  for (const v of info.recurrences)
    notes.push(`Recurrence through ${v}: the copies form one dependence chain that cannot be broken.`)
  return { program: out, errors, notes }
}

// Vectorize (L ≥ 2) and then unroll (U ≥ 2). Returns the program, errors, notes and its checks.
export function transformLoop(instructionList, { lanes = 1, unroll = 1, splitAccumulators = false } = {}) {
  const before = checkProgram(instructionList)
  if (before.errors.length)
    return { program: null, errors: ['Fix the errors of the program before transforming it.'], notes: [], checks: null }
  let program = (instructionList ?? []).map(i => ({ ...i }))
  const errors = [], notes = []
  if (lanes >= 2) {
    const r = vectorizeLoop(program, lanes)
    errors.push(...r.errors); notes.push(...r.notes)
    if (r.program) program = r.program
  }
  if (!errors.length && unroll >= 2) {
    const r = unrollLoop(program, unroll, { splitAccumulators })
    errors.push(...r.errors); notes.push(...r.notes)
    if (r.program) program = r.program
  }
  if (errors.length) return { program: null, errors, notes, checks: null }
  return { program, errors, notes, checks: checkProgram(program) }
}

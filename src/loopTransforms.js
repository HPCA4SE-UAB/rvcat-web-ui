// Unroll / vectorize assistant of the program editor.
// It transforms a coherent loop into an unrolled and/or vectorized version whose loop stride S,
// lanes L, memory strides s and offsets c are coherent by construction
// (rules of docs/program-editor-rules.md).
//
// Memory model (see programChecks.js): an access with lanes L, stride s and offset c reads, in
// iteration k, elements c + k·L·s … + L−1 (s < 0: from element N − c). For the algorithmic
// operation a (a = 0 … N−1) of the original loop (L = 1, S = 1) it reads element c + a·s.

import { checkProgram } from './programChecks.js'
import { shiftIndexText, vectorIndexText, analyzeProgramText, sizeName } from './instructionText.js'

// x86 AVX registers are made of 128-bit blocks: SHUFFLE moves elements within each block (1 cycle),
// PERMUTE moves them across blocks (3 cycles in Intel processors)
export const BLOCK_BYTES = 16

const VECTOR_OF   = { INT: 'VINT', MEM: 'VMEM', FLOAT: 'VFLOAT' }
const SIZE_BYTES  = { byte: 1, word: 4, long: 8, single: 4, double: 8 }
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
// options.blocks: 'generic' (vector registers without 128-bit blocks: conversions read and write
// halves of registers directly, reversals are shuffles) or 'avx' (data moved across 128-bit blocks
// needs PERMUTE instructions: extract/insert of the halves of a conversion, reversals).
// Returns rearrange = { question, reasons }: question is true when the choice matters.
export function vectorizeLoop(instructionList, L, { blocks = 'generic', declarations = [] } = {}) {
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
  const isData = (instr, k) => !info.control.has(k) && !(isMemory(instr) && intOf(instr.stride, 1) === 0)

  const unsized = body.map((instr, k) => (isData(instr, k) && !SIZE_BYTES[instr.size] ? k : -1)).filter(k => k >= 0)
  if (unsized.length) {
    errors.push(`Instruction${unsized.length > 1 ? 's' : ''} ${unsized.join(', ')} ha${unsized.length > 1 ? 've' : 's'} no size: ` +
                'choose it (or the type of its variables in Declarations) before vectorizing.')
    return { program: null, errors, notes }
  }
  // Element sizes: the vector registers hold L elements of the smallest size; elements n times
  // larger use L/n lanes, so their instructions are done in n parts (two halves for double/single)
  const bytesOf = new Map()                       // variable -> bytes of its elements
  body.forEach((instr, k) => { if (isData(instr, k) && instr.destin && SIZE_BYTES[instr.size]) bytesOf.set(instr.destin, SIZE_BYTES[instr.size]) })
  const sizes = []
  body.forEach((instr, k) => {
    if (!isData(instr, k)) return
    if (SIZE_BYTES[instr.size]) sizes.push(SIZE_BYTES[instr.size])
    if (instr.oper === 'CVT' && bytesOf.get(instr.source1)) sizes.push(bytesOf.get(instr.source1))
  })
  const minBytes = sizes.length ? Math.min(...sizes) : 1
  const partsOf  = (bytes) => (bytes ? bytes / minBytes : 1)
  const splitVars = new Set([...bytesOf].filter(([, b]) => partsOf(b) > 1).map(([v]) => v))
  const maxParts  = Math.max(1, ...sizes.map(partsOf))
  if (L % maxParts) {
    errors.push(`Elements of ${maxParts * minBytes} bytes use ${maxParts} times fewer lanes than elements of ${minBytes} bytes: ` +
                `the number of lanes must be a multiple of ${maxParts}.`)
    return { program: null, errors, notes }
  }
  const vlen = L * minBytes
  const kinds = analyzeProgramText(list, declarations)
  const kindOf = (v) => kinds.classOf(originOf.get(v) ?? v)?.kind ?? 'INT'
  const rearrange = { question: false, reasons: [] }
  const reason = (text) => { if (!rearrange.reasons.includes(text)) rearrange.reasons.push(text) }
  // Instruction that moves elements: PERMUTE when they cross a 128-bit block (AVX model)
  const moveOper = (crosses) => (blocks === 'avx' && crosses ? 'PERMUTE' : 'SHUFFLE')
  const moveInstr = (v, bytes, oper, destText, sourcesText, destin, sources, lanes) => {
    const kind = kindOf(v)
    return { text: `${destText} = ${oper.toLowerCase()}(${sourcesText})`, type: `V${kind}`, oper,
             size: sizeName(kind, bytes) ?? '', destin, source1: sources[0] ?? '', source2: sources[1] ?? '',
             source3: '', constant: '', stride: 1, lanes }
  }
  const vectorNames = [...new Set(body.filter(isData).map(i => i.destin).filter(v => v && !splitVars.has(v)))]

  // Name of part p (of n) of a split variable
  const used = new Set(body.flatMap(i => [i.destin, ...readsOf(i), i.source2]).filter(Boolean))
  const unique = (base) => { let name = base; while (used.has(name)) name += '_'; used.add(name); return name }
  const originOf = new Map()                      // generated name -> variable of the original loop
  const partNames = new Map()
  const partName = (v, p, n) => {
    const key = `${v}|${p}`
    if (!partNames.has(key)) {
      const name = unique(n === 2 ? `${v}_${p ? 'hi' : 'lo'}` : `${v}_${p}`)
      originOf.set(name, v)
      partNames.set(key, name)
    }
    return partNames.get(key)
  }
  // Register holding elements first … first+len-1 of variable v in this iteration
  const regRef = (v, first, len) => {
    const n = splitVars.has(v) ? partsOf(bytesOf.get(v)) : 1
    const per = L / n, p = Math.floor(first / per), o = first - p * per
    const name = n > 1 ? partName(v, p, n) : v
    return { name, lo: o, text: `${name}[${o}:${o + len - 1}]` }
  }

  const out = []
  let splitNote = false
  body.forEach((instr, k) => {
    if (!isData(instr, k)) {
      if (info.control.has(k)) out.push(instr)
      else {
        notes.push(`Instruction ${k} accesses a fixed address: it stays scalar (its value is used by all the lanes).`)
        out.push(instr)
      }
      return
    }
    const s = intOf(instr.stride, 1)
    const vtype = VECTOR_OF[instr.type] ?? instr.type
    if (instr.oper === 'CVT') {
      // conversion: done in as many parts as the larger of its source and result needs
      const n = Math.max(partsOf(SIZE_BYTES[instr.size]), partsOf(bytesOf.get(instr.source1)))
      const l = L / n
      if (n > 1) splitNote = true
      const ds = bytesOf.get(instr.source1) ?? minBytes, dd = SIZE_BYTES[instr.size] ?? minBytes
      for (let j = 0; j < n; j++) {
        const dest = regRef(instr.destin, j * l, l)
        let src = regRef(instr.source1, j * l, l)
        if ((src.lo > 0 || dest.lo > 0) && vlen > BLOCK_BYTES) {
          rearrange.question = true
          reason(`converting the upper ${src.lo > 0 ? 'part of a register' : 'part of the result'} (${instr.text.trim()})`)
        }
        // AVX: a conversion reads the lowest elements of a register: extract the upper ones first
        if (blocks === 'avx' && src.lo > 0) {
          const full = L / (splitVars.has(instr.source1) ? partsOf(ds) : 1)
          const name = unique(`${src.name}_up`)
          originOf.set(name, originOf.get(src.name) ?? instr.source1)
          out.push(moveInstr(instr.source1, ds, moveOper(src.lo * ds >= BLOCK_BYTES), `${name}[0:${l - 1}]`,
                             `${src.name}[0:${full - 1}]`, name, [src.name], l))
          src = { name, lo: 0, text: `${name}[0:${l - 1}]` }
        }
        if (blocks === 'avx' && dest.lo > 0) {
          // AVX: convert into a register, then insert it into the upper part of the result
          const name = unique(`${dest.name}_up`)
          originOf.set(name, originOf.get(dest.name) ?? instr.destin)
          out.push({ ...instr, type: vtype, lanes: l, destin: name, source1: src.name, source2: '', source3: '',
                     text: `${name}[0:${l - 1}] = ${instr.size}(${src.text})` })
          out.push(moveInstr(instr.destin, dd, moveOper(dest.lo * dd >= BLOCK_BYTES), `${dest.name}[0:${dest.lo + l - 1}]`,
                             `${dest.name}[0:${dest.lo - 1}], ${name}[0:${l - 1}]`, dest.name, [dest.name, name], dest.lo + l))
          continue
        }
        const merge = dest.lo > 0     // upper lanes of the result: the lower ones are kept
        out.push({ ...instr, type: vtype, lanes: l, destin: dest.name, source1: src.name,
                   source2: merge ? dest.name : '', source3: '', text: `${dest.text} = ${instr.size}(${src.text})` })
      }
      return
    }
    const n = partsOf(SIZE_BYTES[instr.size])
    if (n === 1) {
      const copy = { ...instr, type: vtype, lanes: L }
      if (isMemory(copy)) {
        // backward access: the first vector covers elements N-c-L+1 … N-c of the original loop
        if (s < 0) copy.constant = String(intOf(copy.constant, 0) + L - 1)
        copy.text = rewriteArrayRef(copy.text ?? '', copy.source2, (expr) => {
          const p = s > 0 ? parseIndex(expr) : null
          return p ? fmtRange(p.v, p.lo, p.lo + L - 1) : (vectorIndexText(expr, L) ?? `${expr.trim()} (${L} elements)`)
        })
      }
      copy.text = vectorizeNames(copy.text ?? '', vectorNames, L)
      out.push(copy)
      return
    }
    // Elements n times larger than the smallest ones: n parts of L/n lanes
    splitNote = true
    const l = L / n
    for (let j = 0; j < n; j++) {
      const copy = { ...instr, type: vtype, lanes: l }
      if (isMemory(instr)) {
        const c = intOf(instr.constant, 0)
        const constant = s < 0 ? c + (l - 1) * Math.abs(s) + j * l * Math.abs(s) : c + j * l * s
        copy.stride   = s * n
        copy.constant = constant === 0 && !String(instr.constant ?? '').trim() ? '' : String(constant)
        const data = instr.oper === 'STORE' ? instr.source1 : instr.destin
        const ref  = regRef(data, j * l, l)
        let range = null
        rewriteArrayRef(instr.text ?? '', instr.source2, (expr) => {
          const widened = vectorIndexText(expr, l)
          range = widened ? shiftIndexText(widened, j * l * s) : null
          return expr
        })
        range ??= `${instr.constant || 0} + ${j * l} (${l} elements)`
        if (instr.oper === 'STORE') { copy.source1 = ref.name; copy.text = `${instr.source2}[${range}] = ${ref.text}` }
        else                        { copy.destin  = ref.name; copy.text = `${ref.text} = ${instr.source2}[${range}]` }
      } else {
        const refs = new Map()
        for (const field of ['destin', 'source1', 'source2', 'source3']) {
          const v = instr[field]
          if (!v || !(splitVars.has(v) || vectorNames.includes(v))) continue
          const ref = regRef(v, j * l, l)
          refs.set(v, ref)
          copy[field] = ref.name
        }
        copy.text = renameRegisters(instr.text ?? '', refs)
      }
      out.push(copy)
    }
  })
  // Backward accesses combined with forward ones: the lanes of a backward vector are in reverse
  // order, so loaded vectors are reversed after the load, and stored ones before the store
  const vecMem = out.filter(i => isMemory(i) && isVector(i))
  const mixed = vecMem.some(i => intOf(i.stride, 1) > 0) && vecMem.some(i => intOf(i.stride, 1) < 0)
  let reversals = 0
  if (mixed) {
    for (let p = out.length - 1; p >= 0; p--) {
      const m = out[p]
      if (!isMemory(m) || !isVector(m) || intOf(m.stride, 1) >= 0) continue
      const l = intOf(m.lanes, 1), d = SIZE_BYTES[m.size] ?? minBytes
      const crosses = l * d > BLOCK_BYTES
      if (crosses) { rearrange.question = true; reason(`reversing the elements of backward accesses (${m.source2})`) }
      reversals++
      if (m.oper === 'LOAD') {
        out.splice(p + 1, 0, moveInstr(m.destin, d, moveOper(crosses), `${m.destin}[0:${l - 1}]`, `${m.destin}[0:${l - 1}]`,
                                       m.destin, [m.destin], l))
      } else {
        const v = m.source1, name = unique(`${v}_rev`)
        originOf.set(name, originOf.get(v) ?? v)
        out.splice(p, 0, moveInstr(v, d, moveOper(crosses), `${name}[0:${l - 1}]`, `${v}[0:${l - 1}]`, name, [v], l))
        const store = out[p + 1]
        store.source1 = name
        store.text = store.text.replace(/=(.*)$/, (_, rhs) => `=${rhs.replace(new RegExp(`\\b${escapeRegExp(v)}\\b`), name)}`)
      }
    }
    if (reversals)
      notes.push(`Backward and forward accesses are combined: ${reversals} vector${reversals > 1 ? 's are' : ' is'} reversed ` +
                 `(${blocks === 'avx' ? 'PERMUTE across 128-bit blocks' : 'SHUFFLE'}) so that their lanes match.`)
  }
  if (blocks === 'avx' && rearrange.question)
    notes.push('AVX model: data moved across 128-bit blocks uses PERMUTE instructions (3 cycles in Intel processors).')

  if (info.counter) {
    const counter = out.find(i => i.destin === info.counter.variable && i.source1 === info.counter.variable)
    if (counter) setCounterStep(counter, info.counter.step * L)
  } else notes.push('No loop counter "i = i + k" found: check the instructions that control the loop.')
  branch.stride = info.S * L
  out.push(branch)
  if (splitNote)
    notes.push(`Vector registers of ${vlen} bytes: ${L} elements of ${minBytes} bytes, or ${L / maxParts} of ` +
               `${maxParts * minBytes} bytes. The instructions on larger elements are done in ${maxParts === 2 ? 'two halves' : `${maxParts} parts`} ` +
               `(${[...splitVars].map(v => partName(v, 0, partsOf(bytesOf.get(v)))).slice(0, 3).join(', ')}…), and conversions read or write half a register.`)
  for (const v of info.reductions) {
    const n = splitVars.has(v) ? partsOf(bytesOf.get(v)) : 1
    notes.push(n > 1
      ? `Reduction ${v}: it becomes ${n} partial vectors (${Array.from({ length: n }, (_, p) => partName(v, p, n)).join(', ')}) of ${L / n} lanes, to be combined after the loop (not simulated).`
      : `Reduction ${v}: it becomes ${L} partial results ${v}[0:${L - 1}], to be combined after the loop (not simulated).`)
  }
  return { program: out, errors, notes, vlen, rearrange }
}

// Text of a split instruction: each register variable is written as its part, e.g. s_lo[0:3]
function renameRegisters(text, refs) {
  if (!refs.size) return text
  const words = new RegExp(`\\b(${[...refs.keys()].map(escapeRegExp).join('|')})\\b(?!\\s*\\[)`, 'g')
  return text.split(/(\w+\s*\[[^\]]*\])/).map((part, k) => (k % 2 ? part : part.replace(words, (w) => refs.get(w).text))).join('')
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
              return p ? fmtRange(p.v, p.lo + delta, p.hi + delta)
                       : (shiftIndexText(expr, delta) ?? `${expr.trim()} ${delta >= 0 ? '+' : '-'} ${Math.abs(delta)}`)
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
export function transformLoop(instructionList, { lanes = 1, unroll = 1, splitAccumulators = false, blocks = 'generic',
                                                declarations = [] } = {}) {
  const before = checkProgram(instructionList)
  if (before.errors.length)
    return { program: null, errors: ['Fix the errors of the program before transforming it.'], notes: [], checks: null }
  let program = (instructionList ?? []).map(i => ({ ...i }))
  const errors = [], notes = []
  let vlen = null, rearrange = null
  if (lanes >= 2) {
    const r = vectorizeLoop(program, lanes, { blocks, declarations })
    errors.push(...r.errors); notes.push(...r.notes)
    if (r.program) program = r.program
    vlen = r.vlen ?? null
    rearrange = r.rearrange ?? null
  }
  if (!errors.length && unroll >= 2) {
    const r = unrollLoop(program, unroll, { splitAccumulators })
    errors.push(...r.errors); notes.push(...r.notes)
    if (r.program) program = r.program
  }
  if (errors.length) return { program: null, errors, notes, checks: null, vlen, rearrange }
  return { program, errors, notes, vlen, rearrange, checks: checkProgram(program, { vlen }) }
}

// Consistency between the text of an instruction and its fields (program editor).
// Documented in docs/program-editor-rules.md ("Instruction text").
//
// Canonical grammar of the text (anything else is "not analyzed", and its fields are not checked):
//   x = y op z        op: + - * /  & | ^  << >>  == != < <= > >=     (y, z: variable or number)
//   x = y*z + w       FMA (also w + y*z)
//   x = sqrt(y)
//   x = double(y)     conversion to the type and size named: single, double (FLOAT), byte, word, long (INT)
//                     x[0:3] = double(y[4:7]) converts the upper half of an 8-lane register
//   x = A[index]      load            A[index] = x      store
//   index:   i+c, a*i+c (forward) · N-c-i, N-c-a*i (backward from the end) · c (fixed element)
//   vectors: x[0:3] is a vector register of 4 lanes; A[i:i+3], A[N-4-i:N-1-i] access 4 elements
//
// Data types are inferred for the whole program: variables that exchange values (operands and
// result of an operation, value and array of a load/store) form one class with one data type.
// The type of a class comes from the operations (/, sqrt, FMA → FLOAT; & | ^ << >>, indexes,
// comparisons → INT), from the Type/Size fields, and from the declarations of the program.

const SIZE_BYTES  = { byte: 1, word: 4, long: 8, single: 4, double: 8 }
const INT_SIZES   = { 1: 'byte', 4: 'word', 8: 'long' }
const FLOAT_SIZES = { 4: 'single', 8: 'double' }
const BINARY      = { '+': 'add', '-': 'add', '*': 'mul', '/': 'div', '&': 'logic', '|': 'logic', '^': 'logic',
                      '<<': 'shift', '>>': 'shift', '==': 'cmp', '!=': 'cmp', '<': 'cmp', '<=': 'cmp',
                      '>': 'cmp', '>=': 'cmp' }
// Operation of each operation class, for INT and FLOAT types (null: not available)
// Conversions: function name -> type and size of the result
export const CONVERSIONS = { single: ['FLOAT', 4], double: ['FLOAT', 8], byte: ['INT', 1], word: ['INT', 4], long: ['INT', 8] }
const OPER = {
  add:   { INT: 'ARITH', FLOAT: 'ADD' },  mul:   { INT: 'ARITH', FLOAT: 'MUL' },
  div:   { INT: null,    FLOAT: 'DIV' },  fma:   { INT: null,    FLOAT: 'FMA' },
  sqrt:  { INT: null,    FLOAT: 'SQRT' }, logic: { INT: 'LOGIC', FLOAT: null },
  shift: { INT: 'SHIFT', FLOAT: null },   cmp:   { INT: 'ARITH', FLOAT: null },
  cvt:   { INT: 'CVT',   FLOAT: 'CVT' },
}
// Data type imposed by the operation itself
const OP_KIND = { div: 'FLOAT', fma: 'FLOAT', sqrt: 'FLOAT', logic: 'INT', shift: 'INT', cmp: 'INT' }
const OP_TEXT = { div: '/', fma: 'a*b + c', sqrt: 'sqrt', logic: 'logic operation', shift: 'shift',
                  cmp: 'comparison', cvt: 'conversion', index: 'memory index', counter: 'loop counter', condition: 'branch condition',
                  size: 'array size in a backward index' }

export const FIELD_LABELS = { type: 'Type', oper: 'Oper', size: 'Size', destin: 'Destin', source1: 'Source1',
                              source2: 'Source2', source3: 'Source3', constant: 'Constant', stride: 'Stride',
                              lanes: 'Lanes' }

export const kindOfType = (type) =>
  (type === 'INT' || type === 'VINT' ? 'INT' : type === 'FLOAT' || type === 'VFLOAT' ? 'FLOAT' : null)
export const sizeName = (kind, bytes) => (kind === 'FLOAT' ? FLOAT_SIZES[bytes] : INT_SIZES[bytes]) ?? null
export const sizeBytes = (name) => SIZE_BYTES[name] ?? null
const isMemoryType = (type) => type === 'MEM' || type === 'VMEM'

// ---------------------------------------------------------------------------------------------
// Tokens and linear index expressions
// ---------------------------------------------------------------------------------------------
function tokenize(text) {
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_]\w*)|(<<|>>|<=|>=|==|!=|[-+*/&|^<>=[\]():]))/y
  const tokens = []
  const s = String(text ?? '')
  let pos = 0
  while (pos < s.length && !/^\s*$/.test(s.slice(pos))) {
    re.lastIndex = pos
    const m = re.exec(s)
    if (!m) return null
    tokens.push(m[1] !== undefined ? { t: 'num', v: m[1] } : m[2] !== undefined ? { t: 'id', v: m[2] } : { t: 'op', v: m[3] })
    pos = re.lastIndex
  }
  return tokens
}

// Sum of terms [+-] (number | var | number*var | var*number)  ->  { vars: Map(var -> coef), b }
function parseLinear(tokens) {
  if (!tokens.length) return null
  const vars = new Map()
  let b = 0, i = 0
  while (i < tokens.length) {
    let sign = 1
    if (tokens[i].t === 'op' && (tokens[i].v === '+' || tokens[i].v === '-')) { sign = tokens[i].v === '-' ? -1 : 1; i++ }
    else if (i > 0) return null
    const [x, y, z] = [tokens[i], tokens[i + 1], tokens[i + 2]]
    if (!x) return null
    let coef, name, used = 1
    if (y?.t === 'op' && y.v === '*') {
      if (x.t === 'num' && z?.t === 'id')      { coef = Number(x.v); name = z.v }
      else if (x.t === 'id' && z?.t === 'num') { coef = Number(z.v); name = x.v }
      else return null
      used = 3
    } else if (x.t === 'num') {
      if (!Number.isInteger(Number(x.v))) return null
      b += sign * Number(x.v); i++
      continue
    } else if (x.t === 'id') { coef = 1; name = x.v }
    else return null
    if (!Number.isInteger(coef)) return null
    vars.set(name, (vars.get(name) ?? 0) + sign * coef)
    i += used
  }
  for (const [name, coef] of vars) if (coef === 0) vars.delete(name)
  return { vars, b }
}

// Element accessed: forward a·v + b · backward size − a·v + b · fixed b
function classifyIndex(lin) {
  if (!lin) return null
  const terms = [...lin.vars]
  if (!terms.length) return { dir: 'fixed', v: null, a: 0, b: lin.b }
  if (terms.length === 1 && terms[0][1] > 0) return { dir: 'forward', v: terms[0][0], a: terms[0][1], b: lin.b }
  if (terms.length === 2) {
    const pos = terms.filter(t => t[1] > 0), neg = terms.filter(t => t[1] < 0)
    if (pos.length === 1 && neg.length === 1 && pos[0][1] === 1)
      return { dir: 'backward', size: pos[0][0], v: neg[0][0], a: -neg[0][1], b: lin.b }
  }
  return null
}

// Contents of [...]: one index or a range lo:hi  ->  { lo, hi } (classified), or null
function parseBracket(tokens) {
  const colon = tokens.findIndex(t => t.t === 'op' && t.v === ':')
  const parts = colon < 0 ? [tokens] : [tokens.slice(0, colon), tokens.slice(colon + 1)]
  if (parts.some(p => p.some(t => t.t === 'op' && t.v === ':'))) return null
  const [lo, hi] = parts.map(p => classifyIndex(parseLinear(p)))
  if (!lo || (colon >= 0 && !hi)) return null
  return { lo, hi: hi ?? lo, range: colon >= 0 }
}

const fmtCoef = (a, v) => (a === 1 ? v : `${a}*${v}`)
function formatIndex(ix) {
  const b = ix.b > 0 ? `+${ix.b}` : ix.b < 0 ? `-${-ix.b}` : ''
  if (ix.dir === 'fixed')   return String(ix.b)
  if (ix.dir === 'forward') return `${fmtCoef(ix.a, ix.v)}${b}`
  return `${ix.size}${b}-${fmtCoef(ix.a, ix.v)}`
}

// Text of an index shifted by `delta` elements (unrolled copies), or null if not canonical
export function shiftIndexText(expr, delta) {
  const tokens = tokenize(expr)
  const br = tokens && parseBracket(tokens)
  if (!br) return null
  const shift = (ix) => formatIndex({ ...ix, b: ix.b + delta })
  return br.range ? `${shift(br.lo)}:${shift(br.hi)}` : shift(br.lo)
}

// Text of a scalar index widened to L elements (vectorized access), or null if not canonical:
// forward i+c -> i+c:i+c+L-1, backward N-c-i -> N-(c+L-1)-i:N-c-i
export function vectorIndexText(expr, L) {
  const tokens = tokenize(expr)
  const br = tokens && parseBracket(tokens)
  if (!br || br.range || br.lo.dir === 'fixed') return null
  const lo = br.lo.dir === 'backward' ? { ...br.lo, b: br.lo.b - (L - 1) } : br.lo
  const hi = br.lo.dir === 'backward' ? br.lo : { ...br.lo, b: br.lo.b + L - 1 }
  return `${formatIndex(lo)}:${formatIndex(hi)}`
}

// ---------------------------------------------------------------------------------------------
// Statement parser
// ---------------------------------------------------------------------------------------------
class NotAnalyzed extends Error {}
const fail = (reason) => { throw new NotAnalyzed(reason) }

// Operand at tokens[i]: number, variable, vector register x[a:b], memory reference A[index]
function parseOperand(tokens, i) {
  const x = tokens[i]
  if (!x) fail('an operand is missing')
  if (x.t === 'num') return { op: { k: 'num', v: x.v }, next: i + 1 }
  if (x.t !== 'id') fail(`unexpected "${x.v}"`)
  if (tokens[i + 1]?.t !== 'op' || tokens[i + 1].v !== '[') return { op: { k: 'var', name: x.v }, next: i + 1 }
  const close = tokens.findIndex((t, k) => k > i + 1 && t.t === 'op' && t.v === ']')
  if (close < 0) fail('"]" is missing')
  const inner = tokens.slice(i + 2, close)
  if (inner.some(t => t.t === 'op' && (t.v === '[' || t.v === '(')))
    fail('indirect or complex index (only i+c, a*i+c, N-c-i or a number)')
  const br = parseBracket(inner)
  if (!br) fail(`index "${inner.map(t => t.v).join('')}" is not of the form i+c, a*i+c, N-c-i or a number`)
  const L = br.hi.b - br.lo.b + 1
  if (br.range) {
    if (br.lo.dir !== br.hi.dir || br.lo.v !== br.hi.v || br.lo.a !== br.hi.a || br.lo.size !== br.hi.size)
      fail('both ends of a range must use the same index')
    if (L < 2) fail('a range goes from the lower to the higher element (e.g. x[0:3], A[i:i+3])')
  }
  if (br.range && br.lo.dir === 'fixed')     // x[0:3]: vector register (x[4:7]: its upper lanes)
    return { op: { k: 'reg', name: x.v, L, lo: br.lo.b, hi: br.hi.b }, next: close + 1 }
  return { op: { k: 'mem', array: x.v, ...br.lo, L: br.range ? L : 1 }, next: close + 1 }
}

// Parses the text of an instruction. Returns { ok: true, p } or { ok: false, reason, empty }
export function parseInstruction(text) {
  const tokens = tokenize(text)
  if (tokens && !tokens.length) return { ok: false, empty: true, reason: 'empty text' }
  try {
    if (!tokens) fail('unexpected characters')
    if (tokens[0]?.v === 'if') {
      if (tokens.length === 4 && tokens[1].t === 'id' && tokens[2].v === 'go' && tokens[3].v === 'back')
        return { ok: true, p: { kind: 'branch', cond: tokens[1].v, L: 1, regs: [] } }
      fail('the branch is written "if c go back"')
    }
    const eq = tokens.findIndex(t => t.t === 'op' && t.v === '=')
    if (eq < 1) fail('expected "destination = expression"')
    const lhs = parseOperand(tokens, 0)
    if (lhs.next !== eq) fail('the destination is a variable, x[0:3] or A[index]')
    if (lhs.op.k === 'num') fail('the destination cannot be a number')

    // Right-hand side: operand list with operators
    const items = []
    let i = eq + 1
    let sqrt = false, convert = null
    const fn = tokens[i]?.v
    if ((fn === 'sqrt' || CONVERSIONS[fn]) && tokens[i]?.t === 'id' && tokens[i + 1]?.v === '(') {
      const o = parseOperand(tokens, i + 2)
      if (tokens[o.next]?.v !== ')' || o.next + 1 !== tokens.length) fail(`expected ${fn}(x)`)
      if (o.op.k === 'num') fail(`${fn}() of a number: write the number in the type you need`)
      items.push(o.op)
      if (fn === 'sqrt') sqrt = true
      else convert = fn
      i = tokens.length
    }
    while (i < tokens.length) {
      const o = parseOperand(tokens, i)
      items.push(o.op)
      i = o.next
      if (i >= tokens.length) break
      const t = tokens[i]
      if (t.t !== 'op' || !BINARY[t.v]) fail(t.v === '(' || t.v === ')' ? 'parentheses are not supported' : `unexpected "${t.v}"`)
      items.push({ k: 'op', v: t.v })
      i++
      if (i >= tokens.length) fail('an operand is missing')
    }
    const operands = items.filter(x => x.k !== 'op'), ops = items.filter(x => x.k === 'op').map(x => x.v)
    const mems = [lhs.op, ...operands].filter(o => o.k === 'mem')
    const regs = [lhs.op, ...operands].filter(o => o.k === 'reg')
    const lanes = new Set([...regs, ...mems].map(o => o.L).filter(L => L > 1))
    if (lanes.size > 1) fail(`different numbers of lanes (${[...lanes].join(', ')})`)
    const L = lanes.size ? [...lanes][0] : 1
    const p = { L, regs }

    if (lhs.op.k === 'mem') {                                  // store A[index] = x
      if (operands.length !== 1 || ops.length || sqrt || convert) fail('a store writes a variable: A[index] = x')
      if (operands[0].k === 'num') fail('a store writes a variable, not a number')
      if (operands[0].k === 'mem') fail('memory-to-memory copy: load into a variable, then store it')
      return { ok: true, p: { ...p, kind: 'store', value: operands[0].name, mem: lhs.op } }
    }
    if (mems.length) {                                         // load x = A[index]
      if (operands.length !== 1 || ops.length || sqrt || convert) fail('memory operands are only allowed in x = A[index] and A[index] = x')
      return { ok: true, p: { ...p, kind: 'load', dest: lhs.op.name, mem: operands[0] } }
    }
    // Operation
    let op, terms
    if (sqrt) { op = 'sqrt'; terms = operands }
    else if (convert) { op = 'cvt'; terms = operands }
    else if (!ops.length) fail(operands[0].k === 'num' ? 'RVCAT has no instruction to set a constant'
                                                        : 'copy: RVCAT has no move instruction')
    else if (ops.length === 1) { op = BINARY[ops[0]]; terms = operands }
    else if (ops.length === 2 && ops[0] === '*' && ops[1] === '+') { op = 'fma'; terms = operands }
    else if (ops.length === 2 && ops[0] === '+' && ops[1] === '*') { op = 'fma'; terms = [operands[1], operands[2], operands[0]] }
    else fail('more than one operation (one instruction does one operation; a*b + c is an FMA)')
    const numbers = terms.filter(o => o.k === 'num')
    if (numbers.length > 1) fail('more than one constant')
    // Writing the upper lanes of a register (x[4:7] = ...) keeps the lower ones: it also reads x
    const merge = lhs.op.k === 'reg' && lhs.op.lo > 0
    const sources = [...new Set([...terms.filter(o => o.k !== 'num').map(o => o.name), ...(merge ? [lhs.op.name] : [])])]
    if (op === 'cvt') regs.forEach(r => { r.cvt = true })
    return { ok: true, p: { ...p, kind: 'compute', dest: lhs.op.name, op, symbol: ops[0] ?? op, sources, merge,
                            convert, constant: numbers[0]?.v ?? '' } }
  } catch (e) {
    if (e instanceof NotAnalyzed) return { ok: false, reason: e.message }
    throw e
  }
}

// ---------------------------------------------------------------------------------------------
// Program analysis: type inference, derived fields, warnings
// ---------------------------------------------------------------------------------------------
const norm = (v) => String(v ?? '').trim()
const constantNumber = (v) => (norm(v) === '' ? 0 : Number(norm(v)))

// list: instruction list (the last one is the BRANCH). declarations: [{ name, type?, size? }]
// ignoreFieldsOf: Set of instruction indexes whose Type/Size fields are not used as type seeds
export function analyzeProgramText(list, declarations = [], { ignoreFieldsOf = null } = {}) {
  const instrs = Array.isArray(list) ? list : []
  const last   = instrs.length - 1
  const rows   = instrs.map((inst, index) => {
    if (index === last && inst?.type === 'BRANCH') return { ok: true, p: { kind: 'branch', cond: inst.source1, L: 1, regs: [] } }
    return parseInstruction(inst?.text)
  })

  // Variables, roles and classes (union-find)
  const vars = new Map(), parent = new Map()
  const variable = (name, index, role) => {
    if (!name) return
    if (!vars.has(name)) { vars.set(name, { name, first: index, uses: new Set(), roles: new Set(), written: false, lanes: new Set() }); parent.set(name, name) }
    const v = vars.get(name)
    v.uses.add(index)
    if (role) v.roles.add(role)
    return v
  }
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
  const union = (a, b) => { if (a && b) parent.set(find(a), find(b)) }
  const seeds = []    // { name, kind?, bytes?, origin: 'text'|'field'|'declaration', index, detail }
  const strong = (name, kind, index, detail) => name && seeds.push({ name, kind, origin: 'text', index, detail })

  // Loop counters: v = v + k
  const steps = new Map()
  const cvts  = []
  rows.forEach(r => {
    const p = r.ok && r.p
    if (p?.kind === 'compute' && p.symbol === '+' && p.sources.length === 1 && p.sources[0] === p.dest &&
        Number.isInteger(Number(p.constant)) && p.constant !== '')
      steps.set(p.dest, [...(steps.get(p.dest) ?? []), Number(p.constant)])
  })
  const stepOf = (v) => (steps.get(v)?.length === 1 ? steps.get(v)[0] : null)

  rows.forEach((r, index) => {
    if (!r.ok) return
    const p = r.p, inst = instrs[index]
    for (const reg of p.regs) {
      const v = variable(reg.name, index)
      if (!reg.cvt && reg.lo === 0) v?.lanes.add(reg.L)     // conversions use halves of registers
    }
    if (p.kind === 'branch') { variable(p.cond, index, 'condition'); strong(p.cond, 'INT', index, 'condition'); return }
    if (p.kind === 'load' || p.kind === 'store') {
      const data = p.kind === 'load' ? p.dest : p.value
      const dv = variable(data, index, 'data')
      if (p.kind === 'load') dv.written = true
      variable(p.mem.array, index, 'array')
      union(data, p.mem.array)
      if (p.mem.v) { variable(p.mem.v, index, 'index'); strong(p.mem.v, 'INT', index, 'index') }
      if (p.mem.size) { variable(p.mem.size, index, 'size'); strong(p.mem.size, 'INT', index, 'size') }
      p.data = data
      if (!ignoreFieldsOf?.has(index) && isMemoryType(inst.type) && sizeBytes(inst.size) && !['single', 'double'].includes(inst.size))
        seeds.push({ name: data, bytes: sizeBytes(inst.size), origin: 'field', index, detail: 'Size' })
      return
    }
    // compute
    variable(p.dest, index, p.op === 'cmp' ? 'condition' : 'data').written = true
    for (const s of p.sources) variable(s, index, p.op === 'cmp' ? null : 'data')
    if (p.op === 'cmp') {
      strong(p.dest, 'INT', index, 'cmp')
      p.sources.forEach(s => { union(s, p.sources[0]); strong(s, 'INT', index, 'cmp') })
    } else if (p.op === 'cvt') {
      // the result has the type and size named by the conversion; the source is another class
      const [kind, bytes] = CONVERSIONS[p.convert]
      seeds.push({ name: p.dest, kind, bytes, origin: 'text', index, detail: 'cvt' })
      cvts.push({ index, dest: p.dest, source: p.sources.find(s => s !== p.dest) ?? p.sources[0], kind, bytes })
    } else {
      p.sources.forEach(s => union(s, p.dest))
      if (OP_KIND[p.op]) strong(p.dest, OP_KIND[p.op], index, p.op)
      if (stepOf(p.dest) !== null && p.sources[0] === p.dest && p.symbol === '+') {
        vars.get(p.dest).roles.add('counter'); strong(p.dest, 'INT', index, 'counter')
      }
    }
    if (!ignoreFieldsOf?.has(index)) {
      const kind = kindOfType(inst.type)
      if (kind && p.op !== 'cmp') seeds.push({ name: p.dest, kind, origin: 'field', index, detail: 'Type' })
      if (kind && sizeBytes(inst.size) && sizeName(kind, sizeBytes(inst.size)) === inst.size)
        seeds.push({ name: p.dest, bytes: sizeBytes(inst.size), origin: 'field', index, detail: 'Size' })
    }
  })
  for (const d of Array.isArray(declarations) ? declarations : []) {
    if (!d?.name || !vars.has(d.name)) continue
    const kind = d.type === 'INT' || d.type === 'FLOAT' ? d.type : null
    const bytes = sizeBytes(d.size)
    if (kind)  seeds.push({ name: d.name, kind, origin: 'declaration', index: -1, detail: d.name })
    if (bytes) seeds.push({ name: d.name, bytes, origin: 'declaration', index: -1, detail: d.name })
  }

  // Resolve each class
  const classes = new Map()
  for (const name of vars.keys()) {
    const root = find(name)
    if (!classes.has(root)) classes.set(root, { root, names: [], seeds: [] })
    classes.get(root).names.push(name)
  }
  for (const s of seeds) classes.get(find(s.name)).seeds.push(s)
  const describe = (s) => (s.origin === 'declaration' ? `declaration of ${s.detail}`
                          : s.origin === 'field' ? `${s.detail} field of #${s.index}` : `#${s.index} (${OP_TEXT[s.detail] ?? s.detail})`)
  const warnings = [], infos = []
  for (const cls of classes.values()) {
    const kindSeeds = cls.seeds.filter(s => s.kind)
    const strongKind = kindSeeds.find(s => s.origin === 'text')?.kind
    cls.kind = strongKind ?? kindSeeds[0]?.kind ?? null
    const bytesSeeds = cls.seeds.filter(s => s.bytes)
    cls.bytes = bytesSeeds.find(s => s.origin === 'text')?.bytes ?? bytesSeeds[0]?.bytes ?? (cls.kind === 'INT' ? 4 : null)
    cls.assumed = !bytesSeeds.length && cls.kind === 'INT'
    const problems = []
    const kinds = [...new Set(kindSeeds.map(s => s.kind))]
    if (kinds.length > 1)
      problems.push(kinds.map(k => `${k} (${[...new Set(kindSeeds.filter(s => s.kind === k).map(describe))].join(', ')})`).join(' and '))
    const sizes = [...new Set(bytesSeeds.map(s => s.bytes))]
    if (sizes.length > 1)
      problems.push(sizes.map(b => `${b} bytes (${[...new Set(bytesSeeds.filter(s => s.bytes === b).map(describe))].join(', ')})`).join(' and '))
    if (cls.kind === 'FLOAT' && cls.bytes && !FLOAT_SIZES[cls.bytes])
      problems.push(`a FLOAT has 4 (single) or 8 (double) bytes, not ${cls.bytes}`)
    cls.conflict = problems.length ? problems.join('; ') : null
    if (cls.conflict) {
      const at = [...cls.seeds.filter(s => s.index >= 0).map(s => s.index), -1][0]
      warnings.push({ code: 'T3', index: at,
        message: `Data type of ${cls.names.join(', ')}${cls.names.length > 1 ? ' (they exchange values)' : ''}: ${cls.conflict}.` })
    }
  }
  const classOf = (name) => classes.get(find(name)) ?? { kind: null, bytes: null }

  // Conversions: between INT and FLOAT, or between single and double
  for (const c of cvts) {
    const src = classOf(c.source)
    const target = `${c.kind} ${sizeName(c.kind, c.bytes)}`
    if (find(c.source) === find(c.dest)) continue                       // reported as T3
    if (src.kind === 'INT' && c.kind === 'INT')
      warnings.push({ code: 'T6', index: c.index, message: `Conversion of the integer ${c.source} to ${target}: ` +
                      'only conversions between INT and FLOAT, or between single and double, are available.' })
    else if (src.kind === c.kind && src.bytes === c.bytes)
      warnings.push({ code: 'T6', index: c.index, message: `${c.source} is already ${target}: the conversion does nothing.` })
  }

  for (const v of vars.values()) {
    if (v.lanes.size > 1)
      warnings.push({ code: 'T5', index: v.first, message: `Vector register ${v.name} is used with different numbers of lanes (${[...v.lanes].join(', ')}).` })
  }

  // Derived fields and comparison with the edited ones
  const derived = rows.map((r, index) => (r.ok && r.p.kind !== 'branch' ? deriveFields(r.p, instrs[index], classOf, stepOf) : null))
  rows.forEach((r, index) => {
    if (index === last) return
    if (!r.ok) {
      if (!r.empty) infos.push({ code: 'T1', index, message: `Text not analyzed (${r.reason}): its fields are not checked.` })
      return
    }
    const diffs = fieldDifferences(instrs[index], derived[index])
    if (diffs.length)
      warnings.push({ code: 'T2', index, message: 'Fields differ from the text: ' +
        diffs.map(d => `${FIELD_LABELS[d.field]} is ${show(d.actual)}, the text gives ${show(d.expected)}`).join('; ') + '.' })
  })

  // Declarations table
  const ROLE_ORDER = ['array', 'index', 'counter', 'condition', 'size', 'data']
  const variables = [...vars.values()].sort((a, b) => a.first - b.first).map(v => {
    const cls = classOf(v.name)
    const role = ROLE_ORDER.find(r => v.roles.has(r)) ?? 'data'
    return {
      name: v.name, role, readOnly: !v.written && role !== 'array',
      kind: cls.kind, bytes: cls.bytes, size: cls.bytes ? sizeName(cls.kind, cls.bytes) : null, assumed: cls.assumed,
      lanes: [...v.lanes], uses: [...v.uses].sort((a, b) => a - b),
      sameData: cls.names.filter(n => n !== v.name), conflict: cls.conflict, root: find(v.name),
    }
  })
  return { rows, derived, variables, warnings, infos, classOf, root: (name) => (vars.has(name) ? find(name) : null) }
}

const show = (v) => (norm(v) === '' ? '(empty)' : `"${norm(v)}"`)

function deriveFields(p, inst, classOf, stepOf) {
  const vec = p.L > 1
  if (p.op === 'cvt') {
    const [kind] = CONVERSIONS[p.convert]
    const s = p.sources
    return { type: vec ? `V${kind}` : kind, oper: 'CVT', size: p.convert, destin: p.dest,
             source1: s[0] ?? '', source2: s[1] ?? '', source3: s[2] ?? '', constant: '', stride: null, lanes: p.L }
  }
  if (p.kind === 'load' || p.kind === 'store') {
    const m = p.mem, cls = classOf(p.data)
    const c = m.dir === 'backward' ? -m.b : m.b
    let stride = null
    if (m.dir === 'fixed') stride = 0
    else {
      const step = stepOf(m.v)
      const elems = step === null ? null : m.a * step
      if (elems !== null && elems % p.L === 0) stride = (m.dir === 'backward' ? -1 : 1) * elems / p.L
    }
    return {
      type: vec ? 'VMEM' : 'MEM', oper: p.kind === 'load' ? 'LOAD' : 'STORE',
      size: cls.bytes ? INT_SIZES[cls.bytes] ?? null : null,
      destin:  p.kind === 'load' ? p.dest : '',
      source1: p.kind === 'load' ? (m.v ?? '') : p.value,
      source2: m.array,
      source3: p.kind === 'load' ? '' : (m.v ?? ''),
      constant: c === 0 ? '' : String(c), stride, lanes: p.L,
    }
  }
  const cls  = classOf(p.dest)
  const kind = OP_KIND[p.op] ?? cls.kind
  const type = kind ? (vec ? `V${kind}` : kind) : null
  const operKind = kindOfType(type ?? inst.type)
  const s = p.sources
  return {
    type, oper: operKind ? OPER[p.op][operKind] : null,
    size: cls.bytes && (kind ?? operKind) ? sizeName(kind ?? operKind, cls.bytes) : null,
    destin: p.dest, source1: s[0] ?? '', source2: s[1] ?? '', source3: s[2] ?? '',
    constant: p.constant, stride: null, lanes: p.L,
  }
}

function fieldDifferences(inst, d) {
  if (!d) return []
  const diffs = []
  const memory = isMemoryType(d.type ?? inst.type)
  for (const field of ['type', 'oper', 'size', 'destin', 'source1', 'source2', 'source3']) {
    if (d[field] === null || d[field] === undefined) continue
    if (['type', 'oper', 'size'].includes(field) && norm(inst[field]) === '') continue   // still to be filled
    if (norm(inst[field]) !== norm(d[field])) diffs.push({ field, actual: inst[field], expected: d[field] })
  }
  const sameConstant = memory ? constantNumber(inst.constant) === constantNumber(d.constant)
                              : norm(inst.constant) === norm(d.constant)
  if (!sameConstant) diffs.push({ field: 'constant', actual: inst.constant, expected: d.constant })
  if (memory && d.stride !== null && Number(inst.stride) !== d.stride)
    diffs.push({ field: 'stride', actual: inst.stride, expected: d.stride })
  if ((d.lanes > 1 || Number(inst.lanes) > 1) && Number(inst.lanes) !== d.lanes)
    diffs.push({ field: 'lanes', actual: inst.lanes, expected: d.lanes })
  return diffs
}

// Fields deduced from the text of instruction `index` (its own Type/Size fields are ignored, so
// that a new text is not biased by the old fields). null when the text is not analyzed.
export function deriveRowFields(list, index, declarations = []) {
  const analysis = analyzeProgramText(list, declarations, { ignoreFieldsOf: new Set([index]) })
  return analysis.derived[index]
}

// Applies the fields deduced from the text (autofill): every deduced field is overwritten.
// Returns the names of the fields that changed.
export function fillFromText(inst, derived) {
  if (!derived) return []
  const changed = []
  const set = (field, value) => {
    if (value === null || value === undefined) return
    if (norm(inst[field]) === norm(value) && field !== 'stride' && field !== 'lanes') return
    if ((field === 'stride' || field === 'lanes') && Number(inst[field]) === value) return
    inst[field] = value
    changed.push(field)
  }
  set('type', derived.type)       // null when the data type is still unknown (the field is kept)
  set('oper', derived.oper)
  set('size', derived.size)
  for (const field of ['destin', 'source1', 'source2', 'source3', 'constant']) set(field, derived[field])
  if (isMemoryType(inst.type)) set('stride', derived.stride)
  set('lanes', derived.lanes)
  return changed
}

// ---------------------------------------------------------------------------------------------
// Declarations (saved in the program JSON)
// ---------------------------------------------------------------------------------------------
export function declarationsFromAnalysis(analysis) {
  return analysis.variables.map(v => {
    const d = { name: v.name, role: v.readOnly && v.role === 'data' ? 'read-only' : v.role }
    if (v.kind) d.type = v.kind
    if (v.size) d.size = v.size
    if (v.lanes.length === 1 && v.lanes[0] > 1) d.lanes = v.lanes[0]
    return d
  })
}

// The user sets the data type of `name` in the declarations table: every variable of its class is
// declared with it, and the Type/Oper/Size fields of the instructions of the class are rewritten.
// Returns { declarations, updates: [{ index, fields }] }.
export function declareVariable(list, declarations, name, { type = '', size = '' }) {
  const before = analyzeProgramText(list, declarations)
  const root = before.root(name)
  if (!root) return { declarations, updates: [] }
  const names = before.variables.filter(v => v.root === root).map(v => v.name)
  const others = (declarations ?? []).filter(d => !names.includes(d.name))
  const next = [...others, ...names.map(n => ({ name: n, ...(type ? { type } : {}), ...(size ? { size } : {}) }))]
  const rowsOfClass = new Set()
  before.rows.forEach((r, index) => {
    if (!r.ok || r.p.kind === 'branch') return
    const data = r.p.kind === 'compute' ? r.p.dest : r.p.data
    if (data && before.root(data) === root) rowsOfClass.add(index)
  })
  const after = analyzeProgramText(list, next, { ignoreFieldsOf: rowsOfClass })
  const updates = [...rowsOfClass].map(index => {
    const d = after.derived[index], fields = {}
    for (const f of ['type', 'oper', 'size']) if (d?.[f]) fields[f] = d[f]
    return { index, fields }
  })
  return { declarations: next, updates }
}

// Coherence of the declarations of a program read from a JSON file (warnings, not errors)
export function checkDeclarations(program) {
  const decls = program?.declarations
  if (!Array.isArray(decls) || !decls.length) return []
  const list = program.instruction_list ?? []
  const analysis = analyzeProgramText(list, decls)
  const used = new Set(analysis.variables.map(v => v.name))
  const messages = decls.filter(d => d?.name && !used.has(d.name)).map(d => `Declared variable ${d.name} is not used by the program.`)
  messages.push(...analysis.warnings.filter(w => w.code === 'T3' && w.message.includes('declaration')).map(w => w.message))
  for (const v of analysis.variables) {
    if (!decls.some(d => d?.name === v.name)) messages.push(`Variable ${v.name} is not declared.`)
  }
  return messages
}

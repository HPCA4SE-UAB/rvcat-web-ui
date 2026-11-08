// Lessons: a set of programs, processors and one tutorial, with locks on what the student can
// change, tasks (cards of the tutorial: questions, predictions and goals) and a completion code.
//
// Lesson file (JSON):
//   {
//     "lesson": "L3-rob",                 identifier (letters, digits, "-")
//     "title": "...", "description": "...", "version": 1,
//     "programs":   ["Base", { ...program... }],     names of programs of RVCAT, or embedded programs
//     "processors": ["B4",   { ...processor... }],   idem for processors
//     "tutorial":   "name"  or  { ...tutorial... },
//     "start":      { "program": "Base", "processor": "B4", "N": 1000 },
//     "locks":      { see DEFAULT_LOCKS },
//     "completion": { "secret": "K7Q2X", "idLabel": "NIU", "idPattern": "^[0-9]{7}$" }
//   }
// "Export" replaces the names by the objects: a self-contained file, unaffected by later changes.

import { tutorialValue } from '@/tutorialValues'
import { t } from '@/i18n'

// Locks of a lesson (true = the student cannot do it). processor: "all" or a list of fields
// (dispatch, retire, rob, cache, bPenalty, ports, latencies); N: { fixed } or { min, max };
// simulation: fixed options { sched, speculation }.
export const DEFAULT_LOCKS = {
  programEditor:  false,
  tutorialEditor: true,
  loopTransforms: true,
  upload:         true,
  remove:         true,
  processor:      [],
  N:              null,
  simulation:     {},
}
export const PROCESSOR_FIELDS = ['dispatch', 'retire', 'rob', 'cache', 'bPenalty', 'ports', 'latencies']

const ID_RE = /^[A-Za-z0-9-]{1,40}$/

const resourceName = (r) => (typeof r === 'string' ? r : (r?.name ?? r?.id ?? ''))

// Checks a lesson file; returns a list of errors (empty when it is correct)
export function validateLesson(lesson) {
  const errors = []
  if (!lesson || typeof lesson !== 'object') return ['The file is not a lesson']
  if (!ID_RE.test(lesson.lesson ?? '')) errors.push(t('"lesson" must be an identifier (letters, digits and "-")'))
  if (!lesson.title) errors.push(t('"title" is required'))
  for (const key of ['programs', 'processors']) {
    if (!Array.isArray(lesson[key]) || !lesson[key].length) errors.push(t('"{1}" must list at least one {2}', { 1: key, 2: key.slice(0, -1) }))
    else if (lesson[key].some(r => !resourceName(r))) errors.push(t('every element of "{1}" needs a name', { 1: key }))
  }
  if (!lesson.tutorial) errors.push(t('"tutorial" is required'))
  else if (typeof lesson.tutorial === 'object' && !Array.isArray(lesson.tutorial.steps)) errors.push(t('the embedded tutorial has no steps'))
  const start = lesson.start ?? {}
  if (start.program && !lesson.programs?.some(r => resourceName(r) === start.program))
    errors.push(t('start program "{1}" is not in "programs"', { 1: start.program }))
  if (start.processor && !lesson.processors?.some(r => resourceName(r) === start.processor))
    errors.push(t('start processor "{1}" is not in "processors"', { 1: start.processor }))
  const c = lesson.completion
  if (c) {
    if (!ID_RE.test(c.secret ?? '')) errors.push(t('"completion.secret" must have letters, digits or "-"'))
    if (c.idPattern) { try { new RegExp(c.idPattern) } catch { errors.push(t('"completion.idPattern" is not a valid regular expression')) } }
  }
  const locks = lesson.locks ?? {}
  if (Array.isArray(locks.processor) && locks.processor.some(f => !PROCESSOR_FIELDS.includes(f)))
    errors.push(t('"locks.processor" fields: {1} (or "all")', { 1: PROCESSOR_FIELDS.join(', ') }))
  return errors
}

export const normalizeLocks = (locks = {}) => ({ ...DEFAULT_LOCKS, ...locks,
  simulation: { ...(locks.simulation ?? {}) } })

// ---- Resources: names (references) and embedded objects ----
// storage: { get(type, name) -> object | null }
export function lessonResources(lesson, storage) {
  const missing = []
  const resolve = (type, r) => {
    if (typeof r === 'object') return { name: resourceName(r), data: r, embedded: true }
    const data = storage.get(type, r)
    if (!data) missing.push(`${type} "${r}"`)
    return { name: r, data, embedded: false }
  }
  const tutorial = lesson.tutorial
  return {
    programs:   (lesson.programs ?? []).map(r => resolve('program', r)),
    processors: (lesson.processors ?? []).map(r => resolve('processor', r)),
    // an embedded tutorial is stored with its id (its name is the title shown in the menu)
    tutorial:   typeof tutorial === 'object'
      ? { name: tutorial.id ?? tutorial.name, data: tutorial, embedded: true }
      : resolve('tutorial', tutorial),
    missing,
  }
}

// Self-contained copy of a lesson: every name replaced by the stored object
export function exportLesson(lesson, storage) {
  const res = lessonResources(lesson, storage)
  if (res.missing.length) throw new Error(`Not found: ${res.missing.join(', ')}`)
  const tutorial = { ...res.tutorial.data }
  if (!tutorial.id) tutorial.id = res.tutorial.name
  return {
    ...lesson,
    programs:   res.programs.map(r => r.data),
    processors: res.processors.map(r => r.data),
    tutorial,
  }
}

// ---- Tasks: the question, predict and goal cards of the tutorial ----
export const TASK_TYPES = ['question', 'predict', 'goal']
export const lessonTasks = (tutorial) =>
  (tutorial?.steps ?? []).filter(s => TASK_TYPES.includes(s.type) && !s.optional).map(s => s.id)

// ---- Completion code (level 1): it only shows that the lesson was completed with this ID ----
// The same computation is done by the spreadsheet of the teacher (docs/lessons/lesson-codes.xlsx):
//   t  = UPPER(lesson) | UPPER(student ID) | UPPER(secret)
//   h1 = MOD(Σ CODE(t_i)·MOD(131·i² + 71·i + 17, 997), 99991)
//   h2 = MOD(Σ CODE(t_i)·MOD(37·i² + 113·i + 29, 991), 99989)        (i = 1 … length of t)
//   code = h1 (5 digits) - h2 (5 digits)
export function normalizeId(id) {
  return String(id ?? '').trim().toUpperCase()
}
export const validStudentId = (id, pattern) =>
  ID_RE.test(normalizeId(id)) && (!pattern || new RegExp(pattern).test(String(id).trim()))

export function completionCode(lessonId, studentId, secret) {
  const t = `${normalizeId(lessonId)}|${normalizeId(studentId)}|${normalizeId(secret)}`
  let h1 = 0, h2 = 0
  for (let k = 0; k < t.length; k++) {
    const i = k + 1, c = t.charCodeAt(k)
    h1 += c * ((131 * i * i + 71 * i + 17) % 997)
    h2 += c * ((37 * i * i + 113 * i + 29) % 991)
  }
  const pad = (n) => String(n).padStart(5, '0')
  return `${pad(h1 % 99991)}-${pad(h2 % 99989)}`
}

// ---- Conditions of the goals: "cyclesPerIter < 2.5 && rob <= 32", program == "V2" ----
// Names are the live values of the tutorials ({{name}} also accepted, e.g. {{resource.P1+P3}}).
// Returns { ok, values: { name: value }, error }
export function evaluateCondition(text, simState) {
  const values = {}
  let tokens
  try { tokens = tokenize(String(text ?? '')) } catch (e) { return { ok: false, values, error: e.message } }
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]
  const expect = (v) => { if (peek()?.v !== v) throw new Error(`expected ${v}`); next() }

  const lookup = (name) => {
    const v = tutorialValue(name, simState)
    values[name] = v?.value ?? null
    return v?.value ?? null
  }
  function primary() {
    const t = next()
    if (!t) throw new Error('unexpected end')
    if (t.t === 'num' || t.t === 'str') return t.v
    if (t.t === 'name') return lookup(t.v)
    if (t.v === '(') { const v = or(); expect(')'); return v }
    if (t.v === '!') return !truthy(primary())
    if (t.v === '-') { const v = primary(); return v === null ? null : -v }
    throw new Error(`unexpected ${t.v}`)
  }
  const truthy = (v) => v !== null && v !== false && v !== 0
  const arith = (a, op, b) => (a === null || b === null ? null
    : op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : b === 0 ? null : a / b)
  function term() { let v = primary(); while (['*', '/'].includes(peek()?.v)) { const op = next().v; v = arith(v, op, primary()) } return v }
  function sum()  { let v = term();    while (['+', '-'].includes(peek()?.v)) { const op = next().v; v = arith(v, op, term()) } return v }
  function cmp() {
    let v = sum()
    while (['<', '<=', '>', '>=', '==', '!='].includes(peek()?.v)) {
      const op = next().v, b = sum()
      if (v === null || b === null) { v = false; continue }
      v = op === '<' ? v < b : op === '<=' ? v <= b : op === '>' ? v > b : op === '>=' ? v >= b
        : op === '==' ? v == b : v != b    
    }
    return v
  }
  function and() { let v = cmp(); while (peek()?.v === '&&') { next(); const b = cmp(); v = truthy(v) && truthy(b) } return v }
  function or()  { let v = and(); while (peek()?.v === '||') { next(); const b = and(); v = truthy(v) || truthy(b) } return v }

  try {
    const v = or()
    if (pos < tokens.length) throw new Error(`unexpected ${tokens[pos].v}`)
    return { ok: truthy(v) && v !== null, values }
  } catch (e) {
    return { ok: false, values, error: e.message }
  }
}

function tokenize(s) {
  const tokens = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/\s/.test(ch)) { i++; continue }
    const two = s.slice(i, i + 2)
    if (two === '{{') {
      const end = s.indexOf('}}', i)
      if (end < 0) throw new Error('missing }}')
      tokens.push({ t: 'name', v: s.slice(i + 2, end).trim() }); i = end + 2; continue
    }
    if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) { tokens.push({ t: 'op', v: two }); i += 2; continue }
    if ('<>+-*/()!'.includes(ch)) { tokens.push({ t: 'op', v: ch }); i++; continue }
    if (ch === '"' || ch === "'") {
      const end = s.indexOf(ch, i + 1)
      if (end < 0) throw new Error('missing quote')
      tokens.push({ t: 'str', v: s.slice(i + 1, end) }); i = end + 1; continue
    }
    const num = /^\d+(\.\d+)?/.exec(s.slice(i))
    if (num) { tokens.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue }
    const name = /^[A-Za-z_][\w.]*/.exec(s.slice(i))
    if (name) { tokens.push({ t: 'name', v: name[0] }); i += name[0].length; continue }
    throw new Error(`unexpected character ${ch}`)
  }
  return tokens
}

// ---- Locks in force: the lesson's, minus what the current goal card allows ----
// allow: ["processor.rob", "N", "programEditor", ...]
export function isLocked(lesson, what, allow = []) {
  if (!lesson) return false
  if (allow.includes(what)) return false
  const locks = lesson.locks ?? DEFAULT_LOCKS
  if (what.startsWith('processor.')) {
    const field = what.slice('processor.'.length)
    if (allow.includes('processor')) return false
    return locks.processor === 'all' || (Array.isArray(locks.processor) && locks.processor.includes(field))
  }
  if (what === 'N') return !!locks.N?.fixed
  return !!locks[what]
}

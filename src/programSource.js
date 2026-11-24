// Source code (usually C) from which a program was generated, and its relation with the instructions.
// Fields of the program JSON:
//   description  the source code (string; lines numbered from 1)
//   sourceNote   how the compiler turned it into this program: one sentence (string or { en, es, ca })
//   compile      the command that compiled it (string)
// Field of an instruction (loop body or epilogue):
//   cLine        line (or list of lines) of the source code that the instruction implements

// Lines of the source code that an instruction implements (numbers >= 1)
export function instrLines(inst) {
  const v = inst?.cLine
  const list = Array.isArray(v) ? v : (v === undefined || v === null || v === '' ? [] : [v])
  return list.map(Number).filter(n => Number.isInteger(n) && n >= 1)
}

// Lines referenced by the instructions of the program (sorted, each once)
export function linkedLines(process) {
  const all = [...(process?.instruction_list ?? []), ...(process?.epilogue ?? [])]
  return [...new Set(all.flatMap(instrLines))].sort((a, b) => a - b)
}

const isComment = (line) => /^\s*(\/\/|\/\*|\*|#)/.test(line)

// One-line summary of the source code: the lines that the instructions implement (without the lines
// made only of braces); without relations, the first line that is not a comment
export function summaryLines(process) {
  const lines = String(process?.description ?? '').split('\n')
  const linked = linkedLines(process).filter(n => n <= lines.length && /[^\s{}]/.test(lines[n - 1]))
  if (linked.length) return linked.map(n => ({ line: n, text: lines[n - 1].trim() }))
  const first = lines.findIndex(l => l.trim() && !isComment(l))
  return first >= 0 ? [{ line: first + 1, text: lines[first].trim() }] : []
}

// Errors of the source fields of a program (validation of the program JSON)
const fillParams = (s, p) => (p ? s.replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? String(p[k]) : m)) : s)

export function sourceFieldErrors(program, t = fillParams) {
  const errors = []
  const note = program?.sourceNote
  if (note !== undefined && typeof note !== 'string' &&
      !(note && typeof note === 'object' && !Array.isArray(note) && Object.values(note).every(v => typeof v === 'string')))
    errors.push(t('Program sourceNote must be a string or an object with a text per language ({ en, es, ca }).'))
  if (program?.compile !== undefined && typeof program.compile !== 'string')
    errors.push(t('Program compile (command that compiled the source code) must be a string.'))
  const nLines = String(program?.description ?? '').split('\n').length
  const lists = [program?.instruction_list, program?.epilogue].filter(Array.isArray)
  lists.flat().forEach((inst, i) => {
    const v = inst?.cLine
    if (v === undefined) return
    const list = Array.isArray(v) ? v : [v]
    if (!list.length || list.some(n => !Number.isInteger(n) || n < 1 || n > nLines))
      errors.push(t('Instruction {i}: cLine must be a line of the source code (1 - {n}) or a list of lines.', { i, n: nLines }))
  })
  return errors
}

// Algorithmic operations (alg ops): one iteration of the ORIGINAL loop, before unrolling or
// vectorization (SIMD). An O(N) algorithm performs N algorithmic operations.
//
// The loop stride S (the `stride` of the BRANCH instruction, as RVCAT uses it) is the number of
// algorithmic operations done by one iteration of the loop. For N algorithmic operations the
// loop runs N/S iterations, so:   cycles/alg oper = (cycles/iter) / S
// Cycles per iteration of programs with different S cannot be compared; cycles/alg oper can.

export const ALG_OP_UNIT = 'cycles/alg oper'

// Loop stride S of a program (same rule as RVCAT: a BRANCH whose stride is not 1 defines it)
export function loopStride(instructionList) {
  let stride = 1
  for (const instr of instructionList ?? []) {
    const s = Number(instr?.stride)
    if (instr?.type === 'BRANCH' && Number.isInteger(s) && s > 1) stride = s
  }
  return stride
}

// Cycles per algorithmic operation (null when it cannot be computed)
export function cyclesPerAlgOp(cyclesPerIter, stride) {
  const c = Number(cyclesPerIter)
  return Number.isFinite(c) && stride >= 1 ? c / stride : null
}

// "2.00 cycles/iter ÷ 4 alg opers/iter (loop stride) = 0.50 cycles/alg oper"
export function algOpFormula(cyclesPerIter, stride) {
  const value = cyclesPerAlgOp(cyclesPerIter, stride)
  if (value === null) return ''
  return `${Number(cyclesPerIter).toFixed(2)} cycles/iter ÷ ${stride} alg opers/iter (loop stride) = ` +
         `${value.toFixed(2)} ${ALG_OP_UNIT}`
}

// Explanation used in headers and tooltips
export const ALG_OP_HELP =
  'Algorithmic operation = one iteration of the original loop (before unrolling or SIMD). ' +
  'An O(N) algorithm performs N algorithmic operations. When each iteration does the work of ' +
  'S original iterations (loop stride S), cycles/alg oper = cycles/iter ÷ S, which allows comparing ' +
  'the baseline loop with its unrolled or vectorized versions.'

// Loop stride of a stored simulation result: saved in its context, or deduced from N and the
// executed iterations (older results). null when unknown.
export function resultStride(result) {
  const program = result?.context?.program
  if (Number.isInteger(program?.stride) && program.stride >= 1) return program.stride
  const N = Number(program?.N), iters = Number(result?.total_iterations)
  if (N > 0 && iters > 0) return Math.max(1, Math.round(N / iters))
  return null
}

// Cycles per algorithmic operation of a simulation result (null when unknown)
export function resultCyclesPerAlgOp(result) {
  const stride = resultStride(result)
  const cycles = Number(result?.total_cycles), iters = Number(result?.total_iterations)
  if (!stride || !(cycles > 0) || !(iters > 0)) return null
  return cycles / (iters * stride)
}

// Machine instructions per algorithmic operation of a simulation result (null when unknown).
// Together with IPC it decomposes the time:  cycles/alg oper = (instr/alg oper) / IPC
export function resultInstrPerAlgOp(result) {
  const stride = resultStride(result)
  const instrs = Number(result?.total_instructions), iters = Number(result?.total_iterations)
  if (!stride || !(instrs > 0) || !(iters > 0)) return null
  return instrs / (iters * stride)
}

// Speedup of a result over a reference result (versions of the same algorithm):
// ratio of their cycles per algorithmic operation. null when unknown.
export function speedupOver(reference, result) {
  const ref = resultCyclesPerAlgOp(reference), cur = resultCyclesPerAlgOp(result)
  return ref && cur ? ref / cur : null
}

// Warning when the program looks unrolled or vectorized but its loop stride is 1:
// vector instructions (lanes > 1), or a loop counter incremented by k > 1 ("i = i + 4").
export function strideWarning(instructionList) {
  const list = instructionList ?? []
  if (loopStride(list) !== 1) return ''
  const lanes = Math.max(1, ...list.map(i => Number(i?.lanes) || 1))
  if (lanes > 1)
    return `Vector instructions with ${lanes} lanes, but the loop stride is 1: if each iteration does the ` +
           `work of ${lanes} original iterations, set the stride of the BRANCH instruction to ${lanes} ` +
           `so that cycles/alg oper is correct.`
  for (const instr of list) {
    const m = /^\s*(\w+)\s*=\s*\1\s*\+\s*(\d+)\s*$/.exec(instr?.text ?? '')
    if (instr?.type?.startsWith('INT') && m && Number(m[2]) > 1)
      return `"${instr.text.trim()}" suggests that each iteration does the work of ${m[2]} original ` +
             `iterations, but the loop stride is 1: set the stride of the BRANCH instruction to ${m[2]} ` +
             `so that cycles/alg oper is correct.`
  }
  return ''
}

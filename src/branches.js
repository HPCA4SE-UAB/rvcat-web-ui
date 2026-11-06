// Conditional forward branches inside the loop body: "if c skip k".
// A conditional branch is a BRANCH that is not the last instruction (the last one is the loop
// branch). Fields: source1 = condition, constant = k (instructions skipped when it is taken),
// prob = probability of being taken, mispredict = misprediction rate (empty: the simulator uses
// a 2-bit predictor). Mirrors Program.conditional_branches of RVCAT.

export const isConditionalBranch = (list, index) =>
  list?.[index]?.type === 'BRANCH' && index < (list?.length ?? 0) - 1

export function skipCount(instr) {
  const text = String(instr?.constant ?? '').trim()
  const k = text === '' ? 1 : Number(text)
  return Number.isInteger(k) ? k : NaN
}

// [{ index, skip }]: skip clamped so that the final loop branch is never skipped
export function conditionalBranches(list) {
  const n = list?.length ?? 0
  const out = []
  for (let i = 0; i < n - 1; i++) {
    if (list[i]?.type !== 'BRANCH') continue
    const k = skipCount(list[i])
    out.push({ index: i, skip: Math.max(1, Math.min(Number.isFinite(k) ? k : 1, n - 2 - i)) })
  }
  return out
}

// Number of conditional blocks that contain each instruction (for indentation)
export function conditionalDepth(list) {
  const depth = new Array(list?.length ?? 0).fill(0)
  for (const { index, skip } of conditionalBranches(list))
    for (let j = index + 1; j <= index + skip; j++) depth[j]++
  return depth
}

// Number in [0, 1], or null when empty or invalid
export function fraction(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const x = Number(value)
  return Number.isFinite(x) && x >= 0 && x <= 1 ? x : null
}

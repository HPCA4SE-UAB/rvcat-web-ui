// Highlighting of the RVCAT dependence graph (Graphviz SVG).
// Instruction nodes are named i<iteration>s<instruction>, e.g. "i2s7";
// edges are titled "<from>-><to>", e.g. "i1s3->i2s0".

const NODE = /^i(\d+)s(\d+)$/

export function parseNode(name) {
  const m = NODE.exec(name?.trim() ?? '')
  return m ? { iter: Number(m[1]), instr: Number(m[2]) } : null
}

export function parseEdge(title) {
  const [from, to] = (title ?? '').split('->').map(s => s.trim())
  return to === undefined ? null : { from, to, a: parseNode(from), b: parseNode(to) }
}

// Steps of a cyclic chain: for each instruction, the next one and whether the dependence
// crosses to the next loop iteration (the chain [0,1,7,3] has 7->3 and 3->0 crossing).
export function chainSteps(chain) {
  const steps = new Map()
  chain.forEach((from, k) => {
    const to = chain[(k + 1) % chain.length]
    steps.set(from, { to, crosses: from >= to })
  })
  return steps
}

// Edge between two instruction nodes that follows the chain
export function isChainEdge(edge, steps) {
  if (!edge?.a || !edge?.b) return false
  const step = steps.get(edge.a.instr)
  return Boolean(step) && step.to === edge.b.instr &&
         edge.b.iter === edge.a.iter + (step.crosses ? 1 : 0)
}
